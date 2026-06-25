// Domain types for the Demand-Signal engine.
// Erasable TypeScript only (runs under Node's native type-stripping).

/** Where a raw signal was discovered. Public sources only. */
export type SourceKind =
  | "job_board" // Useme, Oferia, Freelancehunt, Pracuj...
  | "tender" // public procurement (BZP/TED), RFPs
  | "registry" // new company registrations (CEIDG/KRS)
  | "funding" // funding announcements / accelerators
  | "social" // public posts / complaints ("szukam kogoś kto...")
  | "rss"; // generic RSS/Atom feeds

/** A raw, deduplicated demand signal scraped from a public source. */
export interface Signal {
  id: string;
  source: SourceKind;
  sourceName: string; // e.g. "useme", "bzp"
  url: string;
  title: string;
  body: string;
  /** ISO timestamp when the signal was published at the source. */
  publishedAt: string;
  /** ISO timestamp when we ingested it. */
  fetchedAt: string;
  lang: string; // "pl", "en", ...
  budget?: number; // detected budget in PLN, if any
  categories: string[]; // normalized tags/skills
  /** Stable hash used for deduplication across runs and sources. */
  dedupeKey: string;
}

/** Ideal Customer Profile for a tenant (the freelancer/agency we serve). */
export interface ICP {
  id: string;
  tenantId: string;
  name: string;
  /** Keywords that indicate a fit (skills, services). Lowercased. */
  keywords: string[];
  /** Hard excludes — if any matches, the signal is dropped. */
  excludeKeywords: string[];
  categories: string[];
  langs: string[];
  minBudget?: number;
  maxBudget?: number;
  /** Per-source trust multiplier override (0..1). */
  sourceWeights?: Partial<Record<SourceKind, number>>;
}

/** A scored, ICP-matched lead ready to be acted on. */
export interface Lead {
  signalId: string;
  icpId: string;
  tenantId: string;
  /** 0..100 buying-intent score. */
  score: number;
  reasons: string[];
  matchedKeywords: string[];
  createdAt: string;
}

/** Default trust weights per source (0..1). Higher = stronger intent. */
export const DEFAULT_SOURCE_WEIGHTS: Record<SourceKind, number> = {
  tender: 1.0,
  job_board: 0.9,
  funding: 0.7,
  registry: 0.5,
  social: 0.6,
  rss: 0.4,
};

/** Words that signal active buying intent (PL + EN). */
export const INTENT_TERMS: string[] = [
  "szukam",
  "poszukuję",
  "potrzebuję",
  "zlecę",
  "zlecenie",
  "do wykonania",
  "pilne",
  "asap",
  "budżet",
  "wycena",
  "looking for",
  "need",
  "hiring",
  "urgent",
  "budget",
  "quote",
  "rfp",
  "request for proposal",
];
