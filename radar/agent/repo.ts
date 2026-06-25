// Production persistence abstraction for the multi-tenant SaaS path.
//
// The single-node autonomous agent uses the file-backed Store (zero infra).
// The web app / multi-node deployment uses a Postgres-backed LeadRepo. Both
// share the SAME core scoring/matching — only the storage differs. This async
// interface is implemented by InMemoryLeadRepo (tested here) and PrismaLeadRepo
// (production). Keeping it async makes Postgres a drop-in.

import type { ICP, Signal } from "../packages/core/src/index.ts";

export interface LeadView {
  id: string;
  tenantId: string;
  signalId: string;
  score: number;
  reasons: string[];
  matchedKeywords: string[];
  status: string;
  signalTitle: string;
  signalUrl: string;
  signalBudget?: number;
}

export interface UpsertLeadInput {
  tenantId: string;
  icpId: string;
  signalId: string;
  score: number;
  reasons: string[];
  matchedKeywords: string[];
  draftSubject?: string;
  draftBody?: string;
}

export interface ListLeadsOptions {
  min?: number;
  status?: string;
  limit?: number;
}

export interface LeadRepo {
  /** True if a signal with this dedupeKey already exists (idempotent ingest). */
  hasSignal(dedupeKey: string): Promise<boolean>;
  /** Persist a signal, returning its stable id. */
  createSignal(signal: Signal): Promise<{ id: string }>;
  /** Active ICPs across all tenants (for scoring an incoming signal). */
  listActiveICPs(): Promise<ICP[]>;
  /** Idempotent upsert on (tenantId, signalId, icpId). */
  upsertLead(input: UpsertLeadInput): Promise<void>;
  /** Leads for a tenant, highest intent first. */
  listLeads(tenantId: string, opts?: ListLeadsOptions): Promise<LeadView[]>;
}
