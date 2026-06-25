// Shared actions used by BOTH the CLI and the MCP server, so the two control
// surfaces never diverge. Each function takes a Store + config, mutates state,
// persists, and returns a plain result object (easy to render or serialize).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { trainModel } from "../packages/core/src/index.ts";
import { DEFAULT_EXECUTION, DEFAULT_LEARN, DEFAULT_OUTREACH, DEFAULT_STRATEGY, ROOT, strategyOverridesPath, type AgentConfig } from "./config.ts";
import { computeFunnel, recommend, DEFAULT_COSTS, type Funnel, type Recommendation } from "./strategy.ts";
import { recommendBid, competitionScore, calibrateWeights, DEFAULT_WEIGHTS, type CalibrationResult, type PriceWeights } from "./pricing.ts";
import { negotiate, type NegotiationDecision } from "./negotiate.ts";
import { forecast, prealloc, type Forecast, type PreallocRec } from "./forecast.ts";
import { buildReport } from "./report.ts";
import { memoryPath } from "./config.ts";
import { Memory } from "./memory.ts";
import { financials, type Financials } from "./finance.ts";
import { dueFollowUps, pipeline, type CrmLead } from "./crm.ts";
import { boardroom, type Boardroom } from "./agents.ts";
import { rewardOf } from "./rank.ts";
import { effectiveDailyCap } from "./billing.ts";
import { executeJob, jobFromLead, trainQualityModel, type QualityModel } from "./exec/index.ts";
import { sendOutreach } from "./outreach.ts";
import type { Store, StoredLead } from "./store.ts";

export interface TrainResult {
  tenantId: string;
  trained: boolean;
  examples: number;
  top: { keyword: string; weight: number }[];
}

export function runTrain(store: Store, cfg: AgentConfig): TrainResult[] {
  const learn = cfg.settings.learn ?? DEFAULT_LEARN;
  const results: TrainResult[] = [];
  for (const t of cfg.tenants) {
    const ex = store.trainingExamples(t.id);
    if (ex.length < learn.minExamples) {
      results.push({ tenantId: t.id, trained: false, examples: ex.length, top: [] });
      continue;
    }
    const model = trainModel(ex, Date.now());
    store.setLearned(t.id, model);
    const top = Object.entries(model.keywordWeights)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 6)
      .map(([keyword, weight]) => ({ keyword, weight }));
    results.push({ tenantId: t.id, trained: true, examples: ex.length, top });
  }
  store.save();
  return results;
}

export interface SendResultItem {
  leadId: string;
  tenantId: string;
  via: string;
  ref: string;
}
export interface SendSummary {
  sent: number;
  capped: number;
  items: SendResultItem[];
}

export interface ExecItem {
  leadId: string;
  capability: string;
  confidence: number;
  gate: "auto" | "review";
  ref: string;
  files: string[]; // all written deliverable files (md + native)
}
export interface ExecSummary {
  executed: number;
  auto: number;
  review: number;
  items: ExecItem[];
}

/** Execute a single lead end-to-end (plan→produce→verify→repair→package→save). */
async function execOneLead(store: Store, cfg: AgentConfig, lead: StoredLead, dir: string): Promise<ExecItem> {
  const exec = cfg.settings.execution ?? DEFAULT_EXECUTION;
  const quality = store.getQualityModel();
  const job = jobFromLead(lead, lead.signalBody ?? lead.signalTitle, lead.signalCategories ?? [], lead.signalLang ?? "pl");
  const report = await executeJob(job, { maxIterations: exec.maxIterations, minConfidence: exec.minConfidence, quality, candidates: exec.candidates, targetScore: exec.targetScore });
  const ref = resolve(dir, `${lead.tenantId}_${lead.id}.md`);
  writeFileSync(ref, report.deliverable);
  const files = [ref];
  for (const o of report.outcomes) {
    if (o.artifact.format !== "md") {
      const f = resolve(dir, `${lead.tenantId}_${lead.id}.${o.artifact.format}`);
      writeFileSync(f, o.artifact.content);
      files.push(f);
    }
  }
  const capability = report.outcomes[0]?.task.capability ?? "?";
  store.recordExecution(lead.id, report.gate, report.confidence, ref, capability);
  return { leadId: lead.id, capability, confidence: report.confidence, gate: report.gate, ref, files };
}

