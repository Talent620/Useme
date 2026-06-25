import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runCycle } from "../cycle.ts";
import { loadConfig } from "../config.ts";
import { Store } from "../store.ts";
import { sendOutreach } from "../outreach.ts";

const NOW = Date.parse("2026-06-24T14:00:00Z");

function freshEnv() {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-out-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_STORE = resolve(dir, "store.json");
  return dir;
}

test("cycle queues high-score leads for outreach (gate: not auto-sent)", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  const m = await runCycle(store, loadConfig(), NOW);
  assert.ok(m.queuedForOutreach > 0, "some leads queued for outreach");
  const outbox = store.outbox();
  assert.ok(outbox.length > 0, "outbox populated");
  // Nothing sent yet — human gate.
  assert.ok(outbox.every((l) => l.outreachStatus === "queued"), "all awaiting approval");
});

test("approve + send writes an outbox message and is idempotent", async () => {
  const dir = freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const cfg = loadConfig();

  const lead = store.outbox("queued")[0]!;
  const tenant = cfg.tenants.find((t) => t.id === lead.tenantId)!;
  store.setOutreach(lead.id, "approved");

  const res = await sendOutreach(tenant, lead, new Date(NOW).toISOString());
  assert.equal(res.via, "manual");
  assert.ok(res.ok && existsSync(res.ref), "outbox file written");
  const text = readFileSync(res.ref, "utf8");
  assert.ok(text.includes("Temat:"), "message has subject");
  assert.ok(text.includes("STOP"), "compliance footer present");

  store.recordSend(tenant.id, lead.id, res.via, new Date(NOW).toISOString());
  // Sent leads leave the outbox (no double-send).
  assert.ok(!store.outbox().some((l) => l.id === lead.id), "not re-queued after send");
  assert.equal(store.findLead(lead.id)!.outreachStatus, "sent");
  assert.equal(store.findLead(lead.id)!.status, "SENT");
  assert.ok(dir.length > 0);
});

test("daily cap counting works", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const lead = store.outbox("queued")[0]!;
  const since = new Date(NOW - 3600_000).toISOString();
  assert.equal(store.sentCountSince(lead.tenantId, since), 0);
  store.recordSend(lead.tenantId, lead.id, "manual", new Date(NOW).toISOString());
  assert.equal(store.sentCountSince(lead.tenantId, since), 1);
});

test("reject removes a lead from the outbox", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const lead = store.outbox("queued")[0]!;
  store.setOutreach(lead.id, "skipped");
  assert.ok(!store.outbox().some((l) => l.id === lead.id), "skipped lead not in outbox");
});
