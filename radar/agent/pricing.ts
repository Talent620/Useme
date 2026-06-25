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

export interface PriceSample {
  priceFraction: number; // what we bid as a fraction of budget
  score: number; // lead intent 0..100
  win: boolean; // did we win the deal
}

export interface CalibrationResult {
  weights: PriceWeights;
  trainedOn: number;
  logLoss: number; // mean logistic loss on the training set
  updatedAt: string;
}

/**
 * Learn the price-elasticity weights (bias, score, priceFraction) from real
 * win/loss history via deterministic logistic regression (fixed iterations,
 * fixed lr, init = base weights, L2 toward base). histWinRate and competition
 * stay at base — they're contextual modifiers we don't observe historically.
 * Returns base unchanged below `minSamples` so a thin history can't destabilize.
 * No randomness, no LLM — same inputs → same weights.
 */
export function calibrateWeights(
  samples: PriceSample[],
  base: PriceWeights = DEFAULT_WEIGHTS,
  opts: { iterations?: number; lr?: number; l2?: number; minSamples?: number; at?: string } = {},
): CalibrationResult {
  const iterations = opts.iterations ?? 400;
  const lr = opts.lr ?? 0.3;
  const l2 = opts.l2 ?? 0.02;
  const minSamples = opts.minSamples ?? 8;
  const at = opts.at ?? "";

  if (samples.length < minSamples) {
    return { weights: base, trainedOn: samples.length, logLoss: logLoss(samples, base), updatedAt: at };
  }

  // Fit only b (bias), as (score weight), ap (priceFraction weight). The linear
  // predictor mirrors winProbability with histWinRate=competition=0:
  //   z = b + as·(score/100) − ap·(priceFraction − 0.7)
  let b = base.bias, as = base.score, ap = base.priceFraction;
  const n = samples.length;
  for (let it = 0; it < iterations; it++) {
    let gb = 0, gas = 0, gap = 0;
    for (const s of samples) {
      const xScore = s.score / 100;
      const xPf = s.priceFraction - 0.7;
      const z = b + as * xScore - ap * xPf;
      const p = 1 / (1 + Math.exp(-z));
      const err = p - (s.win ? 1 : 0);
      gb += err;
      gas += err * xScore;
      gap += err * -xPf;
    }
    // Mean gradient + L2 pull back toward the priors (keeps few-sample fits sane).
    b -= lr * (gb / n + l2 * (b - base.bias));
    as -= lr * (gas / n + l2 * (as - base.score));
    ap -= lr * (gap / n + l2 * (ap - base.priceFraction));
  }
  // priceFraction sensitivity is conceptually non-negative (higher price → lower
  // win prob); clamp to keep the recommender well-behaved.
  ap = Math.max(0, Math.round(ap * 1000) / 1000);
  const weights: PriceWeights = {
    ...base,
    bias: Math.round(b * 1000) / 1000,
    score: Math.round(as * 1000) / 1000,
    priceFraction: ap,
  };
  return { weights, trainedOn: n, logLoss: logLoss(samples, weights), updatedAt: at };
}

/** Mean logistic loss of a weight set over samples (lower = better fit). */
function logLoss(samples: PriceSample[], w: PriceWeights): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, winProbability(s.priceFraction, { score: s.score, histWinRate: 0, competition: 0 }, w)));
    sum += s.win ? -Math.log(p) : -Math.log(1 - p);
  }
  return Math.round((sum / samples.length) * 1000) / 1000;
}
