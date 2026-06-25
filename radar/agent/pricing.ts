// Dynamic pricing — win-probability + recommended bid/margin. A small logistic
// model (deterministic, explainable) estimates the chance of winning at a given
// price, then a grid search maximizes expected value (price × P(win) − cost).
// Weights have sane defaults and can be tuned from win/loss history. No LLM.

export interface PriceFeatures {
  /** Lead intent score 0..100. */
  score: number;
  /** Historical win rate for this category/source (0..1). */
  histWinRate: number;
  /** Competition pressure 0..1 (more rivals → lower win prob). */
  competition: number;
}

export interface PriceWeights {
  bias: number;
  score: number;
  histWinRate: number;
  priceFraction: number; // negative effect: higher price → lower win prob
  competition: number; // negative effect
}

export const DEFAULT_WEIGHTS: PriceWeights = { bias: 1.2, score: 1.5, histWinRate: 2.0, priceFraction: 3.2, competition: 1.8 };

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** P(win) at priceFraction (price as a fraction of the client's budget). */
export function winProbability(priceFraction: number, f: PriceFeatures, w: PriceWeights = DEFAULT_WEIGHTS): number {
  const z = w.bias + w.score * (f.score / 100) + w.histWinRate * f.histWinRate - w.priceFraction * (priceFraction - 0.7) - w.competition * f.competition;
  return Math.round(sigmoid(z) * 1000) / 1000;
}

export interface BidRecommendation {
  price: number;
  fraction: number; // of budget
  winProbability: number;
  expectedValue: number;
  marginPct: number;
}

/**
 * Recommend a bid that maximizes expected value over a grid of price fractions.
 * `cost` is our cost to deliver (for margin). `budget` anchors the scale; if
 * unknown we use a reference so the fraction still maps to a concrete price.
 */
export function recommendBid(budget: number | undefined, cost: number, f: PriceFeatures, w: PriceWeights = DEFAULT_WEIGHTS): BidRecommendation {
  const base = budget && budget > 0 ? budget : 2000;
  let best: BidRecommendation | null = null;
  for (let frac = 0.4; frac <= 1.2 + 1e-9; frac += 0.05) {
    const price = Math.round(base * frac);
    const p = winProbability(frac, f, w);
    const ev = Math.round(price * p - cost);
    const marginPct = price ? Math.round(((price - cost) / price) * 100) : 0;
    if (!best || ev > best.expectedValue) best = { price, fraction: Math.round(frac * 100) / 100, winProbability: p, expectedValue: ev, marginPct };
  }
  return best!;
}

/** Competition proxy from how many similar fresh signals exist (0..1). */
export function competitionScore(similarCount: number): number {
  return Math.min(1, similarCount / 10);
}
