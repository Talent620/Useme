import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSeries, dateAxis, forecast, forecastSeries, holtPredict, linregSlope, prealloc, type TimedEvent } from "../forecast.ts";

test("linregSlope detects up/down/flat trends", () => {
  assert.ok(linregSlope([1, 2, 3, 4, 5]) > 0);
  assert.ok(linregSlope([5, 4, 3, 2, 1]) < 0);
  assert.equal(linregSlope([3, 3, 3, 3]), 0);
});

test("holtPredict extrapolates a rising series upward", () => {
  const p = holtPredict([1, 2, 3, 4, 5]);
  assert.ok(p > 5, `expected > 5, got ${p}`);
  assert.equal(holtPredict([7]), 7);
  assert.equal(holtPredict([]), 0);
});

test("dateAxis + buildSeries align counts to a shared time axis", () => {
  const ev: TimedEvent[] = [
    { key: "seo", date: "2026-06-01" },
    { key: "seo", date: "2026-06-03" },
    { key: "wp", date: "2026-06-02" },
  ];
  const axis = dateAxis(ev);
  assert.deepEqual(axis, ["2026-06-01", "2026-06-02", "2026-06-03"]);
  assert.deepEqual(buildSeries(ev, "seo", axis), [1, 0, 1]);
});

test("forecastSeries classifies a spiking category as rising", () => {
  const f = forecastSeries("seo", [0, 1, 1, 2, 4, 7, 11]);
  assert.equal(f.trend, "rising");
  assert.ok(f.momentum > 1.3);
  assert.ok(f.predictedNext > f.series.at(-1)! - 2);
});

test("forecastSeries classifies a fading category as declining", () => {
  const f = forecastSeries("ads", [10, 8, 6, 4, 2, 1, 0]);
  assert.equal(f.trend, "declining");
  assert.ok(f.momentum < 0.7);
});

test("prealloc leans into rising demand, eases off declining", () => {
  const events: TimedEvent[] = [];
  const days = ["01", "02", "03", "04", "05", "06", "07"];
  // SEO ramps up, ADS fades.
  const seoPer = [0, 1, 1, 2, 4, 6, 9];
  const adsPer = [9, 7, 5, 3, 2, 1, 0];
  days.forEach((d, i) => {
    for (let n = 0; n < seoPer[i]!; n++) events.push({ key: "seo", date: `2026-06-${d}` });
    for (let n = 0; n < adsPer[i]!; n++) events.push({ key: "ads", date: `2026-06-${d}` });
  });
  const recs = prealloc(forecast(events));
  assert.ok(recs.some((r) => r.action === "expand_icp" && r.target === "seo"));
  assert.ok(recs.some((r) => r.action === "deprioritize" && r.target === "ads"));
});
