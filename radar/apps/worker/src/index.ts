// Ingestion worker: crawl -> normalize -> dedupe -> enrich (AI) -> score ->
// persist leads -> enqueue deliveries. Runs on a schedule (cron / n8n / BullMQ).
//
// This file wires the real @radar/core domain logic into I/O (HTTP + Prisma +
// Redis). DB/queue clients are imported lazily so `pnpm test` on core stays
// dependency-free.

import {
  dedupe,
  matchSignal,
  toSignal,
  type ICP,
  type Signal,
} from "@radar/core";
import { fetchFeed } from "./rss.ts";
import { enrich } from "./enrich.ts";
import { SOURCES, TAXONOMY } from "./sources.ts";

const USER_AGENT = process.env.CRAWL_USER_AGENT ?? "RadarPL/0.1";

/** One crawl cycle. Returns the leads produced (for logging/metrics). */
export async function runCycle(
  loadIcps: () => Promise<ICP[]>,
  persistSignal: (s: Signal) => Promise<boolean>, // false if dedupeKey already known
  persistLead: (lead: ReturnType<typeof matchSignal>[number], draft?: { subject: string; body: string }) => Promise<void>,
  now: number,
): Promise<{ signals: number; newSignals: number; leads: number }> {
  const icps = await loadIcps();
  let rawCount = 0;
  const fresh: Signal[] = [];

  for (const src of SOURCES.filter((s) => s.enabled)) {
    try {
      const listings = await fetchFeed(src.feed, USER_AGENT);
      rawCount += listings.length;
      for (const raw of listings) {
        const e = await enrich(raw, TAXONOMY);
        const sig = toSignal(
          { ...raw, lang: e.lang, rawBudget: e.budget ? `${e.budget} zł` : raw.rawBudget },
          src.kind,
          src.name,
          cryptoId(),
          now,
          TAXONOMY,
        );
        sig.categories = e.categories.length ? e.categories : sig.categories;
        fresh.push(sig);
      }
    } catch (err) {
      console.error(`[crawl] ${src.name} failed:`, (err as Error).message);
    }
  }

  const unique = dedupe(fresh);
  let leadCount = 0;
  let newSignals = 0;

  for (const sig of unique) {
    const isNew = await persistSignal(sig);
    if (!isNew) continue;
    newSignals++;
    for (const lead of matchSignal(sig, icps, { now, threshold: 45 })) {
      await persistLead(lead);
      leadCount++;
    }
  }

  console.log(
    `[cycle] sources=${SOURCES.filter((s) => s.enabled).length} raw=${rawCount} unique=${unique.length} new=${newSignals} leads=${leadCount}`,
  );
  return { signals: unique.length, newSignals, leads: leadCount };
}

function cryptoId(): string {
  // Stable-ish id without extra deps; Prisma assigns the real cuid on persist.
  return "sig_" + Math.abs(hashStr(String(performance.now()))).toString(36);
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// Entry point when run directly (cron job). Persistence adapters are injected
// from ./db.ts in the deployed build; omitted here to keep core test-only deps.
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("[worker] RadarPL ingestion worker — wire ./db.ts adapters to run a live cycle.");
}
