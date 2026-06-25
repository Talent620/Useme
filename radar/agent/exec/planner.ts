// Planner agent. Routes a job to a capability and defines the acceptance
// criteria the deliverable must meet. Deterministic so plans are reproducible.

import type { AcceptanceCriterion, Capability, Job, TaskSpec } from "./types.ts";

const STOP = new Set(["i", "w", "na", "do", "z", "ze", "że", "to", "się", "jest", "dla", "oraz", "lub", "the", "and", "for", "with", "potrzebuję", "szukam", "zlecę", "budżet"]);

const URL_TOKENS = new Set(["file", "http", "https", "config", "html", "www", "com", "pl"]);

function deriveKeywords(job: Job): string[] {
  const toks = job.brief
    .toLowerCase()
    .replace(/\b(?:https?:\/\/|file:)[^\s)<>"']+/gi, " ") // drop URLs entirely
    .replace(/[^a-ząćęłńóśźż0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w) && !URL_TOKENS.has(w));
  const freq = new Map<string, number>();
  for (const t of toks) freq.set(t, (freq.get(t) ?? 0) + 1);
  const salient = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
  return [...new Set([...job.categories, ...salient])].slice(0, 8);
}

function pickCapability(job: Job): Capability {
  const c = new Set(job.categories);
  if (c.has("copywriting")) return "writer";
  if (c.has("seo") || c.has("ads")) return "audit";
  if (c.has("automation")) return "spec";
  if (c.has("web") || c.has("wordpress") || c.has("ecommerce")) return "landing";
  if (/tłumacz|translation|translate|przetłumacz/i.test(job.brief)) return "translate";
  return "writer";
}

function criteriaFor(cap: Capability, keywords: string[]): AcceptanceCriterion[] {
  const kw: AcceptanceCriterion = { id: "kw", type: "keywordCoverage", params: { keywords }, weight: 25 };
  const noph: AcceptanceCriterion = { id: "noph", type: "noPlaceholders", weight: 15 };
  switch (cap) {
    case "writer":
      return [
        { id: "len", type: "minWords", params: { min: 300 }, weight: 30 },
        { id: "sec", type: "hasSections", params: { sections: ["Wstęp", "Korzyści", "Podsumowanie"] }, weight: 30 },
        kw, noph,
      ];
    case "landing":
      return [
        { id: "html", type: "htmlValid", weight: 35 },
        { id: "sec", type: "hasSections", params: { sections: ["<h1", "Kontakt", "cta"] }, weight: 25 },
        kw, noph,
      ];
    case "audit":
      return [
        { id: "len", type: "minWords", params: { min: 200 }, weight: 25 },
        { id: "sec", type: "hasSections", params: { sections: ["Podsumowanie", "Rekomendacje", "Następne kroki"] }, weight: 35 },
        kw, noph,
      ];
    case "spec":
      return [
        { id: "len", type: "minWords", params: { min: 180 }, weight: 25 },
        { id: "sec", type: "hasSections", params: { sections: ["Cel", "Zakres", "Architektura", "Kroki wdrożenia"] }, weight: 35 },
        kw, noph,
      ];
    case "scaffold":
      return [
        { id: "json", type: "jsonValid", params: { minKeys: 3 }, weight: 55 },
        { id: "sec", type: "hasSections", params: { sections: ["nodes", "connections"] }, weight: 30 },
        noph,
      ];
    case "translate":
      return [
        { id: "len", type: "minWords", params: { min: 30 }, weight: 50 },
        noph,
      ];
  }
}

const INSTRUCTION: Record<Capability, string> = {
  writer: "Napisz gotowy do publikacji tekst zgodny z briefem.",
  landing: "Zbuduj kompletny, semantyczny landing page (HTML).",
  audit: "Wykonaj audyt z priorytetyzowanymi rekomendacjami.",
  spec: "Przygotuj specyfikację techniczną gotową do wdrożenia.",
  scaffold: "Zbuduj importowalny workflow automatyzacji (n8n JSON).",
  translate: "Przetłumacz treść wiernie, zachowując sens i ton.",
};

/** Decompose a job into a capability graph — several deliverables when the job
 *  genuinely needs them (true multi-agent execution). */
function capabilitiesFor(job: Job): Capability[] {
  const c = new Set(job.categories);
  if (c.has("automation")) return ["spec", "scaffold"]; // spec + importowalny workflow
  if (c.has("seo") || c.has("ads")) return ["audit"]; // audyt ma priorytet nad ecommerce
  if (c.has("ecommerce")) return ["landing", "writer"]; // strona + treści/opisy
  return [pickCapability(job)];
}

export function planJob(job: Job): TaskSpec[] {
  const keywords = deriveKeywords(job);
  return capabilitiesFor(job).map((capability, i) => ({
    id: `${job.id}-t${i + 1}`,
    capability,
    instruction: INSTRUCTION[capability],
    acceptance: criteriaFor(capability, keywords),
  }));
}
