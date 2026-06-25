import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { buildTenant, previewForProfile, registerTenant, synthesizeICP } from "../onboarding.ts";
import { loadConfig } from "../config.ts";

const NOW = Date.parse("2026-06-24T14:00:00Z");

function freshEnv() {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-onb-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_TENANTS_FILE = resolve(dir, "tenants-extra.json");
  return dir;
}

test("synthesizeICP derives categories + keywords from free text", () => {
  const r = synthesizeICP({ name: "Jan", email: "j@x.pl", headline: "Tworzę sklepy WooCommerce na WordPress i robię pozycjonowanie SEO" });
  assert.ok(r.categories.includes("wordpress"));
  assert.ok(r.categories.includes("seo"));
  assert.ok(r.keywords.includes("woocommerce") || r.keywords.includes("wordpress"));
  assert.equal(r.langs[0], "pl");
});

test("buildTenant produces a TRIAL tenant with role + ICP", () => {
  const t = buildTenant({ name: "Anna", email: "anna@x.pl", headline: "Audyty SEO i kampanie Google Ads" });
  assert.equal(t.plan, "TRIAL");
  assert.match(t.sender.role, /SEO/);
  assert.ok(t.icp.keywords.length > 0);
  assert.ok(t.icp.excludeKeywords.includes("wolontariat"));
  assert.ok(t.id.startsWith("t_"));
});

test("previewForProfile returns instant proof-of-value leads from the sample feed", async () => {
  freshEnv();
  const { tenant, leads } = await previewForProfile(
    { name: "Jan", email: "jan@x.pl", headline: "Robię strony i sklepy na WordPress / WooCommerce" },
    loadConfig(),
    NOW,
  );
  assert.ok(tenant.id.startsWith("t_"));
  assert.ok(leads.length > 0, "should surface matching leads");
  assert.ok(leads[0]!.score > 0 && leads[0]!.draftSubject.length > 0);
  assert.ok(leads.every((l) => !/przeprowadzce|wolontariat/i.test(l.title)), "noise excluded");
});

test("registerTenant writes overlay and loadConfig merges it", async () => {
  freshEnv();
  const t = buildTenant({ name: "Nowy", email: "nowy@x.pl", headline: "Automatyzacje n8n i integracje API" });
  const before = loadConfig().tenants.length;
  const r1 = registerTenant(t);
  assert.equal(r1.added, true);
  const after = loadConfig().tenants;
  assert.equal(after.length, before + 1);
  assert.ok(after.some((x) => x.id === t.id));
  // Idempotent: registering again does not duplicate.
  const r2 = registerTenant(t);
  assert.equal(r2.added, false);
  assert.equal(loadConfig().tenants.length, before + 1);
});
