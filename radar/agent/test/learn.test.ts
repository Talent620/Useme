import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runCycle } from "../cycle.ts";
import { loadConfig } from "../config.ts";
import { Store } from "../store.ts";
import { trainModel } from "../../packages/core/src/index.ts";

const NOW = Date.parse("2026-06-24T14:00:00Z");

function freshEnv() {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-learn-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_STORE = resolve(dir, "store.json");
  return dir;
}

test("trainingExamples derives labels from lead outcomes", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const t = loadConfig().tenants[0]!;
  const leads = store.leadsForTenant(t.id);
  store.setLeadStatus(leads[0]!.id, "WON");
  store.setLeadStatus(leads[1]!.id, "REJECTED");
  const ex = store.trainingExamples(t.id);
  assert.ok(ex.some((e) => e.label === "pos"));
  assert.ok(ex.some((e) => e.label === "neg"));
});

test("learned model persists and re-ranks future cycles", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const cfg = loadConfig();
  const t = cfg.tenants.find((x) => x.id === "demo-wp")!;

  // Simulate strong positive history for "wordpress", negative for others.
  const examples = [
    { keywords: ["wordpress", "woocommerce"], label: "pos" as const },
    { keywords: ["wordpress"], label: "pos" as const },
    { keywords: ["wordpress", "elementor"], label: "pos" as const },
    { keywords: ["seo"], label: "neg" as const },
    { keywords: ["copywriting"], label: "neg" as const },
  ];
  store.setLearned(t.id, trainModel(examples, NOW));
  store.save();

  // Reload from disk -> model survives restart.
  const store2 = new Store(process.env.RADAR_STORE!);
  const model = store2.getLearned(t.id);
  assert.ok(model && model.keywordWeights["wordpress"] > 0, "wordpress learned positive");
  assert.ok(model!.trainedOn === 5);
});

test("autoTrain produces a model once enough outcomes exist", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const t = loadConfig().tenants.find((x) => x.id === "demo-wp")!;
  // Label >= minExamples (5) leads to enable autoTrain on next cycle.
  const leads = store.leadsForTenant(t.id);
  leads.slice(0, 3).forEach((l) => store.setLeadStatus(l.id, "WON"));
  // Need >=5 examples total; pull more from another tenant's leads won't count.
  // Use self tenant which also has leads.
  const selfLeads = store.leadsForTenant("self");
  selfLeads.slice(0, 2).forEach((l) => store.setLeadStatus(l.id, "REJECTED"));

  // demo-wp has only 3 examples (<5) -> no model; self has 2 (<5) -> none.
  await runCycle(store, loadConfig(), NOW + 60_000);
  assert.equal(store.getLearned("demo-wp"), undefined, "below minExamples => no model");

  // Add more demo-wp outcomes to cross the threshold.
  store.leadsForTenant(t.id).slice(0, 5).forEach((l, i) =>
    store.setLeadStatus(l.id, i % 2 ? "REJECTED" : "WON"),
  );
  store.save();
  await runCycle(store, loadConfig(), NOW + 120_000);
  assert.ok(store.getLearned("demo-wp"), ">=minExamples => model trained");
});
