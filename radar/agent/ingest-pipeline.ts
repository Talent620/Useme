// Shared ingest pipeline for the production (repo-backed) path. Pure w.r.t.
// storage — takes any LeadRepo. Used by the web /api/ingest route. Mirrors the
// agent cycle's logic so file-mode and Postgres-mode behave identically.

import {
  buildProposal,
  matchSignal,
  toSignal,
  type RawListing,
  type SourceKind,
} from "../packages/core/src/index.ts";
import type { SenderProfile } from "../packages/core/src/proposal/template.ts";
import type { LeadRepo } from "./repo.ts";

export interface IngestBatch {
  sourceName: string;
  kind: SourceKind;
  listings: RawListing[];
  /** Optional per-tenant sender profiles for draft generation. */
  senders?: Record<string, SenderProfile>;
}

export interface IngestResult {
  received: number;
  created: number;
  leads: number;
}

export async function ingest(
  repo: LeadRepo,
  batch: IngestBatch,
  now = Date.now(),
  threshold = 45,
): Promise<IngestResult> {
  const icps = await repo.listActiveICPs();
  let created = 0;
  let leads = 0;

  for (const raw of batch.listings) {
    const sig = toSignal(raw, batch.kind, batch.sourceName, "tmp", now);
    if (await repo.hasSignal(sig.dedupeKey)) continue;

    const { id } = await repo.createSignal(sig);
    created++;
    const withId = { ...sig, id };

    for (const lead of matchSignal(withId, icps, { now, threshold })) {
      const sender = batch.senders?.[lead.tenantId];
      const draft = sender ? buildProposal(withId, sender) : undefined;
      await repo.upsertLead({
        tenantId: lead.tenantId,
        icpId: lead.icpId,
        signalId: id,
        score: lead.score,
        reasons: lead.reasons,
        matchedKeywords: lead.matchedKeywords,
        draftSubject: draft?.subject,
        draftBody: draft?.body,
      });
      leads++;
    }
  }
  return { received: batch.listings.length, created, leads };
}
