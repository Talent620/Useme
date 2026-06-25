// Tests for the advanced autonomy modules: memory, rank, pricing, finance, crm,
// intel. (agents/boardroom tested in agents.test.ts.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { Memory } from "../memory.ts";
import { update, rank, pick, rewardOf } from "../rank.ts";
import { winProbability, recommendBid, competitionScore } from "../pricing.ts";
import { financials, revenueForecast } from "../finance.ts";
import { dueFollowUps, pipeline, stageOf, sequenceMessage } from "../crm.ts";
import { classifyIntent, isDemandSignal, mine, DEMAND_SOURCES } from "../intel.ts";
import type { LeadFact } from "../strategy.ts";

// --- memory ---
test("memory records deals and computes win rate + avg win price", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-mem-"));
  const m = new Memory(resolve(dir, "memory.json"));
  m.recordDeal({ tenantId: "t1", category: "seo", source: "useme", channel: "email", industry: "ecommerce", budget: 3000, price: 2800, outcome: "win", at: "2026-06-01" });
  m.recordDeal({ tenantId: "t1", category: "seo", source: "useme", channel: "email", budget: 2000, price: 2200, outcome: "loss", at: "2026-06-02" });
  assert.equal(m.winRate({ category: "seo" }).n, 2);
  assert.equal(m.winRate({ category: "seo" }).rate, 0.5);
  assert.equal(m.avgWinPrice("seo"), 2800);
  assert.equal(m.clientProfile("t1").deals, 2);
  // Persists across reload.
  const m2 = new Memory(resolve(dir, "memory.json"));
  assert.equal(m2.stats().deals, 2);
});

// --- rank (RL-lite) ---
test("rank EWMA update + deterministic pick", () => {
  let t = {};
  t = update(t, "useme", 1); t = update(t, "useme", 1);
  t = update(t, "oferia", 0); t = update(t, "oferia", 0);
  assert.equal(rank(t)[0]!.arm, "useme");
  assert.equal(pick(t, ["useme", "oferia"], 0, "seed1"), "useme"); // exploit
  assert.equal(rewardOf("win", 0.5) > rewardOf("loss"), true);
});

// --- pricing ---
test("winProbability falls with price, recommendBid maximizes EV", () => {
  const f = { score: 80, histWinRate: 0.5, competition: 0.2 };
  assert.ok(winProbability(0.6, f) > winProbability(1.1, f), "cheaper → higher win prob");
  const bid = recommendBid(5000, 500, f);
  assert.ok(bid.price > 0 && bid.fraction >= 0.4 && bid.fraction <= 1.2);
  assert.ok(bid.winProbability >= 0 && bid.winProbability <= 1);
  assert.equal(competitionScore(20), 1);
});

// --- finance ---
test("financials computes margin, CAC, LTV, MRR", () => {
  const facts: LeadFact[] = [
    { category: "seo", source: "useme", tenantId: "t1", status: "WON", budget: 5000, executed: true, executionOutcome: "ACCEPTED" },
    { category: "wp", source: "useme", tenantId: "t2", status: "WON", budget: 2000, executed: true, executionOutcome: "ACCEPTED" },
  ];
  const fin = financials(facts, [{ id: "t1", plan: "PRO" }, { id: "t2", plan: "STARTER" }]);
  assert.equal(fin.executionRevenue, 7000);
  assert.equal(fin.mrr, 198); // 149 + 49
  assert.equal(fin.customersWon, 2);
  assert.ok(fin.ltv > 0 && fin.cac > 0 && fin.ltvCacRatio > 0);
  assert.equal(revenueForecast(100, 3, 0.1).length, 3);
});

// --- crm ---
test("crm pipeline stages + due follow-ups by cadence", () => {
  const now = Date.parse("2026-06-10T00:00:00Z");
  const leads = [
    { id: "a", status: "SENT", outreachStatus: "sent", sentAt: "2026-06-01T00:00:00Z" }, // 9d → due
    { id: "b", status: "SENT", outreachStatus: "sent", sentAt: "2026-06-09T00:00:00Z" }, // 1d → not due
    { id: "c", status: "WON" },
  ];
  assert.equal(stageOf(leads[2]!), "wygrany");
  assert.equal(pipeline(leads).wygrany, 1);
  const due = dueFollowUps(leads, now);
  assert.ok(due.some((d) => d.leadId === "a"));
  assert.ok(!due.some((d) => d.leadId === "b"));
  assert.match(sequenceMessage(0, "Test"), /Test/);
});

// --- intel ---
test("intel classifies intent + curated demand sources", () => {
  assert.equal(classifyIntent("Szukam wykonawcy do sklepu"), "seeking");
  assert.equal(classifyIntent("We're hiring a React dev"), "hiring");
  assert.equal(classifyIntent("Request for proposal: audit"), "rfp");
  assert.equal(classifyIntent("just launched our startup"), "launch");
  assert.equal(classifyIntent("zwykły tekst"), "none");
  assert.equal(isDemandSignal("potrzebuję pomocy"), true);
  assert.ok(DEMAND_SOURCES.length >= 5 && DEMAND_SOURCES.every((s) => s.feed.startsWith("http")));
  assert.equal(mine([{ title: "szukam grafika" }, { title: "miły dzień" }]).length, 1);
});
