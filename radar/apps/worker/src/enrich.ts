// AI enrichment agent. Normalizes messy listings into structured fields the
// pure scorer can trust. Falls back to heuristics if no API key is present,
// so the pipeline never hard-depends on the model being available.

import { detectLang, extractBudget, tagCategories, type Signal } from "@radar/core";

export interface Enrichment {
  lang: string;
  budget?: number;
  categories: string[];
  /** One-line summary of what the buyer actually wants. */
  intentSummary: string;
}

const SYSTEM = `Jesteś analitykiem sygnałów popytu. Z ogłoszenia wyciągasz:
- język (pl/en),
- budżet w PLN jeśli podany (liczba albo null),
- 1-5 kategorii/umiejętności (krótkie tagi),
- jednozdaniowe streszczenie intencji kupującego.
Odpowiadasz wyłącznie JSON-em o polach: lang, budget, categories, intentSummary.`;

export async function enrich(
  signal: Pick<Signal, "title" | "body">,
  taxonomy: Record<string, string[]>,
): Promise<Enrichment> {
  const apiKey = process.env.OPENAI_API_KEY;
  const text = `${signal.title}\n\n${signal.body}`;

  // Heuristic fallback (also the baseline the model output is validated against).
  const fallback: Enrichment = {
    lang: detectLang(text),
    budget: extractBudget(text),
    categories: tagCategories(text, taxonomy),
    intentSummary: signal.title.slice(0, 140),
  };
  if (!apiKey) return fallback;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    return {
      lang: parsed.lang || fallback.lang,
      budget: typeof parsed.budget === "number" ? parsed.budget : fallback.budget,
      categories: Array.isArray(parsed.categories) && parsed.categories.length
        ? parsed.categories.map(String)
        : fallback.categories,
      intentSummary: parsed.intentSummary || fallback.intentSummary,
    };
  } catch {
    return fallback;
  }
}
