import { test } from "node:test";
import assert from "node:assert/strict";

import { gather, planTools } from "../orchestrator.ts";
import { generateImage } from "../tools/image.ts";
import { executeJob } from "../engine.ts";
import type { Job } from "../types.ts";

const writerWithUrls: Job = { id: "w", title: "Artykuł", brief: "Napisz na podstawie file:./config/sample-source1.html", categories: ["copywriting"], lang: "pl" };
const auditJob: Job = { id: "a", title: "Audyt", brief: "Audyt file:./config/sample-site.html", categories: ["seo"], lang: "pl" };
const landingJob: Job = { id: "l", title: "Landing", brief: "Strona dla sklepu", categories: ["web"], lang: "pl" };

test("planTools selects tools by job + capability", () => {
  assert.deepEqual(planTools(writerWithUrls, "writer"), ["research"]);
  assert.deepEqual(planTools({ ...writerWithUrls, brief: "bez url" }, "writer"), []);
  assert.deepEqual(planTools(auditJob, "audit"), ["seo"]);
  assert.deepEqual(planTools(landingJob, "landing"), ["image"]);
});

test("gather composes a bundle from applicable tools", async () => {
  const w = await gather(writerWithUrls, "writer");
  assert.ok(w.research && w.research.length >= 1);
  const a = await gather(auditJob, "audit");
  assert.ok(a.seo && a.seo.findings.length >= 1);
  const l = await gather(landingJob, "landing");
  assert.ok(l.image && l.image.src.startsWith("data:image/svg+xml"));
});

test("generateImage is deterministic and embeddable (SVG fallback)", async () => {
  const a = await generateImage("sklep woocommerce, gradient");
  const b = await generateImage("sklep woocommerce, gradient");
  const c = await generateImage("zupełnie inny prompt seo");
  assert.equal(a.src, b.src, "same prompt => same asset");
  assert.notEqual(a.src, c.src, "different prompt => different asset");
  assert.equal(a.kind, "svg");
  assert.match(a.svg!, /<svg/);
  assert.match(a.src, /^data:image\/svg\+xml;base64,/);
});

test("landing embeds the orchestrated image asset", async () => {
  const report = await executeJob(landingJob);
  const art = report.outcomes[0]!.artifact;
  assert.equal(art.meta?.hero, "svg");
  assert.match(art.content, /class="art"/);
  assert.ok(report.outcomes[0]!.review.passed);
});
