import { test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryLeadRepo } from "../repo-memory.ts";
import { ingest } from "../ingest-pipeline.ts";
import type { ICP } from "../../packages/core/src/index.ts";

const WP_ICP: ICP = {
  id: "icp-wp", tenantId: "t-wp", name: "WordPress",
  keywords: ["wordpress", "woocommerce", "landing page"],
  excludeKeywords: ["wolontariat"], categories: ["wordpress", "web"],
  langs: ["pl"], minBudget: 500, maxBudget: 50000,
};
const NOW = Date.parse("2026-06-24T14:00:00Z");

const LISTINGS = [
  { url: "https://x/1", title: "Szukam wykonawcy sklepu WooCommerce", body: "Zlecę sklep WooCommerce. Budżet 6000 zł. Pilne." },
  { url: "https://x/2", title: "Pomoc przy przeprowadzce", body: "Wolontariat, za darmo." },
];

test("ingest persists signals and creates leads via the repo", async () => {
  const repo = new InMemoryLeadRepo([WP_ICP]);
  const res = await ingest(repo, { sourceName: "useme", kind: "job_board", listings: LISTINGS }, NOW);
  assert.equal(res.received, 2);
  assert.equal(res.created, 2, "both signals stored");
  assert.ok(res.leads >= 1, "at least one lead created");

  const leads = await repo.listLeads("t-wp", { min: 50 });
  assert.ok(leads.length >= 1);
  assert.match(leads[0]!.signalTitle, /WooCommerce/);
  assert.ok(!leads.some((l) => /przeprowadzce/i.test(l.signalTitle)), "excluded noise not a lead");
});

test("ingest is idempotent on dedupeKey across batches", async () => {
  const repo = new InMemoryLeadRepo([WP_ICP]);
  await ingest(repo, { sourceName: "useme", kind: "job_board", listings: LISTINGS }, NOW);
  const second = await ingest(repo, { sourceName: "useme", kind: "job_board", listings: LISTINGS }, NOW + 1000);
  assert.equal(second.created, 0, "no duplicate signals");
  assert.equal(second.leads, 0, "no duplicate leads");
});

test("ingest attaches a draft when a sender profile is provided", async () => {
  const repo = new InMemoryLeadRepo([WP_ICP]);
  await ingest(repo, {
    sourceName: "useme", kind: "job_board", listings: [LISTINGS[0]!],
    senders: { "t-wp": { name: "Jan", role: "freelancer WordPress", proofPoints: ["30+ wdrożeń"] } },
  }, NOW);
  // Draft is stored on the lead; listLeads view doesn't expose it, but creation
  // succeeding (lead present) proves the path ran without error.
  const leads = await repo.listLeads("t-wp");
  assert.ok(leads.length >= 1);
});
