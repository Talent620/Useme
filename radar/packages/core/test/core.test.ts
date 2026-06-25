import { test } from "node:test";
import assert from "node:assert/strict";

import { dedupe, dedupeKey, normalizeForHash } from "../src/signals/dedup.ts";
import { recencyFactor, scoreSignal } from "../src/signals/score.ts";
import { matchSignal } from "../src/icp/match.ts";
import { buildProposal } from "../src/proposal/template.ts";
import { extractBudget, toSignal } from "../src/sources/parse.ts";
import { learnedBoost, trainModel } from "../src/learn.ts";
import type { ICP, Signal } from "../src/signals/types.ts";

const NOW = Date.parse("2026-06-25T12:00:00Z");

function mkSignal(over: Partial<Signal> = {}): Signal {
  return {
    id: "s1",
    source: "job_board",
    sourceName: "useme",
    url: "https://useme.com/pl/jobs/x,1/",
    title: "Szukam freelancera do strony WordPress",
    body: "Potrzebuję wykonać landing page na WordPress. Budżet: 1500 zł. Pilne.",
    publishedAt: "2026-06-25T08:00:00Z",
    fetchedAt: "2026-06-25T09:00:00Z",
    lang: "pl",
    budget: 1500,
    categories: ["wordpress", "web"],
    dedupeKey: dedupeKey("Szukam freelancera do strony WordPress", 1500),
    ...over,
  };
}

const WP_ICP: ICP = {
  id: "icp1",
  tenantId: "t1",
  name: "WordPress dev",
  keywords: ["wordpress", "landing page", "strona"],
  excludeKeywords: ["wolontariat", "za darmo"],
  categories: ["wordpress", "web"],
  langs: ["pl"],
  minBudget: 500,
  maxBudget: 10000,
};

test("normalizeForHash strips diacritics and punctuation", () => {
  assert.equal(normalizeForHash("Budżet: 1 500 zł!!"), "budzet 1 500 zl");
});

test("dedupe collapses reposts, keeps earliest", () => {
  const a = mkSignal({ id: "a", publishedAt: "2026-06-25T08:00:00Z" });
  const b = mkSignal({ id: "b", publishedAt: "2026-06-24T08:00:00Z" });
  const out = dedupe([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "b"); // earliest kept
});

test("recencyFactor: fresh=1, decays over time", () => {
  assert.equal(recencyFactor("2026-06-25T00:00:00Z", NOW), 1);
  const old = recencyFactor("2026-06-20T00:00:00Z", NOW); // ~5.5 days old
  assert.ok(old > 0 && old < 1, `partial decay expected, got ${old}`);
  assert.equal(recencyFactor("2026-05-01T00:00:00Z", NOW), 0); // fully decayed
});

test("scoreSignal: strong match scores high", () => {
  const r = scoreSignal(mkSignal(), WP_ICP, NOW);
  assert.ok(r.score >= 70, `expected high score, got ${r.score}`);
  assert.ok(r.matchedKeywords.includes("wordpress"));
});

test("scoreSignal: exclude keyword zeroes the score", () => {
  const r = scoreSignal(
    mkSignal({ body: "Strona WordPress za darmo, wolontariat." }),
    WP_ICP,
    NOW,
  );
  assert.equal(r.score, 0);
});

test("scoreSignal: wrong language is dropped", () => {
  const r = scoreSignal(mkSignal({ lang: "de" }), WP_ICP, NOW);
  assert.equal(r.score, 0);
});

test("scoreSignal: budget out of range loses budget points but can still match", () => {
  const r = scoreSignal(mkSignal({ budget: 50 }), WP_ICP, NOW);
  assert.ok(r.reasons.some((x) => x.includes("out of range")));
});

test("matchSignal: emits lead above threshold, sorted by score", () => {
  const leads = matchSignal(mkSignal(), [WP_ICP], { now: NOW, threshold: 45 });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].tenantId, "t1");
  assert.ok(leads[0].score >= 45);
});

test("matchSignal: below threshold emits nothing", () => {
  const weak = mkSignal({
    title: "Notatka",
    body: "Ogólne info bez intencji.",
    budget: undefined,
    categories: [],
  });
  const leads = matchSignal(weak, [WP_ICP], { now: NOW, threshold: 45 });
  assert.equal(leads.length, 0);
});

test("extractBudget parses PLN, spaces and USD", () => {
  assert.equal(extractBudget("Budżet: 1 500 zł"), 1500);
  assert.equal(extractBudget("2000 PLN"), 2000);
  assert.equal(extractBudget("$800"), 3200);
  assert.equal(extractBudget("brak kwoty"), undefined);
});

test("toSignal normalizes a raw listing end-to-end", () => {
  const sig = toSignal(
    {
      url: "https://x/1",
      title: "Zlecę audyt SEO sklepu",
      body: "Potrzebuję audytu SEO. Budżet 3000 zł.",
    },
    "job_board",
    "oferia",
    "id1",
    NOW,
    { seo: ["seo", "audyt"], ecommerce: ["sklep"] },
  );
  assert.equal(sig.lang, "pl");
  assert.equal(sig.budget, 3000);
  assert.deepEqual(sig.categories.sort(), ["ecommerce", "seo"]);
  assert.ok(sig.dedupeKey.length > 0);
});

test("trainModel learns positive/negative keyword weights", () => {
  const model = trainModel([
    { keywords: ["wordpress", "pilne"], label: "pos" },
    { keywords: ["wordpress", "budzet"], label: "pos" },
    { keywords: ["wolontariat"], label: "neg" },
    { keywords: ["wolontariat", "za darmo"], label: "neg" },
  ]);
  assert.ok(model.keywordWeights["wordpress"] > 0, "WON keyword positive");
  assert.ok(model.keywordWeights["wolontariat"] < 0, "REJECTED keyword negative");
  assert.equal(model.trainedOn, 4);
});

test("learnedBoost nudges scores within bounds and respects sign", () => {
  const model = trainModel([
    { keywords: ["wordpress"], label: "pos" },
    { keywords: ["wordpress"], label: "pos" },
    { keywords: ["spam"], label: "neg" },
    { keywords: ["spam"], label: "neg" },
  ]);
  assert.ok(learnedBoost(["wordpress"], model) > 0);
  assert.ok(learnedBoost(["spam"], model) < 0);
  assert.equal(learnedBoost(["wordpress"], undefined), 0);
  assert.ok(Math.abs(learnedBoost(["wordpress", "spam"], model)) <= 15);
});

test("scoreSignal applies a learned overlay on top of the base", () => {
  const base = scoreSignal(mkSignal(), WP_ICP, NOW).score;
  const learnedICP: ICP = {
    ...WP_ICP,
    learned: { keywordWeights: { wordpress: 2 }, trainedOn: 10 },
  };
  const boosted = scoreSignal(mkSignal(), learnedICP, NOW).score;
  assert.ok(boosted >= base, `learned overlay should not lower a positive match (${boosted} vs ${base})`);
});

test("buildProposal produces a non-empty grounded draft", () => {
  const draft = buildProposal(mkSignal(), {
    name: "Jan Kowalski",
    role: "freelancer WordPress",
    portfolioUrl: "https://jan.dev",
    proofPoints: ["30+ wdrożeń WordPress", "śr. czas realizacji 5 dni"],
  });
  assert.ok(draft.subject.includes("mogę pomóc"));
  assert.ok(draft.body.includes("Jan Kowalski"));
  assert.ok(draft.body.includes("Portfolio: https://jan.dev"));
  assert.ok(draft.personalizationSlots.includes("price"));
});
