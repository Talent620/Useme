// Source fetcher for the agent. Supports local fixtures (file:) and live
// feeds (http/https). Live fetch is polite: custom UA + timeout.

import { readFileSync } from "node:fs";
import type { RawListing } from "../packages/core/src/index.ts";
import { parseFeed } from "../apps/worker/src/rss.ts";

const UA = process.env.CRAWL_USER_AGENT ?? "RadarPL/0.1 (+https://radar.pl/bot)";
const TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS ?? "12000");

export async function fetchListings(resolvedFeed: string): Promise<RawListing[]> {
  if (resolvedFeed.startsWith("http")) {
    const res = await fetch(resolvedFeed, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseFeed(await res.text());
  }
  // Local fixture (also used for tests and offline dry-runs).
  return parseFeed(readFileSync(resolvedFeed, "utf8"));
}
