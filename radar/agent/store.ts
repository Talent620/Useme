// Persistent, dependency-free store for the autonomous agent.
// Survives restarts via a single JSON file (default: radar/data/store.json).
// In production the same interface is backed by Prisma/Postgres (apps/web/lib).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { LabeledExample, Lead, LearnedModel, Signal } from "../packages/core/src/index.ts";
import type { ExecOutcome, QualityModel, QualitySample } from "./exec/quality.ts";
import type { LeadFact } from "./strategy.ts";
import { rank, update as rankUpdate, type RankTable } from "./rank.ts";
import type { PriceWeights } from "./pricing.ts";

/** Outreach lifecycle, separate from the sales outcome in `status`. */
export type OutreachStatus = "none" | "queued" | "approved" | "sent" | "skipped";

/** Per-source crawl bookkeeping: health + conditional-GET validators. */
export interface SourceState {
  lastRunAt?: string;
  lastError?: string;
  healthy: boolean;
  etag?: string;
  lastModified?: string;
}

export interface StoredLead extends Lead {
  id: string;
  signalTitle: string;
  signalUrl: string;
  signalBudget?: number;
  draftSubject?: string;
  draftBody?: string;
  status: "NEW" | "DELIVERED" | "SENT" | "REPLIED" | "WON" | "REJECTED";
  delivered: boolean;
  outreachStatus?: OutreachStatus;
  sentAt?: string;
  sentVia?: string;
  // Captured at creation so the execution engine has the full brief.
  signalBody?: string;
  signalCategories?: string[];
  signalLang?: string;
  signalSource?: string;
  // Pricing intelligence (computed at lead creation).
  recommendedPrice?: number;
  winProbability?: number;
  // Negotiation state (advanced by each counter-offer round).
  negotiationRound?: number;
  lastClientOffer?: number;
  // Autonomous execution state.
  executionStatus?: "none" | "auto" | "review";
  executionConfidence?: number;
  executionCapability?: string;
  executionOutcome?: ExecOutcome; // client verdict on the deliverable
  deliverableRef?: string;
}

interface Db {
  seq: number;
  seenSignals: Record<string, { id: string; firstSeen: string }>;
  leads: StoredLead[];
  deliveries: { id: string; tenantId: string; leadIds: string[]; channel: string; at: string }[];
  sends: { tenantId: string; leadId: string; via: string; at: string }[];
  learned: Record<string, LearnedModel>;
  qualityModel?: QualityModel;
  priceWeights?: PriceWeights;
  rankTables: Record<string, RankTable>;
  sourceState: Record<string, SourceState>;
}

const EMPTY: Db = { seq: 0, seenSignals: {}, leads: [], deliveries: [], sends: [], learned: {}, rankTables: {}, sourceState: {} };

export class Store {
  private db: Db;
  private path: string;
  constructor(path: string) {
    this.path = path;
    this.db = existsSync(path)
      ? { ...EMPTY, ...JSON.parse(readFileSync(path, "utf8")) }
      : structuredClone(EMPTY);
  }

