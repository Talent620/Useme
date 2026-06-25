// Web fetch tool for executors. Supports http(s) (live) and file: (local
// fixtures / offline demos & tests). Polite: custom UA + timeout.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../../config.ts";

const UA = process.env.CRAWL_USER_AGENT ?? "RadarPL/0.1 (+https://radar.pl/bot)";
const TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS ?? "12000");

/** Extract the first URL (http(s) or file:) mentioned in free text. */
export function firstUrl(text: string): string | undefined {
  const m = text.match(/\b(?:https?:\/\/|file:)[^\s)<>"']+/i);
  return m?.[0];
}

export async function fetchHtml(url: string): Promise<string> {
  if (url.startsWith("file:")) {
    return readFileSync(resolve(ROOT, url.slice("file:".length)), "utf8");
  }
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
