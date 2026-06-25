// The autonomous cycle: crawl -> normalize -> dedupe (vs persistent store) ->
// enrich (AI) -> score per tenant -> persist leads -> generate drafts ->
// deliver digests. Fully unattended. Returns metrics for logging.

import {
  buildProposal,
  dedupe,
  matchSignal,
  toSignal,
  type Signal,
} from "../packages/core/src/index.ts";
import { loadConfig, resolveFeed, tenantICP, type AgentConfig } from "./config.ts";
import { fetchListings } from "./fetch.ts";
import { enrich, TAXONOMY } from "./enrich.ts";
import { deliver } from "./deliver.ts";
import { Store } from "./store.ts";

export interface CycleMetrics {
  startedAt: string;
  sources: { name: string; raw: number; ok: boolean; error?: string }[];
  uniqueFresh: number;
  newSignals: number;
  leadsCreated: number;
  digests: { tenant: string; leads: number; ref: string }[];
  durationMs: number;
}

export async function runCycle(store: Store, cfg: AgentConfig, now: number): Promise<CycleMetrics> {
  const startedAt = new Date(now).toISOString();
  const t0 = performance.now();
  const sourcesMeta: CycleMetrics["sources"] = [];
  const collected: Signal[] = [];

  // 1) Crawl + normalize every enabled source.
  for (const src of cfg.sources.filter((s) => s.enabled)) {
    try {
      const listings = await fetchListings(resolveFeed(src.feed));
      for (const raw of listings) {
        const e = await enrich(raw.title, raw.body);
        const sig = toSignal(
          { ...raw, lang: e.lang, rawBudget: e.budget ? `${e.budget} zł` : raw.rawBudget },
          src.kind,
          src.name,
          "tmp",
          now,
          TAXONOMY,
        );
        if (e.categories.length) sig.categories = e.categories;
        collected.push(sig);
      }
      sourcesMeta.push({ name: src.name, raw: listings.length, ok: true });
      store.setSourceState(src.name, { lastRunAt: startedAt, healthy: true });
    } catch (err) {
      const error = (err as Error).message;
      sourcesMeta.push({ name: src.name, raw: 0, ok: false, error });
      store.setSourceState(src.name, { lastRunAt: startedAt, lastError: error, healthy: false });
    }
  }

  // 2) Dedupe within batch, then drop anything already seen in prior runs.
  const fresh = dedupe(collected).filter((s) => !store.hasSeen(s.dedupeKey));
  let leadsCreated = 0;
  const icps = cfg.tenants.map((t) => ({ tenant: t, icp: tenantICP(t) }));

  // 3) Persist signals + score against every tenant ICP -> leads + drafts.
  for (const sig of fresh) {
    const sigId = store.recordSignal(sig, startedAt);
    const withId: Signal = { ...sig, id: sigId };
    for (const { tenant, icp } of icps) {
      const [lead] = matchSignal(withId, [icp], { now, threshold: cfg.settings.threshold });
      if (!lead) continue;
      const draft = buildProposal(withId, tenant.sender);
      store.upsertLead({
        ...lead,
        signalTitle: sig.title,
        signalUrl: sig.url,
        signalBudget: sig.budget,
        draftSubject: draft.subject,
        draftBody: draft.body,
      });
      leadsCreated++;
    }
  }

  // 4) Deliver undelivered leads per tenant (idempotent).
  const digests: CycleMetrics["digests"] = [];
  for (const t of cfg.tenants) {
    const pending = store.undeliveredLeads(t.id).slice(0, cfg.settings.maxLeadsPerDigest);
    if (!pending.length) continue;
    const res = await deliver(t, pending, startedAt);
    store.markDelivered(t.id, pending.map((l) => l.id), res.channel, startedAt);
    digests.push({ tenant: t.id, leads: pending.length, ref: res.ref });
  }

  store.save();
  return {
    startedAt,
    sources: sourcesMeta,
    uniqueFresh: fresh.length,
    newSignals: fresh.length,
    leadsCreated,
    digests,
    durationMs: Math.round(performance.now() - t0),
  };
}

/** Convenience entry used by CLI/daemon: load config + store, run one cycle. */
export async function runOnce(store: Store, now = Date.now()): Promise<CycleMetrics> {
  return runCycle(store, loadConfig(), now);
}
