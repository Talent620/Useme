import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runCycle } from "../cycle.ts";
import { loadConfig } from "../config.ts";
import { Store } from "../store.ts";
import { Memory } from "../memory.ts";
import { boardroom } from "../agents.ts";

const NOW = Date.parse("2026-06-24T14:00:00Z");

function freshEnv() {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-board-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_STORE = resolve(dir, "store.json");
  return dir;
}

test("boardroom runs all agents and the CEO synthesizes priorities", async () => {
  const dir = freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const mem = new Memory(resolve(dir, "memory.json"));
  mem.recordDeal({ tenantId: "demo-wp", category: "wordpress", source: "sample", channel: "file", outcome: "win", price: 1500, at: "2026-06-01" });

  const b = boardroom(store, loadConfig(), NOW, mem);
  const names = b.agents.map((a) => a.name);
  for (const expected of ["CEO", "Research", "Sales", "Outreach", "Execution", "QA", "Finance", "Strategy", "Memory"]) {
    assert.ok(names.includes(expected), `missing agent: ${expected}`);
  }
  assert.ok(b.priorities.length > 0, "CEO produced priorities");
  // After a cycle there are queued offers, so Sales/Outreach should flag work.
  assert.ok(b.priorities.some((p) => /ofert|Wykonaj|follow|→/.test(p)));
  assert.ok(b.agents.every((a) => a.summary.length > 0));
});

test("boardroom works without memory (LLM/memory optional)", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW);
  const b = boardroom(store, loadConfig(), NOW);
  assert.ok(b.agents.find((a) => a.name === "CEO"));
  assert.ok(!b.agents.find((a) => a.name === "Memory"));
});