/** Autonomously execute all won leads: plan → produce → self-verify → package. */
export async function runExecute(store: Store, cfg: AgentConfig): Promise<ExecSummary> {
  const dir = resolve(process.env.RADAR_DATA_DIR ?? resolve(ROOT, "data"), "deliverables");
  mkdirSync(dir, { recursive: true });
  const items: ExecItem[] = [];
  for (const lead of store.executableLeads()) items.push(await execOneLead(store, cfg, lead, dir));
  store.save();
  return summarize(items);
}

/** Execute one specific lead on demand (even if not yet WON). */
export async function runExecuteLead(store: Store, cfg: AgentConfig, leadId: string): Promise<ExecItem | null> {
  const lead = store.findLead(leadId);
  if (!lead) return null;
  const dir = resolve(process.env.RADAR_DATA_DIR ?? resolve(ROOT, "data"), "deliverables");
  mkdirSync(dir, { recursive: true });
  const item = await execOneLead(store, cfg, lead, dir);
  store.save();
  return item;
}

function summarize(items: ExecItem[]): ExecSummary {
  return { executed: items.length, auto: items.filter((i) => i.gate === "auto").length, review: items.filter((i) => i.gate === "review").length, items };
}

export interface StrategyResult {
  funnel: Funnel;
  recommendations: Recommendation[];
  applied: string[]; // sources auto-disabled this run
}

/** Agent-CEO: compute P&L, recommend reallocation, optionally auto-apply safe moves. */
export function runStrategy(store: Store, cfg: AgentConfig, apply?: boolean): StrategyResult {
  const funnel = computeFunnel(store.leadFacts());
  const recommendations = recommend(funnel, { tenants: cfg.tenants.map((t) => ({ id: t.id, plan: t.plan })) });

  const doApply = apply ?? cfg.settings.strategy?.autoApply ?? DEFAULT_STRATEGY.autoApply;
  const applied: string[] = [];
  if (doApply) {
    const toDisable = recommendations.filter((r) => r.action === "disable_source" && r.autoApplicable).map((r) => r.target);
    if (toDisable.length) {
      const path = strategyOverridesPath();
      let ov: { sourcesDisabled?: string[] } = {};
      if (existsSync(path)) {
        try { ov = JSON.parse(readFileSync(path, "utf8")); } catch { ov = {}; }
      }
      const set = new Set(ov.sourcesDisabled ?? []);
      for (const name of toDisable) { if (!set.has(name)) { set.add(name); applied.push(name); } }
      mkdirSync(resolve(path, ".."), { recursive: true });
      writeFileSync(path, JSON.stringify({ sourcesDisabled: [...set] }, null, 2));
    }
  }
  return { funnel, recommendations, applied };
}

/** Multi-agent boardroom: every agent's view + CEO priorities. */
export function runBoard(store: Store, cfg: AgentConfig): Boardroom {
  return boardroom(store, cfg, Date.now(), new Memory(memoryPath()));
}

/** CFO: full financials (P&L, MRR, CAC, LTV, ROI). */
export function runFinance(store: Store, cfg: AgentConfig): Financials {
  return financials(store.leadFacts(), cfg.tenants.map((t) => ({ id: t.id, plan: t.plan })));
}

/** CRM: pipeline by stage + follow-ups due now. */
export function runCrm(store: Store, cfg: AgentConfig) {
  const leads: CrmLead[] = cfg.tenants.flatMap((t) => store.leadsForTenant(t.id, 0)).map((l) => ({
    id: l.id, status: l.status, outreachStatus: l.outreachStatus, sentAt: l.sentAt, title: l.signalTitle,
  }));
  return { pipeline: pipeline(leads), followUps: dueFollowUps(leads, Date.now()) };
}

