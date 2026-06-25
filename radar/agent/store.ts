// Persistent, dependency-free store for the autonomous agent.
// Survives restarts via a single JSON file (default: radar/data/store.json).
// In production the same interface is backed by Prisma/Postgres (apps/web/lib).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Lead, Signal } from "../packages/core/src/index.ts";

export interface StoredLead extends Lead {
  id: string;
  signalTitle: string;
  signalUrl: string;
  signalBudget?: number;
  draftSubject?: string;
  draftBody?: string;
  status: "NEW" | "DELIVERED" | "SENT" | "REPLIED" | "WON" | "REJECTED";
  delivered: boolean;
}

interface Db {
  seq: number;
  seenSignals: Record<string, { id: string; firstSeen: string }>;
  leads: StoredLead[];
  deliveries: { id: string; tenantId: string; leadIds: string[]; channel: string; at: string }[];
  sourceState: Record<string, { lastRunAt?: string; lastError?: string; healthy: boolean }>;
}

const EMPTY: Db = { seq: 0, seenSignals: {}, leads: [], deliveries: [], sourceState: {} };

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

  setSourceState(name: string, state: { lastRunAt?: string; lastError?: string; healthy: boolean }) {
    this.db.sourceState[name] = state;
  }

  stats() {
    const byStatus: Record<string, number> = {};
    for (const l of this.db.leads) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    return {
      signalsSeen: Object.keys(this.db.seenSignals).length,
      leads: this.db.leads.length,
      deliveries: this.db.deliveries.length,
      byStatus,
      sources: this.db.sourceState,
    };
  }

  save() {
    this.persist();
  }
}
