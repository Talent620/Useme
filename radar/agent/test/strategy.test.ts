import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { computeFunnel, recommend, type LeadFact } from "../strategy.ts";
import { runStrategy } from "../actions.ts";
import { loadConfig, strategyOverridesPath } from "../config.ts";
import { Store } from "../store.ts";

function facts(): LeadFact[] {
  const out: LeadFact[] = [];
  // Dead source: 5 leads, 0 won.
  for (let i = 0; i < 5; i++) out.push({ category: "misc", source: "deadsrc", tenantId: "t0", status: "NEW" });
  // Profitable SEO: 2 accepted @ 5000.
  for (let i = 0; i < 2; i++) out.push({ category: "seo", source: "useme", tenantId: "t1", status: "WON", budget: 5000, sent: true, executed: true, executionOutcome: "ACCEPTED" });
  out.push({ category: "seo", source: "useme", tenantId: "t1", status: "WON", budget: 5000, sent: true });
  // Low-quality WP: 4 executed, 1 accepted.
  for (let i = 0; i < 3; i++) out.push({ category: "wordpress", source: "useme", tenantId: "t2", status: "WON", budget: 1000, executed: true, executionOutcome: "REJECTED" });
  out.push({ category: "wordpress", source: "useme", tenantId: "t2", status: "WON", budget: 1000, executed: true, executionOutcome: "ACCEPTED" });
  return out;
}

test("computeFunnel aggregates revenue, cost, margin per dimension", () => {
  const f = computeFunnel(facts());
  const seo = f.byCategory.find((s) => s.key === "seo")!;
  assert.equal(seo.revenue, 10000);
  assert.equal(seo.accepted, 2);
  assert.ok(seo.roi > 1);
  assert.equal(f.totals.revenue, 11000); // seo 10000 + wp 1000
  assert.ok(f.bySource.find((s) => s.key === "deadsrc")!.won === 0);
});

test("recommend flags dead source, growth, quality, upsell", () => {
  const f = computeFunnel(facts());
  const recs = recommend(f, { tenants: [{ id: "t1", plan: "STARTER" }, { id: "t2", plan: "STARTER" }] });
  const actions = recs.map((r) => r.action);
  assert.ok(actions.includes("disable_source"));
  assert.ok(actions.includes("grow_category"));
  assert.ok(actions.includes("raise_quality"));
  assert.ok(actions.includes("upsell_tenant"));
  // Dead source recommendation is auto-applicable.
  assert.equal(recs.find((r) => r.action === "disable_source")!.autoApplicable, true);
  // Sorted by impact*confidence (descending).
  for (let i = 1; i < recs.length; i++) {
    const a = recs[i - 1]!, b = recs[i]!;
    assert.ok(a.expectedImpactPln * a.confidence >= b.expectedImpactPln * b.confidence);
  }
});

test("recommend stays empty on thin data", () => {
  assert.equal(recommend(computeFunnel([{ category: "x", source: "y", tenantId: "z", status: "NEW" }])).length, 0);
});

test("runStrategy auto-applies dead-source disable to the overrides overlay", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-strat-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_STORE = resolve(dir, "store.json");
  const store = new Store(process.env.RADAR_STORE);
  // Seed 5 dead-source leads through the public API.
  for (let i = 0; i < 5; i++) {
    store.upsertLead({
      tenantId: "t0", icpId: "i", signalId: `s${i}`, score: 50, reasons: [], matchedKeywords: [],
      signalTitle: "x", signalUrl: "u", signalSource: "deadsrc", signalCategories: ["misc"],
      createdAt: new Date().toISOString(),
    } as never);
  }
  const r = runStrategy(store, loadConfig(), true);
  assert.ok(r.applied.includes("deadsrc"));
  const ov = JSON.parse(readFileSync(strategyOverridesPath(), "utf8"));
  assert.ok(ov.sourcesDisabled.includes("deadsrc"));
  assert.ok(existsSync(strategyOverridesPath()));
});
