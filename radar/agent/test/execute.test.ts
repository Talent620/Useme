import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runCycle } from "../cycle.ts";
import { runExecute, runExecuteLead } from "../actions.ts";
import { loadConfig } from "../config.ts";
import { Store } from "../store.ts";

const NOW = Date.parse("2026-06-24T14:00:00Z");

function freshEnv() {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-exec-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_STORE = resolve(dir, "store.json");
  return dir;
}

test("won lead is autonomously executed into a deliverable file", async () => {
  freshEnv();
  // Disable auto-exec in-cycle so we drive it explicitly here.
  const cfg = loadConfig();
  cfg.settings.execution = { enabled: true, autoExecuteOnWon: false, maxIterations: 3, minConfidence: 80 };

  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, cfg, NOW);

  // Pick a copywriting lead (self tenant has the copywriting signal).
  const lead = store.leadsForTenant("self").find((l) => /copywriting/i.test(l.signalTitle))
    ?? store.leadsForTenant("self")[0]!;
  store.setLeadStatus(lead.id, "WON");

  assert.equal(store.executableLeads().length >= 1, true);
  const s = await runExecute(store, cfg);
  assert.equal(s.executed, 1);
  const item = s.items[0]!;
  assert.ok(item.confidence > 0);
  assert.ok(existsSync(item.ref), "deliverable file written");
  const content = readFileSync(item.ref, "utf8");
  assert.match(content, /Dostarczenie:/);
  assert.ok(content.length > 200);

  // Recorded + no longer in the executable queue (idempotent).
  assert.equal(store.findLead(lead.id)!.executionStatus, item.gate);
  assert.equal(store.executableLeads().length, 0);
});

test("runExecuteLead executes a specific lead on demand and writes files", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const lead = store.leadsForTenant("demo-wp")[0]!;
  const item = await runExecuteLead(store, loadConfig(), lead.id);
  assert.ok(item, "returns an item");
  assert.ok(item!.confidence > 0);
  assert.ok(item!.files.length >= 1 && existsSync(item!.files[0]!), "deliverable file written");
  assert.equal(await runExecuteLead(store, loadConfig(), "nope"), null);
});

test("autoExecuteOnWon runs execution inside the cycle", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const lead = store.leadsForTenant("demo-wp")[0]!;
  store.setLeadStatus(lead.id, "WON");
  store.save();

  const m = await runCycle(store, loadConfig(), NOW + 60_000);
  assert.ok(m.executed >= 1, "cycle executed the won lead");
  assert.ok(store.findLead(lead.id)!.deliverableRef, "deliverable recorded");
});
