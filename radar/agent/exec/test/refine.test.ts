import { test } from "node:test";
import assert from "node:assert/strict";

import { repair } from "../refine.ts";
import { review } from "../critic.ts";
import { planJob } from "../planner.ts";
import { executeJob } from "../engine.ts";
import type { Artifact, Job } from "../types.ts";

const job: Job = { id: "j", title: "Artykuł o WordPress", brief: "Tekst o WordPress i SEO dla sklepu.", categories: ["copywriting"], lang: "pl" };

test("repair makes a deficient markdown artifact perfect on criteria", () => {
  const task = planJob(job)[0]!;
  const bad: Artifact = { taskId: task.id, format: "md", content: "# Tytuł\n\nKrótko. TODO uzupełnić." };
  const before = review(bad, task.acceptance);
  const fixed = repair(bad, task.acceptance, job);
  const after = review(fixed, task.acceptance);
  assert.ok(after.score > before.score);
  assert.equal(after.score, 100, "all measurable criteria satisfied");
  assert.equal(after.issues.length, 0);
  assert.ok(!/TODO/.test(fixed.content), "placeholder removed");
});

test("repair fixes a deficient landing (html) without breaking validity", () => {
  const landingJob: Job = { id: "L", title: "Sklep", brief: "Strona dla sklepu", categories: ["web"], lang: "pl" };
  const task = planJob(landingJob)[0]!;
  const bad: Artifact = { taskId: task.id, format: "html", content: "<!doctype html><html><body><p>nic</p></body></html>" };
  const fixed = repair(bad, task.acceptance, landingJob);
  const after = review(fixed, task.acceptance);
  assert.ok(after.score >= 80, `expected high score, got ${after.score}`);
  assert.match(fixed.content, /<h1>/);
});

test("executeJob reaches perfection (confidence 100) with repair", async () => {
  const report = await executeJob(job, { targetScore: 100 });
  assert.equal(report.confidence, 100, `expected 100, got ${report.confidence}`);
  assert.equal(report.gate, "auto");
});

test("best-of-N + refine never lowers below a single pass", async () => {
  const single = await executeJob(job, { candidates: 1, maxIterations: 1, targetScore: 100 });
  const tournament = await executeJob(job, { candidates: 3, maxIterations: 6, targetScore: 100 });
  assert.ok(tournament.confidence >= single.confidence);
});