/** Record a closed deal into long-term memory (data moat) — called on mark. */
export function recordToMemory(store: Store, leadId: string, outcome: "win" | "loss") {
  const lead = store.findLead(leadId);
  if (!lead) return;
  const category = lead.signalCategories?.[0] ?? "(brak)";
  const source = lead.signalSource ?? "(brak)";
  const channel = lead.sentVia ?? "file";
  new Memory(memoryPath()).recordDeal({
    tenantId: lead.tenantId,
    category,
    source,
    channel,
    budget: lead.signalBudget,
    // The price we actually bid (not the budget) — gives the calibrator real
    // price-elasticity signal. Falls back to budget for legacy/unpriced leads.
    price: lead.recommendedPrice ?? lead.signalBudget,
    score: lead.score,
    outcome,
    at: new Date().toISOString(),
  });
  // Closed loop: real outcome teaches the bandit which sources/channels/
  // categories actually convert, so future cycles lean into winners.
  const reward = rewardOf(outcome, normalizedBudget(lead.signalBudget));
  store.updateRank("source", source, reward);
  store.updateRank("channel", channel, reward);
  store.updateRank("category", category, reward);
  store.save();
}

/**
 * Re-calibrate the pricing weights from accumulated win/loss history and
 * persist them. Deterministic logistic regression — the system learns its own
 * price elasticity (at what fraction of budget deals start slipping). Used by
 * the `price-train` command, the MCP tool, and the autonomous cycle.
 */
export function runPriceTrain(store: Store, nowISO?: string): CalibrationResult {
  const samples = new Memory(memoryPath()).priceSamples();
  // Always fit from the stable DEFAULT priors over the FULL history, so training
  // is idempotent: same history → same weights, no slow drift across re-runs.
  const result = calibrateWeights(samples, DEFAULT_WEIGHTS, { at: nowISO ?? new Date().toISOString() });
  if (result.trainedOn >= 8) {
    store.setPriceWeights(result.weights);
    store.save();
  }
  return result;
}

/** Map an absolute budget to 0..1 so reward weighting is scale-free. */
function normalizedBudget(budget?: number): number {
  if (!budget || budget <= 0) return 0;
  return Math.min(1, budget / 10000);
}

export interface RankResult {
  namespaces: { ns: string; arms: { arm: string; value: number; n: number }[] }[];
}

/** Surface what the bandit has learned across every tracked decision axis. */
export function runRank(store: Store): RankResult {
  const namespaces = ["source", "channel", "category"].map((ns) => ({
    ns,
    arms: store.rankedArms(ns),
  }));
  return { namespaces };
}

export interface PriceResult {
  recommendedPrice: number;
  fraction: number;
  winProbability: number;
  expectedValue: number;
  marginPct: number;
  basis: { score: number; histWinRate: number; histSamples: number; competition: number };
}

/**
 * On-demand pricing for a lead (or ad-hoc brief): blends the lead's intent
 * score with the historical win rate for its category/source and current
 * competition into a deterministic EV-maximizing bid. Same math the cycle uses.
 */
export function runPrice(store: Store, leadId: string): PriceResult | null {
  const lead = store.findLead(leadId);
  if (!lead) return null;
  const category = lead.signalCategories?.[0] ?? "(brak)";
  const source = lead.signalSource ?? "(brak)";
  const hist = new Memory(memoryPath()).winRate({ category, source });
  const competitors = store.leadFacts().filter((f) => f.category === category).length;
  const weights = store.getPriceWeights() ?? DEFAULT_WEIGHTS;
  const bid = recommendBid(lead.signalBudget, DEFAULT_COSTS.perExecution, {
    score: lead.score,
    histWinRate: hist.n >= 3 ? hist.rate : 0.35,
    competition: competitionScore(competitors),
  }, weights);
  return {
    recommendedPrice: bid.price,
    fraction: bid.fraction,
    winProbability: bid.winProbability,
    expectedValue: bid.expectedValue,
    marginPct: bid.marginPct,
    basis: { score: lead.score, histWinRate: hist.rate, histSamples: hist.n, competition: competitionScore(competitors) },
  };
}

