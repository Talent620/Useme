// Self-calibrating pricing: the system learns its own price elasticity from
// real win/loss history (deterministic logistic regression). No LLM, no random.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { calibrateWeights, winProbability, DEFAULT_WEIGHTS, type PriceSample } from "../pricing.ts";
import { Memory } from "../memory.ts";
import { runPriceTrain } from "../actions.ts";
import { Store } from "../store.ts";

function freshEnv() {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-pcal-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_STORE = resolve(dir, "store.json");
  return dir;
}

test("calibrateWeights is a no-op below the minimum sample count", () => {
  const samples: PriceSample[] = [
    { priceFraction: 0.5, score: 60, win: true },
    { priceFraction: 1.1, score: 60, win: false },
  ];
  const r = calibrateWeights(samples, DEFAULT_WEIGHTS);
  assert.deepEqual(r.weights, DEFAULT_WEIGHTS, "weights unchanged with too few samples");
  assert.equal(r.trainedOn, 2);
});

test("calibration learns price elasticity: cheap wins, expensive loses", () => {
  // Separable elasticity signal: deals below 0.8 of budget win, above lose.
  const samples: PriceSample[] = [];
  for (let i = 0; i < 24; i++) {
    samples.push({ priceFraction: 0.5, score: 55, win: true });
    samples.push({ priceFraction: 1.15, score: 55, win: false });
  }
  const baseLoss = calibrateWeights(samples, DEFAULT_WEIGHTS, { minSamples: 9999 }).logLoss;
  const r = calibrateWeights(samples, DEFAULT_WEIGHTS);

  assert.equal(r.trainedOn, samples.length);
  assert.ok(r.logLoss < baseLoss, `calibrated fit beats priors (${r.logLoss} < ${baseLoss})`);
  // The learned model must predict a higher win prob when we bid cheaper.
  const pCheap = winProbability(0.5, { score: 55, histWinRate: 0, competition: 0 }, r.weights);
  const pPricey = winProbability(1.15, { score: 55, histWinRate: 0, competition: 0 }, r.weights);
  assert.ok(pCheap > pPricey, `cheaper bid wins more often (${pCheap} > ${pPricey})`);
  assert.ok(r.weights.priceFraction >= 0, "price sensitivity stays non-negative");
});

test("calibration is deterministic — identical inputs yield identical weights", () => {
  const samples: PriceSample[] = Array.from({ length: 20 }, (_, i) => ({
    priceFraction: i % 2 ? 1.0 : 0.6, score: 50, win: i % 2 === 0,
  }));
  const a = calibrateWeights(samples, DEFAULT_WEIGHTS);
  const b = calibrateWeights(samples, DEFAULT_WEIGHTS);
  assert.deepEqual(a.weights, b.weights, "no randomness in the fit");
});

test("Memory.priceSamples derives fractions and filters degenerate deals", () => {
  freshEnv();
  const mem = new Memory(resolve(process.env.RADAR_DATA_DIR!, "memory.json"));
  mem.recordDeal({ tenantId: "t", category: "seo", source: "s", channel: "file", budget: 2000, price: 1000, score: 70, outcome: "win", at: "2026-06-01T00:00:00Z" });
  mem.recordDeal({ tenantId: "t", category: "seo", source: "s", channel: "file", budget: 0, price: 500, score: 40, outcome: "loss", at: "2026-06-02T00:00:00Z" }); // no budget → dropped
  mem.recordDeal({ tenantId: "t", category: "seo", source: "s", channel: "file", score: 40, outcome: "loss", at: "2026-06-03T00:00:00Z" }); // no price/budget → dropped

  const s = mem.priceSamples();
  assert.equal(s.length, 1, "only the well-formed deal is usable");
  assert.equal(s[0]!.priceFraction, 0.5, "fraction = price / budget");
  assert.equal(s[0]!.score, 70);
  assert.equal(s[0]!.win, true);
});

test("runPriceTrain persists calibrated weights once enough deals exist", () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  const mem = new Memory(resolve(process.env.RADAR_DATA_DIR!, "memory.json"));
  for (let i = 0; i < 12; i++) {
    const win = i % 2 === 0;
    mem.recordDeal({
      tenantId: "t", category: "seo", source: "s", channel: "file",
      budget: 3000, price: win ? 1500 : 3300, score: 50,
      outcome: win ? "win" : "loss", at: `2026-06-${(i + 1).toString().padStart(2, "0")}T00:00:00Z`,
    });
  }
  assert.equal(store.getPriceWeights(), undefined, "starts on default priors");
  const r = runPriceTrain(store, "2026-06-25T00:00:00Z");
  assert.ok(r.trainedOn >= 8, "trained on the accumulated history");

  const reloaded = new Store(process.env.RADAR_STORE!);
  assert.ok(reloaded.getPriceWeights(), "weights persisted across store reload");
  assert.deepEqual(reloaded.getPriceWeights(), r.weights, "persisted weights match the fit");
});
