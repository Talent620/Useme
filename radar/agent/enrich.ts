// Enrichment for the agent (relative core import so it runs standalone, no
// pnpm install needed). Heuristic baseline + optional OpenAI upgrade.

import {
  detectLang,
  extractBudget,
  tagCategories,
} from "../packages/core/src/index.ts";

export interface Enrichment {
  lang: string;
  budget?: number;
  categories: string[];
  intentSummary: string;
}

export const TAXONOMY: Record<string, string[]> = {
  wordpress: ["wordpress", "woocommerce", "elementor"],
  web: ["strona", "landing", "website", "frontend", "react", "next"],
  seo: ["seo", "pozycjonowanie", "audyt seo"],
  ecommerce: ["sklep", "shopify", "magento", "e-commerce", "allegro", "woocommerce"],
  copywriting: ["copywriting", "treści", "artykuł", "tekst", "copywriter"],
  graphic: ["logo", "grafika", "branding", "ui", "ux"],
  ads: ["google ads", "meta ads", "facebook ads", "kampania"],
  automation: ["automatyzacja", "n8n", "zapier", "integracja", "api"],
};

const SYSTEM = `Jesteś analitykiem sygnałów popytu. Zwróć JSON: {lang, budget, categories, intentSummary}.`;

export async function enrich(title: string, body: string): Promise<Enrichment> {
  const text = `${title}\n\n${body}`;
  const fallback: Enrichment = {
    lang: detectLang(text),
    budget: extractBudget(text),
    categories: tagCategories(text, TAXONOMY),
    intentSummary: title.slice(0, 140),
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: text.slice(0, 4000) },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const p = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    return {
      lang: p.lang || fallback.lang,
      budget: typeof p.budget === "number" ? p.budget : fallback.budget,
      categories: Array.isArray(p.categories) && p.categories.length ? p.categories.map(String) : fallback.categories,
      intentSummary: p.intentSummary || fallback.intentSummary,
    };
  } catch {
    return fallback;
  }
}
