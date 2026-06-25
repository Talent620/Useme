// Predictive demand engine. Turns the historical timeline of leads into a
// per-category forecast (trend, momentum, next-period prediction) so the
// agent-CEO can PRE-allocate effort to categories about to spike — anticipation,
// not just reaction. Deterministic (Holt linear smoothing + regression), tested.

export interface TimedEvent {
  key: string; // category or source
  date: string; // YYYY-MM-DD
}

export interface Forecast {
  key: string;
  series: number[]; // daily counts over the global date axis
  recent: number; // sum of the recent window
  prior: number; // sum of the previous window
  momentum: number; // (recent+1)/(prior+1)
  slope: number; // linear-regression slope
  predictedNext: number; // next-period prediction (Holt)
  trend: "rising" | "flat" | "declining";
}

/** Ordered unique dates present across all events (the shared time axis). */
export function dateAxis(events: TimedEvent[]): string[] {
  return [...new Set(events.map((e) => e.date))].sort();
}

export function buildSeries(events: TimedEvent[], key: string, axis: string[]): number[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.key === key) counts.set(e.date, (counts.get(e.date) ?? 0) + 1);
  }
  return axis.map((d) => counts.get(d) ?? 0);
}

/** Slope of the best-fit line through the series (per-step change). */
export function linregSlope(y: number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (y[i]! - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : Math.round((num / den) * 1000) / 1000;
}

/** Holt linear (double exponential) smoothing — predicts the next value. */
export function holtPredict(y: number[], alpha = 0.5, beta = 0.3): number {
  if (y.length === 0) return 0;
  if (y.length === 1) return y[0]!;
  let level = y[0]!;
  let trend = y[1]! - y[0]!;
  for (let i = 1; i < y.length; i++) {
    const prevLevel = level;
    level = alpha * y[i]! + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  return Math.max(0, Math.round((level + trend) * 100) / 100);
}

export interface ForecastOpts {
  risingMomentum?: number; // default 1.3
  decliningMomentum?: number; // default 0.7
}

export function forecastSeries(key: string, series: number[], opts: ForecastOpts = {}): Forecast {
  const rising = opts.risingMomentum ?? 1.3;
  const declining = opts.decliningMomentum ?? 0.7;
  const k = Math.min(7, Math.max(1, Math.floor(series.length / 2)));
  const recent = series.slice(-k).reduce((s, v) => s + v, 0);
  const prior = series.slice(-2 * k, -k).reduce((s, v) => s + v, 0);
  const momentum = Math.round(((recent + 1) / (prior + 1)) * 100) / 100;
  const slope = linregSlope(series);
  const predictedNext = holtPredict(series);
  let trend: Forecast["trend"] = "flat";
  if (momentum >= rising && slope > 0) trend = "rising";
  else if (momentum <= declining && slope < 0) trend = "declining";
  return { key, series, recent, prior, momentum, slope, predictedNext, trend };
}

export function forecast(events: TimedEvent[], opts: ForecastOpts = {}): Forecast[] {
  const axis = dateAxis(events);
  const keys = [...new Set(events.map((e) => e.key))];
  return keys
    .map((key) => forecastSeries(key, buildSeries(events, key, axis), opts))
    .sort((a, b) => b.momentum - a.momentum);
}

export interface PreallocRec {
  action: "prealloc_capacity" | "expand_icp" | "prioritize_source" | "deprioritize";
  target: string;
  rationale: string;
  predictedNext: number;
  momentum: number;
  confidence: number;
}

/** Forward-looking moves: lean into what's about to spike, ease off what's fading. */
export function prealloc(forecasts: Forecast[], avgValuePln = 1500): PreallocRec[] {
  const recs: PreallocRec[] = [];
  for (const f of forecasts) {
    if (f.trend === "rising" && f.recent >= 3) {
      recs.push({
        action: "expand_icp",
        target: f.key,
        rationale: `popyt rośnie (momentum ${f.momentum}x, prognoza ${f.predictedNext}/dzień) — rozszerz ICP zanim konkurencja zauważy`,
        predictedNext: f.predictedNext,
        momentum: f.momentum,
        confidence: Math.min(0.9, 0.5 + (f.momentum - 1.3) * 0.3),
      });
    } else if (f.trend === "declining" && f.prior >= 3) {
      recs.push({
        action: "deprioritize",
        target: f.key,
        rationale: `popyt słabnie (momentum ${f.momentum}x) — przenieś wysiłek gdzie indziej`,
        predictedNext: f.predictedNext,
        momentum: f.momentum,
        confidence: 0.55,
      });
    }
  }
  return recs.sort((a, b) => b.predictedNext * b.momentum - a.predictedNext * a.momentum);
}
