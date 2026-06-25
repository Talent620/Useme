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

test("gateOpts takes the strictest recommendation across capabilities", () => {
  const model: QualityModel = {
    trainedOn: 10,
    byCapability: {
      spec: { capability: "spec", n: 5, accepted: 1, acceptanceRate: 0.2, minConfidence: 95, maxIterations: 5 },
    },
  };
  assert.deepEqual(gateOpts(model, ["spec", "scaffold"], { minConfidence: 80, maxIterations: 3 }), { minConfidence: 95, maxIterations: 5 });
  assert.deepEqual(gateOpts(model, ["writer"], { minConfidence: 80, maxIterations: 3 }), { minConfidence: 80, maxIterations: 3 });
  assert.deepEqual(gateOpts(undefined, ["spec"], { minConfidence: 80, maxIterations: 3 }), { minConfidence: 80, maxIterations: 3 });
});

test("learned quality bar flips a borderline job from auto to review", async () => {
  const job: Job = { id: "j", title: "Automatyzacja", brief: "Pobierz dane z API i zapisz.", categories: ["automation"], lang: "pl" };
  const base = await executeJob(job); // typically auto
  const strict: QualityModel = {
    trainedOn: 9,
    byCapability: { spec: { capability: "spec", n: 6, accepted: 1, acceptanceRate: 0.17, minConfidence: 96, maxIterations: 4 } },
  };
  const gated = await executeJob(job, { quality: strict });
  assert.equal(gated.gate, "review", "raised bar escalates the same deliverable");
  assert.ok(base.confidence < 96, "confidence below the learned bar");
});
