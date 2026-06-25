// Shared actions used by BOTH the CLI and the MCP server, so the two control
// surfaces never diverge. Each function takes a Store + config, mutates state,
// persists, and returns a plain result object (easy to render or serialize).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { trainModel } from "../packages/core/src/index.ts";
import { DEFAULT_EXECUTION, DEFAULT_LEARN, DEFAULT_OUTREACH, DEFAULT_STRATEGY, ROOT, strategyOverridesPath, type AgentConfig } from "./config.ts";
import { computeFunnel, recommend, type Funnel, type Recommendation } from "./strategy.ts";
import { forecast, prealloc, type Forecast, type PreallocRec } from "./forecast.ts";
import { buildReport } from "./report.ts";
import { effectiveDailyCap } from "./billing.ts";
import { executeJob, jobFromLead, trainQualityModel, type QualityModel } from "./exec/index.ts";
import { sendOutreach } from "./outreach.ts";
import type { Store } from "./store.ts";

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
}
export interface ExecSummary {
  executed: number;
  auto: number;
  review: number;
  items: ExecItem[];
}

/** Autonomously execute won leads: plan → produce → self-verify → package. */
export async function runExecute(store: Store, cfg: AgentConfig): Promise<ExecSummary> {
  const exec = cfg.settings.execution ?? DEFAULT_EXECUTION;
  const dir = resolve(process.env.RADAR_DATA_DIR ?? resolve(ROOT, "data"), "deliverables");
  mkdirSync(dir, { recursive: true });

  const quality = store.getQualityModel(); // self-calibrated autonomy bar
  const items: ExecItem[] = [];
  let auto = 0;
  let reviewN = 0;
  for (const lead of store.executableLeads()) {
    const job = jobFromLead(
      lead,
      lead.signalBody ?? lead.signalTitle,
      lead.signalCategories ?? [],
      lead.signalLang ?? "pl",
    );
    const report = await executeJob(job, { maxIterations: exec.maxIterations, minConfidence: exec.minConfidence, quality, candidates: exec.candidates, targetScore: exec.targetScore });
    const ref = resolve(dir, `${lead.tenantId}_${lead.id}.md`);
    writeFileSync(ref, report.deliverable);
    // Also write each artifact in its native format (openable .html, .txt).
    for (const o of report.outcomes) {
      if (o.artifact.format !== "md") {
        writeFileSync(resolve(dir, `${lead.tenantId}_${lead.id}.${o.artifact.format}`), o.artifact.content);
      }
    }
    const capability = report.outcomes[0]?.task.capability ?? "?";
    store.recordExecution(lead.id, report.gate, report.confidence, ref, capability);
    items.push({ leadId: lead.id, capability, confidence: report.confidence, gate: report.gate, ref });
    if (report.gate === "auto") auto++;
    else reviewN++;
  }
  store.save();
  return { executed: items.length, auto, review: reviewN, items };
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
