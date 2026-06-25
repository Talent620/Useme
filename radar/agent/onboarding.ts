// Self-service onboarding. Turns a freelancer's free-text profile into a working
// ICP + sender profile, then runs an instant proof-of-value preview (the leads
// they'd have gotten) — the conversion mechanic. Fully automated: no manual ICP
// config per customer, which is what lets the engine onboard the freelancers it
// finds (the self-targeting flywheel).

import {
  buildProposal,
  detectLang,
  matchSignal,
  toSignal,
  type Lead,
  type Signal,
} from "../packages/core/src/index.ts";
import type { SenderProfile } from "../packages/core/src/proposal/template.ts";
import { loadConfig, resolveFeed, tenantICP, tenantsOverlayPath, type AgentConfig, type TenantDef } from "./config.ts";
import { fetchListings } from "./fetch.ts";
import { TAXONOMY } from "./enrich.ts";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SignupProfile {
  name: string;
  email: string;
  /** Free text: what they do, skills, services. */
  headline: string;
  minBudget?: number;
  maxBudget?: number;
  lang?: string;
  proofPoints?: string[];
  channel?: TenantDef["channel"];
}

// Map a derived category to a human role for the outreach signature.
const ROLE_BY_CATEGORY: Record<string, string> = {
  wordpress: "freelancer WordPress",
  web: "web developer",
  seo: "specjalista SEO",
  ecommerce: "specjalista e-commerce",
  copywriting: "copywriter",
  graphic: "grafik",
  ads: "specjalista od reklam",
  automation: "specjalista od automatyzacji",
};

const STOPWORDS = new Set([
  "i", "w", "na", "do", "z", "ze", "że", "to", "się", "jest", "dla", "oraz", "lub",
  "też", "a", "o", "po", "jako", "robię", "tworzę", "zajmuję", "moje", "mój", "the",
  "and", "for", "with", "make", "build", "i'm", "im", "oraz",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-ząćęłńóśźż0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

/** Derive ICP keywords + categories from free text using the taxonomy + salient tokens. */
export function synthesizeICP(profile: SignupProfile): {
  keywords: string[];
  categories: string[];
  langs: string[];
} {
  const text = profile.headline.toLowerCase();
  const categories: string[] = [];
  const taxoKeywords: string[] = [];
  for (const [cat, terms] of Object.entries(TAXONOMY)) {
    const hit = terms.filter((t) => text.includes(t));
    if (hit.length) {
      categories.push(cat);
      taxoKeywords.push(...hit);
    }
  }
  // Salient tokens by frequency, to complement taxonomy matches.
  const freq = new Map<string, number>();
  for (const tok of tokenize(profile.headline)) freq.set(tok, (freq.get(tok) ?? 0) + 1);
  const salient = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);

  const keywords = [...new Set([...taxoKeywords, ...salient])].slice(0, 12);
  const langs = [profile.lang ?? detectLang(profile.headline)];
  return { keywords, categories: categories.length ? [...new Set(categories)] : ["web"], langs };
}

export function buildTenant(profile: SignupProfile): TenantDef {
  const { keywords, categories, langs } = synthesizeICP(profile);
  const id = `t_${slug(profile.email)}`;
  const role = ROLE_BY_CATEGORY[categories[0]!] ?? "freelancer";
  const sender: SenderProfile = {
    name: profile.name,
    role,
    proofPoints: profile.proofPoints ?? [`specjalizacja: ${categories.join(", ")}`],
  };
  return {
    id,
    name: profile.name,
    email: profile.email,
    channel: profile.channel ?? "file",
    plan: "TRIAL",
    sender,
    icp: {
      name: `${role} (auto)`,
      keywords,
      excludeKeywords: ["wolontariat", "za darmo", "praca na etat"],
      categories,
      langs,
      minBudget: profile.minBudget ?? 300,
      maxBudget: profile.maxBudget ?? 100000,
    },
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}

/**
 * Instant proof-of-value: score current source listings against the new tenant's
 * ICP WITHOUT persisting. Returns the leads (with drafts) they'd get right now.
 */
export async function previewForProfile(
  profile: SignupProfile,
  cfg: AgentConfig = loadConfig(),
  now = Date.now(),
): Promise<{ tenant: TenantDef; leads: (Lead & { title: string; url: string; draftSubject: string })[] }> {
  const tenant = buildTenant(profile);
  const icp = tenantICP(tenant);
  const collected: Signal[] = [];

  for (const src of cfg.sources.filter((s) => s.enabled)) {
    try {
      const { listings } = await fetchListings(resolveFeed(src.feed));
      for (const raw of listings) {
        collected.push(toSignal(raw, src.kind, src.name, `prev_${collected.length}`, now, TAXONOMY));
      }
    } catch {
      /* preview is best-effort; skip unreachable sources */
    }
  }

  const leads = collected
    .flatMap((sig) => {
      const [lead] = matchSignal(sig, [icp], { now, threshold: cfg.settings.threshold });
      if (!lead) return [];
      const draft = buildProposal(sig, tenant.sender);
      return [{ ...lead, title: sig.title, url: sig.url, draftSubject: draft.subject }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return { tenant, leads };
}

/** Persist a new tenant into the runtime overlay so future cycles serve them. */
export function registerTenant(tenant: TenantDef): { added: boolean; total: number } {
  const path = tenantsOverlayPath();
  let list: TenantDef[] = [];
  if (existsSync(path)) {
    try {
      list = JSON.parse(readFileSync(path, "utf8")) as TenantDef[];
    } catch {
      list = [];
    }
  }
  if (list.some((t) => t.id === tenant.id)) return { added: false, total: list.length };
  list.push(tenant);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(list, null, 2));
  return { added: true, total: list.length };
}
