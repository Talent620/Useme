// Source-adapter helpers: turn a raw public listing into a normalized Signal.
// Pure functions (no network) so they are unit-testable; the worker handles I/O.

import type { Signal, SourceKind } from "../signals/types.ts";
import { dedupeKey } from "../signals/dedup.ts";

export interface RawListing {
  url: string;
  title: string;
  body: string;
  publishedAt?: string;
  lang?: string;
  rawBudget?: string; // free text like "Budżet: 1 500 zł" or "$800"
}

/** Extract a PLN budget from free text. Handles "1 500 zł", "2000 PLN", "$800". */
export function extractBudget(text: string): number | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/ /g, " ");
  // PLN / zł amounts (allow thousands separators).
  const pln = cleaned.match(/(\d[\d\s.,]*)\s*(zł|zl|pln)/i);
  if (pln) {
    const n = toNumber(pln[1]);
    if (n) return n;
  }
  // USD as a rough fallback (~4 PLN/USD) so cross-currency boards still score.
  const usd = cleaned.match(/\$\s*(\d[\d\s.,]*)/);
  if (usd) {
    const n = toNumber(usd[1]);
    if (n) return Math.round(n * 4);
  }
  return undefined;
}

function toNumber(s: string): number | undefined {
  const digits = s.replace(/[\s.]/g, "").replace(",", ".");
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** Naive category tagging from a keyword map. The AI layer refines this later. */
export function tagCategories(text: string, taxonomy: Record<string, string[]>): string[] {
  const lower = text.toLowerCase();
  const tags: string[] = [];
  for (const [cat, terms] of Object.entries(taxonomy)) {
    if (terms.some((t) => lower.includes(t))) tags.push(cat);
  }
  return tags;
}

export function detectLang(text: string): string {
  // Cheap heuristic: presence of Polish-specific characters/words => pl.
  return /[ąćęłńóśźż]|\b(szukam|zlecę|potrzebuję|firma)\b/i.test(text) ? "pl" : "en";
}

export function toSignal(
  raw: RawListing,
  source: SourceKind,
  sourceName: string,
  id: string,
  now: number,
  taxonomy: Record<string, string[]> = {},
): Signal {
  const lang = raw.lang ?? detectLang(`${raw.title} ${raw.body}`);
  const budget = extractBudget(raw.rawBudget ?? raw.body);
  const categories = tagCategories(`${raw.title} ${raw.body}`, taxonomy);
  return {
    id,
    source,
    sourceName,
    url: raw.url,
    title: raw.title.trim(),
    body: raw.body.trim(),
    publishedAt: raw.publishedAt ?? new Date(now).toISOString(),
    fetchedAt: new Date(now).toISOString(),
    lang,
    budget,
    categories,
    dedupeKey: dedupeKey(raw.title, budget),
  };
}
