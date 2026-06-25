// Deterministic negotiation engine: accept / counter / decline with a margin
// floor, monotonic concession, and EV-maximizing choice. No LLM, no random.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { negotiate, floorPrice, acceptProbability, DEFAULT_NEGOTIATION } from "../negotiate.ts";
import { runNegotiate } from "../actions.ts";
import { Store } from "../store.ts";

function freshEnv() {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-nego-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_STORE = resolve(dir, "store.json");
  return dir;
}

test("floorPrice keeps the minimum margin", () => {
  assert.equal(floorPrice(1000, 0.5), 2000, "50% margin doubles cost");
  assert.equal(floorPrice(650, 0.35), 1000, "35% margin floor");
  assert.equal(floorPrice(100, 0), 100, "zero margin = cost");
});

test("acceptProbability falls as we hold firmer on price", () => {
  const meetThem = acceptProbability(1000, 1000, 2000); // ask fraction 0
  const splitIt = acceptProbability(1500, 1000, 2000); // ask fraction 0.5
  const holdFirm = acceptProbability(2000, 1000, 2000); // ask fraction 1
  assert.ok(meetThem > splitIt && splitIt > holdFirm, `monotonic decline: ${meetThem} > ${splitIt} > ${holdFirm}`);
});

test("offer at/above target is accepted outright", () => {
  const d = negotiate({ ourPrice: 2000, clientOffer: 1960, cost: 500 });
  assert.equal(d.action, "accept");
  assert.equal(d.price, 1960);
  assert.equal(d.expectedValue, 1460);
});

test("a mid offer above the floor produces a counter between offer and target", () => {
  const d = negotiate({ ourPrice: 3000, clientOffer: 1500, cost: 600, round: 1 });
  assert.equal(d.action, "counter");
  assert.ok(d.price > 1500 && d.price <= 3000, `counter in (offer, target]: ${d.price}`);
  assert.ok(d.price >= d.floor, "counter respects the floor");
  assert.ok(d.acceptProbability > 0 && d.acceptProbability < 1);
});

test("concession is monotonic — later rounds counter lower (closer to client)", () => {
  const r1 = negotiate({ ourPrice: 3000, clientOffer: 1500, cost: 400, round: 1 });
  const r3 = negotiate({ ourPrice: 3000, clientOffer: 1500, cost: 400, round: 3 });
  assert.equal(r1.action, "counter");
  assert.equal(r3.action, "counter");
  assert.ok(r3.price < r1.price, `later round concedes more: round3 ${r3.price} < round1 ${r1.price}`);
});

test("an offer below cost with no profitable counter is declined", () => {
  // cost 2000, min margin 0.35 → floor ~3077; client offers 800 (< cost).
  const d = negotiate({ ourPrice: 3500, clientOffer: 800, cost: 2000, round: 4 });
  assert.equal(d.action, "decline");
  assert.equal(d.price, 0);
});

test("the configured accept threshold is honored", () => {
  const cfg = { acceptThreshold: 0.8 };
  const d = negotiate({ ourPrice: 2000, clientOffer: 1650, cost: 300, config: cfg });
  assert.equal(d.action, "accept", "1650 >= 80% of 2000 → accept");
});

test("runNegotiate advances the round and logs both sides to memory", () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  // Seed a lead directly through the store's upsert.
  const lead = store.upsertLead({
    tenantId: "t", signalId: "s1", icpId: "i1", score: 70, reasons: [], matchedKeywords: [],
    createdAt: "2026-06-20T00:00:00Z", signalTitle: "Sklep WP", signalUrl: "http://x",
    signalBudget: 4000, recommendedPrice: 3600, signalCategories: ["ecommerce"], signalSource: "sample",
  } as never);

  const r1 = runNegotiate(store, lead.id, 2000);
  assert.ok(r1, "decision returned");
  assert.equal(r1!.round, 1, "first round");
  const r2 = runNegotiate(store, lead.id, 2500);
  assert.equal(r2!.round, 2, "round advances on the next offer");
  assert.equal(store.findLead(lead.id)!.lastClientOffer, 2500, "latest offer recorded on the lead");
});

test("runNegotiate returns null for an unknown lead", () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  assert.equal(runNegotiate(store, "nope", 1000), null);
});
