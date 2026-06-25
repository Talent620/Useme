// Decision-loop closure: the cycle prices every lead, and real outcomes
// (WON/REJECTED) teach the RL-lite bandit which source/channel/category to
// lean into. Deterministic — no LLM, no network beyond the sample feed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runCycle } from "../cycle.ts";
import { loadConfig } from "../config.ts";
import { recordToMemory, runPrice, runRank } from "../actions.ts";
import { Store } from "../store.ts";

const NOW = Date.parse("2026-06-24T14:00:00Z");

function freshEnv() {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-closure-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_STORE = resolve(dir, "store.json");
  return dir;
}

test("cycle attaches a recommended price + win probability to every lead", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const leads = loadConfig().tenants.flatMap((t) => store.leadsForTenant(t.id));
  assert.ok(leads.length > 0, "expected leads");
  for (const l of leads) {
    assert.ok(typeof l.recommendedPrice === "number" && l.recommendedPrice! > 0, `price set for ${l.id}`);
    assert.ok(l.winProbability! > 0 && l.winProbability! <= 1, `winProbability in (0,1] for ${l.id}`);
  }
});

test("runPrice re-prices a lead on demand and exposes its basis", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const lead = loadConfig().tenants.flatMap((t) => store.leadsForTenant(t.id))[0]!;
  const r = runPrice(store, lead.id);
  assert.ok(r, "price result");
  assert.ok(r!.recommendedPrice > 0, "positive recommended price");
  assert.ok(r!.winProbability > 0 && r!.winProbability <= 1, "valid win probability");
  assert.equal(r!.basis.score, lead.score, "basis carries the lead intent score");
  // On-demand uses current pipeline competition rather than the batch snapshot,
  // so prices are close but need not be byte-identical to the stored value.
  const base = lead.signalBudget && lead.signalBudget > 0 ? lead.signalBudget : 2000;
  assert.ok(r!.recommendedPrice >= base * 0.4, "price respects the floor of the grid");
});

test("a WON outcome raises the bandit value for that lead's source", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const lead = loadConfig().tenants.flatMap((t) => store.leadsForTenant(t.id))[0]!;
  const source = lead.signalSource ?? "(brak)";

  const before = store.rankedArms("source").find((a) => a.arm === source)?.value ?? 0;
  store.setLeadStatus(lead.id, "WON");
  recordToMemory(store, lead.id, "win");
  const after = store.rankedArms("source").find((a) => a.arm === source)?.value ?? 0;

  assert.ok(after > before, `source value should rise after a win (${before} -> ${after})`);
});

test("a REJECTED outcome does not raise the source value (loss = 0 reward)", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const leads = loadConfig().tenants.flatMap((t) => store.leadsForTenant(t.id));
  const won = leads[0]!;
  const lost = leads.find((l) => l.id !== won.id) ?? leads[0]!;

  recordToMemory(store, won.id, "win");
  const afterWin = store.rankedArms("source").find((a) => a.arm === (won.signalSource ?? "(brak)"))?.value ?? 0;
  recordToMemory(store, lost.id, "loss");
  const afterLoss = store.rankedArms("source").find((a) => a.arm === (lost.signalSource ?? "(brak)"))?.value ?? 0;

  // A loss feeds reward 0, pulling the EWMA down (or keeping it ≤ the post-win value).
  assert.ok(afterLoss <= afterWin, `loss must not increase value (win ${afterWin}, loss ${afterLoss})`);
});

test("runRank surfaces every tracked decision axis", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const lead = loadConfig().tenants.flatMap((t) => store.leadsForTenant(t.id))[0]!;
  recordToMemory(store, lead.id, "win");

  const { namespaces } = runRank(store);
  const names = namespaces.map((n) => n.ns);
  assert.deepEqual(names, ["source", "channel", "category"], "all three axes reported");
  assert.ok(namespaces.every((n) => Array.isArray(n.arms)), "each axis returns arms");
  assert.ok(namespaces.find((n) => n.ns === "source")!.arms.length > 0, "source axis learned at least one arm");
});
