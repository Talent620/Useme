// Buying-intent scoring. Deterministic, explainable, unit-tested.
// The AI layer (enrichment) feeds normalized fields in; scoring stays pure
// so it is cheap, reproducible, and auditable.

import {
  DEFAULT_SOURCE_WEIGHTS,
  INTENT_TERMS,
  type ICP,
  type Signal,
} from "./types.ts";
import { normalizeForHash } from "./dedup.ts";

export interface ScoreResult {
  score: number; // 0..100
  reasons: string[];
  matchedKeywords: string[];
}

const HOUR = 3600_000;

/** Recency factor in [0,1]: full weight < 24h, decays to ~0 over ~14 days. */
export function recencyFactor(publishedAt: string, now: number): number {
  const ageH = Math.max(0, (now - Date.parse(publishedAt)) / HOUR);
  if (ageH <= 24) return 1;
  const decayH = 14 * 24;
  return Math.max(0, 1 - (ageH - 24) / decayH);
}

function countMatches(haystack: string, needles: string[]): string[] {
  const found: string[] = [];
  for (const n of needles) {
    if (n && haystack.includes(n)) found.push(n);
  }
  return found;
}

/**
 * Score a single signal against one ICP.
 * Composition (weighted, then scaled to 0..100):
 *   - source trust          (0..25)
 *   - intent term density    (0..25)
 *   - ICP keyword match      (0..30)
 *   - budget fit             (0..10)
 *   - recency                (x multiplier 0..1 over the above)
 *   - category overlap       (0..10)
 */
export function scoreSignal(signal: Signal, icp: ICP, now: number): ScoreResult {
  const reasons: string[] = [];
  const text = normalizeForHash(`${signal.title} ${signal.body}`);

  // Hard excludes.
  const excluded = countMatches(text, icp.excludeKeywords.map(normalizeForHash));
  if (excluded.length) {
    return { score: 0, reasons: [`excluded: ${excluded.join(", ")}`], matchedKeywords: [] };
  }
  if (icp.langs.length && !icp.langs.includes(signal.lang)) {
    return { score: 0, reasons: [`lang ${signal.lang} not in ICP`], matchedKeywords: [] };
  }

  const weight =
    icp.sourceWeights?.[signal.source] ?? DEFAULT_SOURCE_WEIGHTS[signal.source];
  let raw = 0;

  const sourcePts = weight * 25;
  raw += sourcePts;
  reasons.push(`source ${signal.sourceName} trust ${weight.toFixed(2)}`);

  const intentHits = countMatches(text, INTENT_TERMS.map(normalizeForHash));
  const intentPts = Math.min(25, intentHits.length * 8);
  raw += intentPts;
  if (intentHits.length) reasons.push(`intent terms: ${intentHits.slice(0, 4).join(", ")}`);

  const kwHits = countMatches(text, icp.keywords.map(normalizeForHash));
  const kwPts = Math.min(30, kwHits.length * 12);
  raw += kwPts;
  if (kwHits.length) reasons.push(`ICP keywords: ${kwHits.join(", ")}`);

  let budgetPts = 0;
  if (signal.budget != null) {
    const okMin = icp.minBudget == null || signal.budget >= icp.minBudget;
    const okMax = icp.maxBudget == null || signal.budget <= icp.maxBudget;
    if (okMin && okMax) {
      budgetPts = 10;
      reasons.push(`budget ${signal.budget} PLN in range`);
    } else {
      reasons.push(`budget ${signal.budget} PLN out of range`);
    }
  }
  raw += budgetPts;

  const catOverlap = signal.categories.filter((c) =>
    icp.categories.map((x) => x.toLowerCase()).includes(c.toLowerCase()),
  );
  const catPts = Math.min(10, catOverlap.length * 5);
  raw += catPts;
  if (catOverlap.length) reasons.push(`categories: ${catOverlap.join(", ")}`);

  const recency = recencyFactor(signal.publishedAt, now);
  const score = Math.round(Math.min(100, raw) * recency);
  reasons.push(`recency x${recency.toFixed(2)}`);

  return { score, reasons, matchedKeywords: [...new Set([...kwHits, ...intentHits])] };
}
