import { test } from "node:test";
import assert from "node:assert/strict";

import { gateOpts, trainQualityModel, type QualityModel, type QualitySample } from "../quality.ts";
import { executeJob } from "../engine.ts";
import type { Job } from "../types.ts";

test("trainQualityModel raises the bar where acceptance is low", () => {
  const samples: QualitySample[] = [
    ...Array.from({ length: 3 }, () => ({ capability: "writer", outcome: "REJECTED" as const })),
    { capability: "writer", outcome: "ACCEPTED" as const }, // 1/4 accepted
    ...Array.from({ length: 4 }, () => ({ capability: "audit", outcome: "ACCEPTED" as const })), // 4/4
  ];
  const m = trainQualityModel(samples);
  assert.ok(m.byCapability["writer"]!.minConfidence > 80, "low acceptance => higher bar");
  assert.ok(m.byCapability["writer"]!.maxIterations > 3, "low acceptance => more revision");
  assert.equal(m.byCapability["audit"]!.minConfidence, 80, "high acceptance => base bar");
  assert.equal(m.byCapability["audit"]!.maxIterations, 3);
});

test("insufficient samples keep the base bar", () => {
  const m = trainQualityModel([{ capability: "spec", outcome: "REJECTED" }]);
  assert.equal(m.byCapability["spec"]!.minConfidence, 80);
});

test("gateOpts takes the strictest recommendation and flags blocked capabilities", () => {
  const model: QualityModel = {
    trainedOn: 10,
    byCapability: {
      spec: { capability: "spec", n: 5, accepted: 1, acceptanceRate: 0.2, minConfidence: 95, maxIterations: 5, autoAllowed: false },
    },
  };
  assert.deepEqual(gateOpts(model, ["spec", "scaffold"], { minConfidence: 80, maxIterations: 3 }), { minConfidence: 95, maxIterations: 5, blocked: ["spec"] });
  assert.deepEqual(gateOpts(model, ["writer"], { minConfidence: 80, maxIterations: 3 }), { minConfidence: 80, maxIterations: 3, blocked: [] });
  assert.deepEqual(gateOpts(undefined, ["spec"], { minConfidence: 80, maxIterations: 3 }), { minConfidence: 80, maxIterations: 3, blocked: [] });
});

test("client rejections block auto-delivery even for a criteria-perfect job", async () => {
  const job: Job = { id: "j", title: "Automatyzacja", brief: "Pobierz dane z API i zapisz.", categories: ["automation"], lang: "pl" };
  const base = await executeJob(job);
  assert.equal(base.gate, "auto", "perfect-by-criteria delivers automatically");
  // Capability with poor client acceptance => always human review.
  const strict: QualityModel = {
    trainedOn: 9,
    byCapability: { spec: { capability: "spec", n: 6, accepted: 1, acceptanceRate: 0.17, minConfidence: 80, maxIterations: 4, autoAllowed: false } },
  };
  const gated = await executeJob(job, { quality: strict });
  assert.equal(gated.gate, "review", "blocked capability escalates to human");
});

test("trainQualityModel sets autoAllowed from acceptance rate", () => {
  const m = trainQualityModel([
    ...Array.from({ length: 4 }, () => ({ capability: "writer", outcome: "REJECTED" as const })),
    { capability: "writer", outcome: "ACCEPTED" as const },
    ...Array.from({ length: 4 }, () => ({ capability: "audit", outcome: "ACCEPTED" as const })),
    { capability: "audit", outcome: "REJECTED" as const },
  ]);
  assert.equal(m.byCapability["writer"]!.autoAllowed, false); // 1/5
  assert.equal(m.byCapability["audit"]!.autoAllowed, true); // 4/5
});
