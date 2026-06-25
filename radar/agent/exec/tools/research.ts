// Research tool: gather sources, extract readable text, synthesize a grounded
// draft with inline citations. Turns the writer from "templated prose" into
// "evidence-backed content" — closer to how a senior writer actually works.

import { fetchHtml } from "./web.ts";

export interface Source {
  url: string;
  title?: string;
  text: string;
}

/** Strip chrome (script/style/nav/header/footer) and return readable text. */
export function extractMainText(html: string): { title?: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const cleaned = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { title, text: cleaned };
}

/** First N sentences of a source's text — the citable nugget. */
export function keyPoints(text: string, n = 2): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40)
    .slice(0, n);
}

export async function gatherSources(urls: string[]): Promise<Source[]> {
  const out: Source[] = [];
  for (const url of urls.slice(0, 4)) {
    try {
      const { title, text } = extractMainText(await fetchHtml(url));
      if (text) out.push({ url, title, text });
    } catch {
      /* skip unreachable source */
    }
  }
  return out;
}

/**
 * Synthesize an article grounded in sources, with [n] citations and a Źródła
 * section. Deterministic baseline (the LLM layer rewrites for fluency).
 */
export function synthesizeWithCitations(
  title: string,
  sources: Source[],
  keywords: string[],
  sections: string[],
): string {
  const kw = keywords.length ? keywords : ["temat"];
  const cited = sources.map((s, i) => ({ ...s, n: i + 1, points: keyPoints(s.text) }));

  const intro = `Niniejszy materiał o tematyce „${kw.slice(0, 3).join(", ")}" opracowano na podstawie ${cited.length} źródeł, z zachowaniem rzetelności i odwołań.`;

  const body = sections
    .map((sec, si) => {
      const src = cited[si % Math.max(1, cited.length)];
      const claim = src?.points[0] ?? `W obszarze „${kw[si % kw.length]}" stosujemy sprawdzone, mierzalne podejście.`;
      const ref = src ? ` [${src.n}]` : "";
      const extra = src?.points[1] ? ` ${src.points[1]}${ref}` : "";
      return `## ${sec}\n\n${claim}${ref}${extra} Wnioski przekładamy na konkretne, wdrożeniowe rekomendacje dla obszaru ${kw[si % kw.length]}.`;
    })
    .join("\n\n");

  const refs = cited.length
    ? "\n\n## Źródła\n" + cited.map((s) => `${s.n}. ${s.title ?? "Źródło"} — ${s.url}`).join("\n")
    : "";

  return `# ${title}\n\n${intro}\n\n${body}${refs}\n\n— Opracowano automatycznie przez RadarPL na podstawie analizy źródeł.`;
}
