import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { runCycle } from "../cycle.ts";
import { runExecute, runReport } from "../actions.ts";
import { loadConfig } from "../config.ts";
import { Store } from "../store.ts";

const NOW = Date.parse("2026-06-24T14:00:00Z");

function freshEnv() {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-report-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_STORE = resolve(dir, "store.json");
  return dir;
}

test("operator report synthesizes the whole business state", async () => {
  freshEnv();
  const cfg = loadConfig();
  cfg.settings.execution = { enabled: true, autoExecuteOnWon: false, maxIterations: 5, minConfidence: 80, candidates: 2, targetScore: 100 };
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, cfg, NOW);

  const lead = store.leadsForTenant("demo-wp")[0]!;
  store.setLeadStatus(lead.id, "WON");
  await runExecute(store, cfg);
  store.recordExecutionOutcome(lead.id, "ACCEPTED");

  const { markdown, ref } = runReport(store, cfg, new Date(NOW).toISOString());
  assert.ok(existsSync(ref), "report file written");
  for (const section of ["panel operatora", "## Pipeline", "## Wynik (P&L)", "## Prognoza popytu", "## Jakość wykonania", "## Deliverable", "Co trzeba zrobić", "Zdrowie źródeł"]) {
    assert.ok(markdown.includes(section), `missing section: ${section}`);
  }
  assert.ok(readFileSync(ref, "utf8").length > 200);
});

test("report lists pending outreach as a to-do", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  await runCycle(store, loadConfig(), NOW); // queues high-score leads for outreach
  const { markdown } = runReport(store, loadConfig(), new Date(NOW).toISOString());
  assert.match(markdown, /Zaakceptuj\/odrzuć \d+ ofert/);
});
