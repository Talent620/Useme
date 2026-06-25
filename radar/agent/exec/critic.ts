// Self-verification. Scores an artifact against its acceptance criteria,
// deterministically (auditable). The engine uses the issues list to drive
// revision. Optional LLM critique can be layered on top, but the gate is
// always grounded in these objective checks.

import type { AcceptanceCriterion, Artifact, ReviewResult } from "./types.ts";

export function wordCount(text: string): number {
  const stripped = text.replace(/<[^>]+>/g, " ");
  return (stripped.match(/\b[\p{L}\p{N}']+\b/gu) ?? []).length;
}

const PLACEHOLDER_RE = /\b(TODO|FIXME|lorem ipsum|placeholder|tbd)\b|\[\.\.\.\]|\{\{[^}]*\}\}|xxx{2,}/i;

function evalCriterion(c: AcceptanceCriterion, art: Artifact): { ratio: number; issue?: string } {
  const text = art.content;
  switch (c.type) {
    case "minWords": {
      const min = Number(c.params?.min ?? 100);
      const n = wordCount(text);
      const ratio = Math.min(1, n / min);
      return ratio >= 1 ? { ratio } : { ratio, issue: `za krótkie: ${n}/${min} słów` };
    }
    case "hasSections": {
      const want = (c.params?.sections as string[]) ?? [];
      if (!want.length) return { ratio: 1 };
      const lower = text.toLowerCase();
      const present = want.filter((s) => lower.includes(s.toLowerCase()));
      const ratio = present.length / want.length;
      const missing = want.filter((s) => !lower.includes(s.toLowerCase()));
      return ratio >= 1 ? { ratio } : { ratio, issue: `brak sekcji: ${missing.join(", ")}` };
    }
    case "keywordCoverage": {
      const kws = (c.params?.keywords as string[]) ?? [];
      if (!kws.length) return { ratio: 1 };
      const lower = text.toLowerCase();
      const hit = kws.filter((k) => lower.includes(k.toLowerCase()));
      const ratio = hit.length / kws.length;
      const missing = kws.filter((k) => !lower.includes(k.toLowerCase()));
      return ratio >= 0.6 ? { ratio } : { ratio, issue: `słabe pokrycie słów kluczowych, brak: ${missing.join(", ")}` };
    }
    case "noPlaceholders":
      return PLACEHOLDER_RE.test(text) ? { ratio: 0, issue: "zawiera placeholdery/TODO" } : { ratio: 1 };
    case "jsonValid": {
      try {
        const parsed = JSON.parse(text);
        const minKeys = Number(c.params?.minKeys ?? 1);
        const ok = parsed && typeof parsed === "object" && Object.keys(parsed).length >= minKeys;
        return ok ? { ratio: 1 } : { ratio: 0.5, issue: "JSON zbyt ubogi" };
      } catch {
        return { ratio: 0, issue: "niepoprawny JSON" };
      }
    }
    case "htmlValid": {
      if (art.format !== "html") return { ratio: 0, issue: "oczekiwano HTML" };
      const opens = (text.match(/<[a-z][a-z0-9]*\b[^>]*>/gi) ?? []).length;
      const closes = (text.match(/<\/[a-z][a-z0-9]*\s*>/gi) ?? []).length;
      // Void elements + any self-closing tag (alternation picks one per position).
      const selfOrVoid = (text.match(/<(?:meta|link|br|hr|img|input|source|area|base|col|embed|param|track|wbr)\b[^>]*>|<[a-z][^>]*\/>/gi) ?? []).length;
      const paired = opens - selfOrVoid;
      const balanced = Math.abs(paired - closes) <= 2;
      const hasDoc = /<html[\s>]/i.test(text) && /<\/html>/i.test(text);
      if (!hasDoc) return { ratio: 0.5, issue: "brak struktury <html>" };
      return balanced ? { ratio: 1 } : { ratio: 0.5, issue: "niezbalansowane tagi HTML" };
    }
    default:
      return { ratio: 1 };
  }
}

export function review(artifact: Artifact, criteria: AcceptanceCriterion[]): ReviewResult {
  if (!criteria.length) return { score: 100, passed: true, issues: [] };
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0) || 1;
  let earned = 0;
  const issues: string[] = [];
  for (const c of criteria) {
    const { ratio, issue } = evalCriterion(c, artifact);
    earned += ratio * c.weight;
    if (issue) issues.push(issue);
  }
  const score = Math.round((earned / totalWeight) * 100);
  return { score, passed: score >= 80, issues };
}
