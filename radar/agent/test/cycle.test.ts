import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runCycle } from "../cycle.ts";
import { loadConfig } from "../config.ts";
import { Store } from "../store.ts";

const NOW = Date.parse("2026-06-24T14:00:00Z"); // close to fixture pubDates -> high recency

function freshEnv() {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-test-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_STORE = resolve(dir, "store.json");
  return dir;
}

test("cycle produces leads from the sample feed and writes digests", async () => {
  const dir = freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  const m = await runCycle(store, loadConfig(), NOW);

  assert.ok(m.sources.some((s) => s.name === "sample" && s.ok), "sample source crawled");
  assert.ok(m.newSignals >= 4, `expected fresh signals, got ${m.newSignals}`);
  assert.ok(m.leadsCreated > 0, "leads created across tenants");
  assert.ok(m.digests.length > 0, "digests delivered");

  const digestDir = resolve(dir, "digests");
  const files = readdirSync(digestDir);
  assert.ok(files.length > 0, "digest files written");
  const sample = readFileSync(resolve(digestDir, files[0]!), "utf8");
  assert.ok(sample.includes("RadarPL"), "digest has header");
  assert.ok(/Gotowy draft/.test(sample), "digest includes a ready-to-send draft");
});

test("second cycle is idempotent — no duplicate leads, nothing re-delivered", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  const first = await runCycle(store, loadConfig(), NOW);
  const second = await runCycle(store, loadConfig(), NOW + 60_000);

  assert.equal(second.newSignals, 0, "no new signals on second pass");
  assert.equal(second.leadsCreated, 0, "no new leads on second pass");
  assert.equal(second.digests.length, 0, "nothing re-delivered");
  assert.ok(first.leadsCreated > 0);
});

test("excluded noise (wolontariat/za darmo) does not become a lead", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const all = loadConfig().tenants.flatMap((t) => store.leadsForTenant(t.id));
  assert.ok(!all.some((l) => /przeprowadzce|wolontariat/i.test(l.signalTitle)), "noise filtered out");
});