  private persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.db, null, 2));
  }

  private id(prefix: string): string {
    this.db.seq += 1;
    return `${prefix}_${this.db.seq.toString(36)}`;
  }

  /** True if this signal (by dedupeKey) was already ingested in a prior run. */
  hasSeen(dedupeKey: string): boolean {
    return dedupeKey in this.db.seenSignals;
  }

  /** Register a signal; returns the assigned stable id (idempotent). */
  recordSignal(signal: Signal, now: string): string {
    const existing = this.db.seenSignals[signal.dedupeKey];
    if (existing) return existing.id;
    const id = this.id("sig");
    this.db.seenSignals[signal.dedupeKey] = { id, firstSeen: now };
    return id;
  }

  /** Idempotent upsert of a lead by (tenantId, signalId, icpId). */
  upsertLead(lead: Omit<StoredLead, "id" | "status" | "delivered">): StoredLead {
    const found = this.db.leads.find(
      (l) => l.tenantId === lead.tenantId && l.signalId === lead.signalId && l.icpId === lead.icpId,
    );
    if (found) {
      found.score = lead.score;
      found.reasons = lead.reasons;
      return found;
    }
    const created: StoredLead = { ...lead, id: this.id("lead"), status: "NEW", delivered: false };
    this.db.leads.push(created);
    return created;
  }

  undeliveredLeads(tenantId: string): StoredLead[] {
    return this.db.leads
      .filter((l) => l.tenantId === tenantId && !l.delivered)
      .sort((a, b) => b.score - a.score);
  }

  leadsForTenant(tenantId: string, minScore = 0): StoredLead[] {
    return this.db.leads
      .filter((l) => l.tenantId === tenantId && l.score >= minScore)
      .sort((a, b) => b.score - a.score);
  }

  markDelivered(tenantId: string, leadIds: string[], channel: string, now: string) {
    const set = new Set(leadIds);
    for (const l of this.db.leads) {
      if (l.tenantId === tenantId && set.has(l.id)) {
        l.delivered = true;
        if (l.status === "NEW") l.status = "DELIVERED";
      }
    }
    this.db.deliveries.push({ id: this.id("del"), tenantId, leadIds, channel, at: now });
  }

  findLead(leadId: string): StoredLead | undefined {
    return this.db.leads.find((l) => l.id === leadId);
  }

  setLeadStatus(leadId: string, status: StoredLead["status"]): boolean {
    const l = this.db.leads.find((x) => x.id === leadId);
    if (!l) return false;
    l.status = status;
    this.save();
    return true;
  }

  // -- outreach lifecycle -------------------------------------------------

  /** Queue a lead for outreach (or auto-approve). No-op if already in pipeline. */
  queueOutreach(leadId: string, autoApprove: boolean): boolean {
    const l = this.db.leads.find((x) => x.id === leadId);
    if (!l) return false;
    const cur = l.outreachStatus ?? "none";
    if (cur === "none") {
      l.outreachStatus = autoApprove ? "approved" : "queued";
      return true;
    }
    return false;
  }

  /** Leads awaiting a human decision or approved-but-not-yet-sent. */
  outbox(filter?: OutreachStatus): StoredLead[] {
    const want = filter ? [filter] : ["queued", "approved"];
    return this.db.leads
      .filter((l) => want.includes(l.outreachStatus ?? "none"))
      .sort((a, b) => b.score - a.score);
  }

  setOutreach(leadId: string, status: OutreachStatus): boolean {
    const l = this.db.leads.find((x) => x.id === leadId);
    if (!l) return false;
    l.outreachStatus = status;
    this.save();
    return true;
  }

  /** Mark an approved lead as sent and log it for the daily cap. */
  recordSend(tenantId: string, leadId: string, via: string, now: string) {
    const l = this.db.leads.find((x) => x.id === leadId);
    if (l) {
      l.outreachStatus = "sent";
      l.sentAt = now;
      l.sentVia = via;
      if (l.status === "NEW" || l.status === "DELIVERED") l.status = "SENT";
    }
    this.db.sends.push({ tenantId, leadId, via, at: now });
  }

  /** Count sends for a tenant since an ISO timestamp (daily-cap enforcement). */
  sentCountSince(tenantId: string, sinceISO: string): number {
    return this.db.sends.filter((s) => s.tenantId === tenantId && s.at >= sinceISO).length;
  }

  // -- autonomous execution ----------------------------------------------

  /** Won leads not yet executed — the queue for the execution engine. */
  executableLeads(): StoredLead[] {
    return this.db.leads.filter((l) => l.status === "WON" && !l.executionStatus);
  }

  recordExecution(leadId: string, gate: "auto" | "review", confidence: number, ref: string, capability?: string) {
    const l = this.db.leads.find((x) => x.id === leadId);
    if (l) {
      l.executionStatus = gate;
      l.executionConfidence = confidence;
      l.deliverableRef = ref;
      if (capability) l.executionCapability = capability;
    }
  }

  /** Record the client's verdict on a delivered job — fuel for quality learning. */
  recordExecutionOutcome(leadId: string, outcome: ExecOutcome): boolean {
    const l = this.db.leads.find((x) => x.id === leadId);
    if (!l) return false;
    l.executionOutcome = outcome;
    this.save();
    return true;
  }

  /** Labeled samples (capability + outcome) for execution-quality training. */
  executionQualitySamples(): QualitySample[] {
    return this.db.leads
      .filter((l) => l.executionOutcome && l.executionCapability)
      .map((l) => ({ capability: l.executionCapability!, outcome: l.executionOutcome! }));
  }

  /** Per-category timeline (by lead creation day) for demand forecasting. */
  leadTimeline(): { category: string; source: string; date: string }[] {
    return this.db.leads.map((l) => ({
      category: l.signalCategories?.[0] ?? "(brak)",
      source: l.signalSource ?? "(brak)",
      date: (l.createdAt ?? "").slice(0, 10),
    }));
  }

  /** Executed leads with their deliverable references (for the operator report). */
  deliverables(): { id: string; tenantId: string; title: string; gate?: string; confidence?: number; outcome?: string; capability?: string; ref?: string }[] {
    return this.db.leads
      .filter((l) => l.deliverableRef)
      .map((l) => ({
        id: l.id, tenantId: l.tenantId, title: l.signalTitle,
        gate: l.executionStatus, confidence: l.executionConfidence,
        outcome: l.executionOutcome, capability: l.executionCapability, ref: l.deliverableRef,
      }));
  }

  /** Flatten leads into P&L facts for the strategy meta-optimizer. */
  leadFacts(): LeadFact[] {
    return this.db.leads.map((l) => ({
      category: l.signalCategories?.[0] ?? "(brak)",
      source: l.signalSource ?? "(brak)",
      tenantId: l.tenantId,
      status: l.status,
      budget: l.signalBudget,
      sent: l.outreachStatus === "sent",
      executed: Boolean(l.executionStatus),
      executionOutcome: l.executionOutcome,
    }));
  }

  // -- RL-lite ranking (closed loop: outcomes → learned arm values) --------
  getRankTable(ns: string): RankTable {
    return this.db.rankTables[ns] ?? {};
  }
  updateRank(ns: string, arm: string, reward: number) {
    const t = this.db.rankTables[ns] ?? {};
    rankUpdate(t, arm, reward);
    this.db.rankTables[ns] = t;
  }
  rankedArms(ns: string) {
    return rank(this.getRankTable(ns));
  }

  /** Advance a lead's negotiation: record the client's latest offer, return the
   * new (1-based) round number. Idempotent persistence handled by caller. */
  bumpNegotiation(leadId: string, clientOffer: number): number {
    const l = this.db.leads.find((x) => x.id === leadId);
    if (!l) return 0;
    l.negotiationRound = (l.negotiationRound ?? 0) + 1;
    l.lastClientOffer = clientOffer;
    return l.negotiationRound;
  }

  getQualityModel(): QualityModel | undefined {
    return this.db.qualityModel;
  }
  setQualityModel(model: QualityModel) {
    this.db.qualityModel = model;
  }

  // -- learned pricing weights (calibrated from real win/loss history) -----
  getPriceWeights(): PriceWeights | undefined {
    return this.db.priceWeights;
  }
  setPriceWeights(w: PriceWeights) {
    this.db.priceWeights = w;
  }

  // -- self-improving scoring --------------------------------------------

  /** Labeled examples from outcomes: WON/REPLIED = pos, REJECTED = neg. */
  trainingExamples(tenantId: string): LabeledExample[] {
    const out: LabeledExample[] = [];
    for (const l of this.db.leads) {
      if (l.tenantId !== tenantId) continue;
      if (l.status === "WON" || l.status === "REPLIED") out.push({ keywords: l.matchedKeywords, label: "pos" });
      else if (l.status === "REJECTED") out.push({ keywords: l.matchedKeywords, label: "neg" });
    }
    return out;
  }

  getLearned(tenantId: string): LearnedModel | undefined {
    return this.db.learned[tenantId];
  }

  setLearned(tenantId: string, model: LearnedModel) {
    this.db.learned[tenantId] = model;
  }

  setSourceState(name: string, state: SourceState) {
    this.db.sourceState[name] = state;
  }

  getSourceState(name: string): SourceState | undefined {
    return this.db.sourceState[name];
  }

  stats() {
    const byStatus: Record<string, number> = {};
    const byOutreach: Record<string, number> = {};
    for (const l of this.db.leads) {
      byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
      const o = l.outreachStatus ?? "none";
      byOutreach[o] = (byOutreach[o] ?? 0) + 1;
    }
    return {
      signalsSeen: Object.keys(this.db.seenSignals).length,
      leads: this.db.leads.length,
      deliveries: this.db.deliveries.length,
      sends: this.db.sends.length,
      byStatus,
      byOutreach,
      sources: this.db.sourceState,
    };
  }

  save() {
    this.persist();
  }
}
