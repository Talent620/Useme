import { test } from "node:test";
import assert from "node:assert/strict";

import { planJob } from "../planner.ts";
import { review, wordCount } from "../critic.ts";
import { executeJob } from "../engine.ts";
import type { Job } from "../types.ts";

function job(over: Partial<Job> = {}): Job {
  return {
    id: "j1",
    title: "Napisz 5 artykułów blogowych o WordPress",
    brief: "Potrzebuję 5 artykułów SEO o WordPress i WooCommerce na firmowego bloga.",
    categories: ["copywriting"],
    lang: "pl",
    ...over,
  };
}

test("planJob routes capability by category", () => {
  assert.equal(planJob(job({ categories: ["copywriting"] }))[0]!.capability, "writer");
  assert.equal(planJob(job({ categories: ["seo"] }))[0]!.capability, "audit");
  assert.equal(planJob(job({ categories: ["web"] }))[0]!.capability, "landing");
  assert.equal(planJob(job({ categories: ["automation"] }))[0]!.capability, "spec");
});

test("critic scores low for placeholders / too short", () => {
  const crit = [
    { id: "len", type: "minWords" as const, params: { min: 100 }, weight: 50 },
    { id: "noph", type: "noPlaceholders" as const, weight: 50 },
  ];
  const bad = review({ taskId: "t", format: "md", content: "TODO" }, crit);
  assert.ok(bad.score < 50);
  assert.equal(bad.passed, false);
  assert.ok(bad.issues.length >= 1);
});

test("executeJob (writer) produces a passing, packaged deliverable", async () => {
  const report = await executeJob(job(), { maxIterations: 4, minConfidence: 80 });
  assert.ok(report.confidence >= 80, `confidence ${report.confidence}`);
  assert.equal(report.gate, "auto");
  assert.equal(report.outcomes[0]!.task.capability, "writer");
  assert.match(report.deliverable, /## Korzyści/);
  assert.ok(wordCount(report.deliverable) >= 300);
});

test("executeJob (landing) emits valid HTML", async () => {
  const report = await executeJob(job({ title: "Landing dla sklepu", brief: "Strona dla sklepu WooCommerce", categories: ["web"] }));
  const art = report.outcomes[0]!.artifact;
  assert.equal(art.format, "html");
  assert.match(art.content, /<html/);
  assert.ok(report.outcomes[0]!.review.passed);
});

test("self-revision climbs quality across iterations", async () => {
  // High word bar forces at least one revision (depth increase) to pass.
  const j = job({ brief: "Krótki brief.", categories: ["copywriting"] });
  const report = await executeJob(j, { maxIterations: 5, minConfidence: 80 });
  assert.ok(report.outcomes[0]!.iterations >= 1);
  assert.ok(report.confidence >= 80, "eventually reaches passing quality");
});

test("translate without LLM escalates (gate=review, not auto)", async () => {
  const report = await executeJob(
    job({ title: "Tłumaczenie PL-EN", brief: "Przetłumacz tekst na angielski.", categories: ["translate-x"] }),
    { minConfidence: 80 },
  );
  // categories don't map; brief triggers translate via keyword "Przetłumacz".
  assert.equal(report.outcomes[0]!.task.capability, "translate");
  assert.equal(report.gate, "review");
});
