// The autonomous cycle: crawl -> normalize -> dedupe (vs persistent store) ->
// enrich (AI) -> score per tenant -> persist leads -> generate drafts ->
// deliver digests. Fully unattended. Returns metrics for logging.

import {
  buildProposal,
  dedupe,
  matchSignal,
  toSignal,
  trainModel,
  type Signal,
} from "../packages/core/src/index.ts";
import { DEFAULT_LEARN, DEFAULT_OUTREACH, loadConfig, resolveFeed, tenantICP, type AgentConfig } from "./config.ts";
import { effectiveAutoApprove, effectiveDigestCap } from "./billing.ts";
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
  queuedForOutreach: number;
  digests: { tenant: string; leads: number; ref: string }[];
  durationMs: number;
}

export async function runCycle(store: Store, cfg: AgentConfig, now: number): Promise<CycleMetrics> {
  const startedAt = new Date(now).toISOString();
  const t0 = performance.now();
  const outreach = cfg.settings.outreach ?? DEFAULT_OUTREACH;
  const sourcesMeta: CycleMetrics["sources"] = [];
  const collected: Signal[] = [];
  let queuedForOutreach = 0;

  // 1) Crawl + normalize every enabled source (conditional GET via SourceState).
  for (const src of cfg.sources.filter((s) => s.enabled)) {
    try {
      const prevState = store.getSourceState(src.name);
      const result = await fetchListings(resolveFeed(src.feed), {
        etag: prevState?.etag,
        lastModified: prevState?.lastModified,
      });
      if (result.notModified) {
        sourcesMeta.push({ name: src.name, raw: 0, ok: true });
        store.setSourceState(src.name, { ...prevState, lastRunAt: startedAt, healthy: true });
        continue;
      }
      const listings = result.listings;
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
      store.setSourceState(src.name, {
        lastRunAt: startedAt,
        healthy: true,
        etag: result.etag,
        lastModified: result.lastModified,
      });
    } catch (err) {
      const error = (err as Error).message;
      sourcesMeta.push({ name: src.name, raw: 0, ok: false, error });
      store.setSourceState(src.name, { lastRunAt: startedAt, lastError: error, healthy: false });
    }
  }

  // 2) Dedupe within batch, then drop anything already seen in prior runs.
  const fresh = dedupe(collected).filter((s) => !store.hasSeen(s.dedupeKey));
  let leadsCreated = 0;
  // Attach each tenant's learned overlay so scoring reflects past outcomes.
  const learn = cfg.settings.learn ?? DEFAULT_LEARN;
  const icps = cfg.tenants.map((t) => {
    const icp = tenantICP(t);
    const model = store.getLearned(t.id);
    if (model && model.trainedOn >= learn.minExamples) icp.learned = model;
    return { tenant: t, icp };
  });

  // 3) Persist signals + score against every tenant ICP -> leads + drafts.
  for (const sig of fresh) {
    const sigId = store.recordSignal(sig, startedAt);
    const withId: Signal = { ...sig, id: sigId };
    for (const { tenant, icp } of icps) {
      const [lead] = matchSignal(withId, [icp], { now, threshold: cfg.settings.threshold });
      if (!lead) continue;
      const draft = buildProposal(withId, tenant.sender);
      const stored = store.upsertLead({
        ...lead,
        signalTitle: sig.title,
        signalUrl: sig.url,
        signalBudget: sig.budget,
        draftSubject: draft.subject,
        draftBody: draft.body,
      });
      leadsCreated++;
      // High-confidence leads enter the outreach pipeline. Auto-approve only if
      // the tenant's plan allows it (PRO+).
      if (outreach.enabled && stored.score >= outreach.threshold) {
        const auto = effectiveAutoApprove(tenant.plan, outreach.autoApprove);
        if (store.queueOutreach(stored.id, auto)) queuedForOutreach++;
      }
    }
  }

  // 4) Deliver undelivered leads per tenant (idempotent).
  const digests: CycleMetrics["digests"] = [];
  for (const t of cfg.tenants) {
    const cap = effectiveDigestCap(t.plan, cfg.settings.maxLeadsPerDigest);
    const pending = store.undeliveredLeads(t.id).slice(0, cap);
    if (!pending.length) continue;
    const res = await deliver(t, pending, startedAt);
    store.markDelivered(t.id, pending.map((l) => l.id), res.channel, startedAt);
    digests.push({ tenant: t.id, leads: pending.length, ref: res.ref });
  }

  // 5) Auto-train per-tenant models from accumulated outcomes (cheap, optional).
  if (learn.autoTrain) {
    for (const t of cfg.tenants) {
      const examples = store.trainingExamples(t.id);
      if (examples.length >= learn.minExamples) {
        store.setLearned(t.id, trainModel(examples, now));
      }
    }
  }

  store.save();
  return {
    startedAt,
    sources: sourcesMeta,
    uniqueFresh: fresh.length,
    newSignals: fresh.length,
    leadsCreated,
    queuedForOutreach,
    digests,
    durationMs: Math.round(performance.now() - t0),
  };
}

/** Convenience entry used by CLI/daemon: load config + store, run one cycle. */
export async function runOnce(store: Store, now = Date.now()): Promise<CycleMetrics> {
  return runCycle(store, loadConfig(), now);
}
