// Self-improving scoring. Learns which keywords correlate with WON vs REJECTED
// outcomes and produces a per-tenant weight overlay. Deterministic, explainable
// (smoothed log-odds — Naive-Bayes-style), zero ML deps, fully unit-tested.

import { normalizeForHash } from "./signals/dedup.ts";
import type { LearnedModel } from "./signals/types.ts";

export interface LabeledExample {
  /** Keywords that matched on the lead (already the scorer's matchedKeywords). */
  keywords: string[];
  label: "pos" | "neg"; // pos = WON/REPLIED, neg = REJECTED
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Train a model from labeled examples.
 * weight(k) = log( (pos_k + 0.5) / (neg_k + 0.5) ), clamped to [-2, 2].
 * Laplace smoothing (0.5) keeps single-example features from exploding.
 */
export function trainModel(examples: LabeledExample[], now?: number): LearnedModel {
  const pos: Record<string, number> = {};
  const neg: Record<string, number> = {};
  for (const ex of examples) {
    const bucket = ex.label === "pos" ? pos : neg;
    for (const k of new Set(ex.keywords.map(normalizeForHash))) {
      bucket[k] = (bucket[k] ?? 0) + 1;
    }
  }
  const keys = new Set([...Object.keys(pos), ...Object.keys(neg)]);
  const keywordWeights: Record<string, number> = {};
  for (const k of keys) {
    const p = (pos[k] ?? 0) + 0.5;
    const n = (neg[k] ?? 0) + 0.5;
    const w = clamp(Math.log(p / n), -2, 2);
    if (Math.abs(w) >= 0.05) keywordWeights[k] = Math.round(w * 1000) / 1000;
  }
  return {
    keywordWeights,
    trainedOn: examples.length,
    updatedAt: now != null ? new Date(now).toISOString() : undefined,
  };
}

/**
 * Score boost from a learned model for the keywords that matched a signal.
 * Each unit of log-odds is worth ~5 points; bounded to ±maxAbs so learning
 * nudges ranking without overriding the deterministic base.
 */
export function learnedBoost(
  matchedKeywords: string[],
  model: LearnedModel | undefined,
  maxAbs = 15,
): number {
  if (!model) return 0;
  let sum = 0;
  for (const k of matchedKeywords.map(normalizeForHash)) {
    sum += model.keywordWeights[k] ?? 0;
  }
  return clamp(Math.round(sum * 5 * 10) / 10, -maxAbs, maxAbs);
}
