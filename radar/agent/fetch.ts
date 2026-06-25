// Source fetcher. Supports local fixtures (file:) and live feeds (http/https).
// Live fetch is a good citizen: respects robots.txt, rate-limits per host, sends
// conditional GET (ETag/Last-Modified) so unchanged feeds cost nothing.

import { readFileSync } from "node:fs";
import type { RawListing } from "../packages/core/src/index.ts";
import { parseFeed } from "../apps/worker/src/rss.ts";
import { isAllowed, parseRobots, type RobotsRules } from "./robots.ts";
import { hostOf, RateLimiter, sleep } from "./ratelimit.ts";

const UA = process.env.CRAWL_USER_AGENT ?? "RadarPL/0.1 (+https://radar.pl/bot)";
const TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS ?? "12000");
const MIN_DELAY_MS = Number(process.env.CRAWL_MIN_DELAY_MS ?? "1500");

// Shared across a process (one crawl run). Host -> robots rules cache.
const limiter = new RateLimiter(MIN_DELAY_MS);
const robotsCache = new Map<string, RobotsRules | null>();

export interface FetchResult {
  listings: RawListing[];
  notModified: boolean;
  etag?: string;
  lastModified?: string;
}

export interface ConditionalHeaders {
  etag?: string;
  lastModified?: string;
}

export async function fetchListings(
  resolvedFeed: string,
  prev?: ConditionalHeaders,
): Promise<FetchResult> {
  if (!resolvedFeed.startsWith("http")) {
    // Local fixture (tests / offline dry-runs) — no politeness needed.
    return { listings: parseFeed(readFileSync(resolvedFeed, "utf8")), notModified: false };
  }

  const host = hostOf(resolvedFeed);
  if (!(await allowedByRobots(resolvedFeed, host))) {
    throw new Error(`robots.txt disallows ${resolvedFeed}`);
  }

  const wait = limiter.delayFor(host, Date.now());
  if (wait > 0) await sleep(wait);
  limiter.record(host, Date.now());

  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/rss+xml, application/atom+xml, application/xml",
  };
  if (prev?.etag) headers["If-None-Match"] = prev.etag;
  if (prev?.lastModified) headers["If-Modified-Since"] = prev.lastModified;

  const res = await fetch(resolvedFeed, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 304) {
    return { listings: [], notModified: true, etag: prev?.etag, lastModified: prev?.lastModified };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return {
    listings: parseFeed(await res.text()),
    notModified: false,
    etag: res.headers.get("etag") ?? undefined,
    lastModified: res.headers.get("last-modified") ?? undefined,
  };
}

async function allowedByRobots(url: string, host: string): Promise<boolean> {
  if (process.env.CRAWL_IGNORE_ROBOTS === "1") return true;
  let rules = robotsCache.get(host);
  if (rules === undefined) {
    rules = await loadRobots(host);
    robotsCache.set(host, rules);
  }
  if (rules === null) return true; // no robots.txt => allowed
  return isAllowed(rules, UA, new URL(url).pathname);
}

async function loadRobots(host: string): Promise<RobotsRules | null> {
  try {
    const res = await fetch(`https://${host}/robots.txt`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseRobots(await res.text());
  } catch {
    return null; // unreachable robots => fail open (but rate-limited anyway)
  }
}
