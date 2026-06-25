import { test } from "node:test";
import assert from "node:assert/strict";

import { analyzeHtml, auditFindings, renderAuditReport } from "../tools/seo.ts";
import { firstUrl } from "../tools/web.ts";
import { executeJob } from "../engine.ts";
import type { Job } from "../types.ts";

const BAD_HTML = `<!doctype html><html><head><title>Sklep</title></head>
<body><h1>A</h1><h1>B</h1><img src="x.jpg"><img src="y.jpg" alt="Y"><p>Krótko.</p></body></html>`;

test("analyzeHtml extracts real on-page signals", () => {
  const s = analyzeHtml(BAD_HTML, "http://example.com");
  assert.equal(s.titleLen, 5);
  assert.equal(s.h1Count, 2);
  assert.equal(s.imgCount, 2);
  assert.equal(s.imgWithAlt, 1);
  assert.equal(s.metaLen, 0); // no meta description
  assert.equal(s.https, false);
});

test("auditFindings flags the real issues with priorities", () => {
  const f = auditFindings(analyzeHtml(BAD_HTML, "http://example.com"));
  const areas = f.map((x) => x.area);
  assert.ok(areas.includes("Meta description"));
  assert.ok(areas.includes("Nagłówek H1"));
  assert.ok(areas.includes("Atrybuty ALT"));
  assert.ok(areas.includes("Bezpieczeństwo")); // http, not https
  assert.ok(f.some((x) => x.priority === "Wysoki"));
});

test("renderAuditReport sorts by priority and lists metrics", () => {
  const s = analyzeHtml(BAD_HTML, "http://example.com");
  const md = renderAuditReport("Test", s, auditFindings(s));
  assert.match(md, /Zmierzone sygnały on-page/);
  assert.match(md, /priorytet: Wysoki/);
});

test("firstUrl finds http and file URLs", () => {
  assert.equal(firstUrl("zrób audyt https://sklep.pl/ proszę"), "https://sklep.pl/");
  assert.equal(firstUrl("audyt file:./config/sample-site.html"), "file:./config/sample-site.html");
  assert.equal(firstUrl("brak linku"), undefined);
});

test("audit executor uses the real analyzer on a file: fixture", async () => {
  const job: Job = {
    id: "ja",
    title: "Audyt SEO sklepu",
    brief: "Zrób audyt SEO strony file:./config/sample-site.html i podaj rekomendacje.",
    categories: ["seo"],
    lang: "pl",
  };
  const report = await executeJob(job);
  const art = report.outcomes[0]!.artifact;
  assert.equal(art.meta?.engine, "tool:seo");
  assert.match(art.content, /Zmierzone sygnały on-page/);
  assert.match(art.content, /Meta description/);
});
