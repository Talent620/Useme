// In-memory LeadRepo — the reference implementation. Used in tests and as a
// zero-infra fallback for the web app when DATABASE_URL is unset (local dev).

import type { ICP, Signal } from "../packages/core/src/index.ts";
import type { LeadRepo, LeadView, ListLeadsOptions, UpsertLeadInput } from "./repo.ts";

interface Row extends UpsertLeadInput {
  id: string;
  status: string;
  signalTitle: string;
  signalUrl: string;
  signalBudget?: number;
}

export class InMemoryLeadRepo implements LeadRepo {
  private signals = new Map<string, Signal & { id: string }>(); // by dedupeKey
  private leads: Row[] = [];
  private icps: ICP[];
  private seq = 0;

  constructor(icps: ICP[] = []) {
    this.icps = icps;
  }

  async hasSignal(dedupeKey: string): Promise<boolean> {
    return this.signals.has(dedupeKey);
  }

  async createSignal(signal: Signal): Promise<{ id: string }> {
    const id = `sig_${++this.seq}`;
    this.signals.set(signal.dedupeKey, { ...signal, id });
    return { id };
  }

  async listActiveICPs(): Promise<ICP[]> {
    return this.icps;
  }

  async upsertLead(input: UpsertLeadInput): Promise<void> {
    const existing = this.leads.find(
      (l) => l.tenantId === input.tenantId && l.signalId === input.signalId && l.icpId === input.icpId,
    );
    const signal = [...this.signals.values()].find((s) => s.id === input.signalId);
    if (existing) {
      existing.score = input.score;
      existing.reasons = input.reasons;
      return;
    }
    this.leads.push({
      ...input,
      id: `lead_${++this.seq}`,
      status: "NEW",
      signalTitle: signal?.title ?? "",
      signalUrl: signal?.url ?? "",
      signalBudget: signal?.budget,
    });
  }

  async listLeads(tenantId: string, opts: ListLeadsOptions = {}): Promise<LeadView[]> {
    const min = opts.min ?? 0;
    return this.leads
      .filter((l) => l.tenantId === tenantId && l.score >= min && (!opts.status || l.status === opts.status))
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit ?? 100)
      .map((l) => ({
        id: l.id, tenantId: l.tenantId, signalId: l.signalId, score: l.score,
        reasons: l.reasons, matchedKeywords: l.matchedKeywords, status: l.status,
        signalTitle: l.signalTitle, signalUrl: l.signalUrl, signalBudget: l.signalBudget,
      }));
  }
}
