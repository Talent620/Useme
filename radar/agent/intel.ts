// Market intelligence. Classifies the buying-intent type of a signal and
// provides a curated registry of public, RSS-based demand sources (HN, Reddit
// for-hire, job boards, funding/news). All sources are standard RSS so they flow
// through the existing polite fetcher — no new adapters, no ToS-risky scraping.
// Deterministic classification (keyword sets); LLM can refine later but isn't
// required.

export type IntentType = "hiring" | "rfp" | "seeking" | "complaint" | "launch" | "none";

const SETS: Record<Exclude<IntentType, "none">, string[]> = {
  rfp: ["rfp", "request for proposal", "zapytanie ofertowe", "przetarg", "tender", "wycena", "quote"],
  hiring: ["hiring", "we're hiring", "zatrudnię", "poszukujemy", "recruiting", "wakat", "job opening"],
  seeking: ["szukam", "poszukuję", "potrzebuję", "zlecę", "looking for", "need a", "need help", "anyone know", "recommend a"],
  complaint: ["frustrated", "terrible", "nie działa", "rozczarowany", "switching from", "alternative to", "zrezygnowałem"],
  launch: ["just launched", "launching", "we just shipped", "nowy produkt", "startup", "raised", "funding", "seed round"],
};

/** Classify the buying-intent type of free text (first match by priority). */
export function classifyIntent(text: string): IntentType {
  const t = text.toLowerCase();
  for (const type of ["rfp", "seeking", "hiring", "complaint", "launch"] as const) {
    if (SETS[type].some((k) => t.includes(k))) return type;
  }
  return "none";
}

/** Is this text a demand signal worth surfacing? */
export function isDemandSignal(text: string): boolean {
  return classifyIntent(text) !== "none";
}

export interface IntelSource {
  name: string;
  kind: "job_board" | "social" | "funding" | "rss";
  feed: string;
  note: string;
}

/**
 * Curated public RSS demand sources. Disabled by default — enable per ToS in
 * config (`enabled: true`) or via RADAR_LIVE_SOURCES. Verify each feed's terms.
 */
export const DEMAND_SOURCES: IntelSource[] = [
  { name: "hn-jobs", kind: "job_board", feed: "https://hnrss.org/jobs", note: "Hacker News — oferty pracy/zlecenia (RSS)" },
  { name: "hn-ask", kind: "social", feed: "https://hnrss.org/ask", note: "Hacker News Ask — często 'looking for / need'" },
  { name: "reddit-forhire", kind: "social", feed: "https://www.reddit.com/r/forhire/new/.rss", note: "Reddit r/forhire (RSS)" },
  { name: "reddit-jobbit", kind: "social", feed: "https://www.reddit.com/r/jobbit/new/.rss", note: "Reddit r/jobbit (RSS)" },
  { name: "remoteok", kind: "job_board", feed: "https://remoteok.com/remote-dev-jobs.rss", note: "RemoteOK dev jobs (RSS)" },
  { name: "ted-eu", kind: "rss", feed: "https://ted.europa.eu/en/rss", note: "Przetargi UE (TED)" },
];

/** Tag the intent type onto a batch of texts (for mining). */
export function mine(items: { title: string; body?: string }[]): { title: string; intent: IntentType }[] {
  return items
    .map((i) => ({ title: i.title, intent: classifyIntent(`${i.title} ${i.body ?? ""}`) }))
    .filter((x) => x.intent !== "none");
}
