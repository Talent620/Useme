import { test } from "node:test";
import assert from "node:assert/strict";

import { extractMainText, keyPoints, synthesizeWithCitations } from "../tools/research.ts";
import { n8nWorkflow, renderWorkflowJson } from "../tools/scaffold.ts";
import { planJob } from "../planner.ts";
import { executeJob } from "../engine.ts";
import type { Job } from "../types.ts";

// --- research ----------------------------------------------------------
test("extractMainText strips nav/footer/script chrome", () => {
  const { title, text } = extractMainText(
    "<html><head><title>T</title></head><body><nav>menu</nav><p>Realna treść artykułu.</p><footer>x</footer><script>var a=1</script></body></html>",
  );
  assert.equal(title, "T");
  assert.match(text, /Realna treść/);
  assert.ok(!/menu|var a/.test(text));
});

test("synthesizeWithCitations adds [n] citations and a Źródła section", () => {
  const md = synthesizeWithCitations(
    "Tytuł",
    [{ url: "https://a.pl", title: "A", text: "Pierwsze zdanie źródła o znaczeniu sporej długości. Drugie zdanie." }],
    ["wordpress"],
    ["Wstęp", "Korzyści"],
  );
  assert.match(md, /\[1\]/);
  assert.match(md, /## Źródła/);
  assert.match(md, /https:\/\/a\.pl/);
});

// --- scaffold ----------------------------------------------------------
test("n8nWorkflow builds a valid importable structure", () => {
  const wf = n8nWorkflow("Test", ["Pobierz dane API", "Zapisz wynik"]);
  assert.equal(wf.nodes.length, 3); // trigger + 2 steps
  assert.ok(wf.connections["Start"]);
  const json = renderWorkflowJson("Test", ["Pobierz dane API", "Zapisz wynik"]);
  const parsed = JSON.parse(json);
  assert.ok(Array.isArray(parsed.nodes) && parsed.connections);
});

// --- planner multi-task ------------------------------------------------
test("planJob emits a multi-deliverable graph for compound jobs", () => {
  const auto = planJob({ id: "a", title: "Automatyzacja", brief: "Zintegruj CRM z API i zapisz dane.", categories: ["automation"], lang: "pl" });
  assert.deepEqual(auto.map((t) => t.capability), ["spec", "scaffold"]);
  const ecom = planJob({ id: "e", title: "Sklep", brief: "Sklep WooCommerce z opisami.", categories: ["ecommerce"], lang: "pl" });
  assert.deepEqual(ecom.map((t) => t.capability), ["landing", "writer"]);
});

// --- engine end-to-end with new capabilities ---------------------------
test("automation job yields a spec + a valid n8n workflow JSON", async () => {
  const job: Job = { id: "j", title: "Automatyzacja n8n", brief: "Pobierz dane z API, przekształć i zapisz do bazy.", categories: ["automation"], lang: "pl" };
  const report = await executeJob(job);
  assert.equal(report.outcomes.length, 2);
  const scaffold = report.outcomes.find((o) => o.task.capability === "scaffold")!;
  assert.equal(scaffold.artifact.format, "json");
  assert.doesNotThrow(() => JSON.parse(scaffold.artifact.content));
  assert.ok(scaffold.review.passed);
});

test("landing is enriched with JSON-LD + OG and stays valid", async () => {
  const report = await executeJob({ id: "L", title: "Landing sklepu", brief: "Strona dla sklepu na WordPress", categories: ["web"], lang: "pl" });
  const art = report.outcomes[0]!.artifact;
  assert.match(art.content, /application\/ld\+json/);
  assert.match(art.content, /og:title/);
  assert.ok(report.outcomes[0]!.review.passed, "enriched landing still passes htmlValid");
});

test("writer grounds in real sources with citations when brief has URLs", async () => {
  const job: Job = {
    id: "w",
    title: "Artykuł o WooCommerce i SEO",
    brief: "Napisz artykuł na podstawie file:./config/sample-source1.html oraz file:./config/sample-source2.html",
    categories: ["copywriting"],
    lang: "pl",
  };
  const report = await executeJob(job);
  const art = report.outcomes[0]!.artifact;
  assert.equal(art.meta?.engine, "tool:research");
  assert.match(art.content, /## Źródła/);
  assert.match(art.content, /\[1\]/);
});

test("keyPoints returns substantial sentences only", () => {
  const pts = keyPoints("Krótkie. To jest wystarczająco długie zdanie aby zostać uznane za istotny punkt źródła.");
  assert.ok(pts.length >= 1 && pts[0]!.length > 40);
});