export interface NegotiateResult extends NegotiationDecision {
  leadId: string;
  round: number;
  ourPrice: number;
  clientOffer: number;
}

/**
 * Advise on a client counter-offer for a lead: accept / counter / decline,
 * maximizing EV above a margin floor. Advances the lead's negotiation round and
 * logs both sides into long-term memory. Deterministic — no LLM.
 */
export function runNegotiate(store: Store, leadId: string, clientOffer: number): NegotiateResult | null {
  const lead = store.findLead(leadId);
  if (!lead) return null;
  const ourPrice = lead.recommendedPrice ?? lead.signalBudget ?? Math.max(clientOffer, Math.round(DEFAULT_COSTS.perExecution / 0.5));
  const category = lead.signalCategories?.[0] ?? "(brak)";
  const mem = new Memory(memoryPath());
  const hist = mem.winRate({ category });
  const round = store.bumpNegotiation(leadId, clientOffer);
  const decision = negotiate({
    ourPrice,
    clientOffer,
    cost: DEFAULT_COSTS.perExecution,
    round,
    histWinRate: hist.n >= 3 ? hist.rate : 0.5,
  });
  const at = new Date().toISOString();
  mem.recordNegotiation({ leadId, from: "client", price: clientOffer, at });
  if (decision.action !== "decline") {
    mem.recordNegotiation({ leadId, from: "us", price: decision.price, note: decision.action, at });
  }
  store.save();
  return { ...decision, leadId, round, ourPrice, clientOffer };
}

/** Build the operator dashboard and persist it to data/report.md. */
export function runReport(store: Store, cfg: AgentConfig, nowISO: string): { markdown: string; ref: string } {
  const markdown = buildReport(store, cfg, nowISO);
  const dir = process.env.RADAR_DATA_DIR ?? resolve(ROOT, "data");
  mkdirSync(dir, { recursive: true });
  const ref = resolve(dir, "report.md");
  writeFileSync(ref, markdown);
  return { markdown, ref };
}

export interface ForecastResult {
  forecasts: Forecast[];
  recommendations: PreallocRec[];
}

/** Predictive demand: forecast per-category trend and pre-allocate effort. */
export function runForecast(store: Store): ForecastResult {
  const events = store.leadTimeline().map((e) => ({ key: e.category, date: e.date }));
  const forecasts = forecast(events);
  return { forecasts, recommendations: prealloc(forecasts) };
}

/** Train the execution-quality model from client verdicts and persist it. */
export function runQualityTrain(store: Store, base?: { minConfidence: number; maxIterations: number }): QualityModel {
  const model = trainQualityModel(store.executionQualitySamples(), base, Date.now());
  store.setQualityModel(model);
  store.save();
  return model;
}

export async function runSend(store: Store, cfg: AgentConfig, nowMs = Date.now()): Promise<SendSummary> {
  const out = cfg.settings.outreach ?? DEFAULT_OUTREACH;
  const approved = store.outbox("approved");
  const since = new Date(nowMs - 24 * 3600_000).toISOString();

  const byTenant = new Map<string, typeof approved>();
  for (const l of approved) {
    const arr = byTenant.get(l.tenantId) ?? [];
    arr.push(l);
    byTenant.set(l.tenantId, arr);
  }

  const items: SendResultItem[] = [];
  let sent = 0;
  let capped = 0;
  for (const [tenantId, leads] of byTenant) {
    const tenant = cfg.tenants.find((t) => t.id === tenantId);
    if (!tenant) continue;
    // Plan is the ceiling on daily sends, even if config asks for more.
    const dailyCap = effectiveDailyCap(tenant.plan, out.dailyCapPerTenant);
    let used = store.sentCountSince(tenantId, since);
    for (const l of leads) {
      if (used >= dailyCap) {
        capped++;
        continue;
      }
      const now = new Date().toISOString();
      const res = await sendOutreach(tenant, l, now);
      store.recordSend(tenantId, l.id, res.via, now);
      used++;
      sent++;
      items.push({ leadId: l.id, tenantId, via: res.via, ref: res.ref });
    }
  }
  store.save();
  return { sent, capped, items };
}
