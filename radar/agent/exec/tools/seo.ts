// Real on-page SEO analyzer. Extracts concrete signals from a page's HTML and
// turns them into prioritized, grounded findings — so the audit deliverable is
// based on the actual site, not a template. Dependency-free (regex extraction).

export interface SeoSignals {
  url?: string;
  title?: string;
  titleLen: number;
  metaDescription?: string;
  metaLen: number;
  h1Count: number;
  h2Count: number;
  imgCount: number;
  imgWithAlt: number;
  wordCount: number;
  internalLinks: number;
  hasViewport: boolean;
  hasCanonical: boolean;
  hasStructuredData: boolean;
  https: boolean;
  lang?: string;
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")) ?? tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, "i"));
  return m?.[1];
}

export function analyzeHtml(html: string, url?: string): SeoSignals {
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? html;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const metaDescTag = head.match(/<meta[^>]+name\s*=\s*["']description["'][^>]*>/i)?.[0];
  const metaDescription = metaDescTag ? attr(metaDescTag, "content") : undefined;

  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const imgWithAlt = imgs.filter((t) => {
    const a = attr(t, "alt");
    return a != null && a.trim() !== "";
  }).length;

  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  const wordCount = (text.match(/\b[\p{L}\p{N}']+\b/gu) ?? []).length;

  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0];

  return {
    url,
    title,
    titleLen: title?.length ?? 0,
    metaDescription,
    metaLen: metaDescription?.length ?? 0,
    h1Count: (html.match(/<h1\b/gi) ?? []).length,
    h2Count: (html.match(/<h2\b/gi) ?? []).length,
    imgCount: imgs.length,
    imgWithAlt,
    wordCount,
    internalLinks: (html.match(/<a\b[^>]*href\s*=\s*["'](?!https?:|mailto:|tel:)[^"']+["']/gi) ?? []).length,
    hasViewport: /<meta[^>]+name\s*=\s*["']viewport["']/i.test(head),
    hasCanonical: /<link[^>]+rel\s*=\s*["']canonical["']/i.test(head),
    hasStructuredData: /application\/ld\+json/i.test(html) || /itemscope/i.test(html),
    https: url ? url.startsWith("https://") : false,
    lang: htmlTag ? attr(htmlTag, "lang") : undefined,
  };
}

export interface SeoFinding {
  area: string;
  priority: "Wysoki" | "Średni" | "Niski";
  observation: string;
  recommendation: string;
}

export function auditFindings(s: SeoSignals): SeoFinding[] {
  const f: SeoFinding[] = [];
  if (!s.title || s.titleLen < 30 || s.titleLen > 60) {
    f.push({ area: "Title", priority: "Wysoki", observation: `Title ma ${s.titleLen} znaków${s.title ? "" : " (brak)"}.`, recommendation: "Ustaw unikalny title 50–60 znaków ze słowem kluczowym na początku." });
  }
  if (!s.metaDescription || s.metaLen < 70 || s.metaLen > 160) {
    f.push({ area: "Meta description", priority: "Wysoki", observation: s.metaDescription ? `Meta description ma ${s.metaLen} znaków.` : "Brak meta description.", recommendation: "Dodaj zachęcający opis 140–160 znaków z CTA." });
  }
  if (s.h1Count !== 1) {
    f.push({ area: "Nagłówek H1", priority: "Średni", observation: `Liczba H1: ${s.h1Count}.`, recommendation: "Strona powinna mieć dokładnie jeden H1 opisujący temat." });
  }
  if (s.imgCount > 0 && s.imgWithAlt < s.imgCount) {
    f.push({ area: "Atrybuty ALT", priority: "Średni", observation: `${s.imgWithAlt}/${s.imgCount} obrazów ma alt.`, recommendation: "Uzupełnij opisowe alt dla wszystkich obrazów (SEO + dostępność)." });
  }
  if (s.wordCount < 300) {
    f.push({ area: "Treść", priority: "Wysoki", observation: `Tylko ${s.wordCount} słów treści.`, recommendation: "Rozbuduj treść do min. 600 słów nasyconych intencją użytkownika." });
  }
  if (!s.hasViewport) {
    f.push({ area: "Mobile", priority: "Wysoki", observation: "Brak meta viewport.", recommendation: "Dodaj <meta name=viewport> dla poprawnego renderowania mobilnego." });
  }
  if (!s.hasCanonical) {
    f.push({ area: "Canonical", priority: "Niski", observation: "Brak linku canonical.", recommendation: "Dodaj rel=canonical, by uniknąć duplikacji treści." });
  }
  if (!s.hasStructuredData) {
    f.push({ area: "Dane strukturalne", priority: "Średni", observation: "Brak schema.org / JSON-LD.", recommendation: "Dodaj dane strukturalne (Product/Organization) dla rich results." });
  }
  if (s.url && !s.https) {
    f.push({ area: "Bezpieczeństwo", priority: "Wysoki", observation: "Strona nie używa HTTPS.", recommendation: "Wymuś HTTPS (przekierowanie 301 + HSTS)." });
  }
  return f;
}

export function renderAuditReport(title: string, signals: SeoSignals, findings: SeoFinding[]): string {
  const order = { Wysoki: 0, Średni: 1, Niski: 2 };
  const sorted = [...findings].sort((a, b) => order[a.priority] - order[b.priority]);
  const metrics = [
    `- URL: ${signals.url ?? "—"}`,
    `- Title: ${signals.titleLen} znaków`,
    `- Meta description: ${signals.metaLen} znaków`,
    `- H1/H2: ${signals.h1Count}/${signals.h2Count}`,
    `- Obrazy z ALT: ${signals.imgWithAlt}/${signals.imgCount}`,
    `- Słowa treści: ${signals.wordCount}`,
    `- Viewport: ${signals.hasViewport ? "tak" : "nie"} · Canonical: ${signals.hasCanonical ? "tak" : "nie"} · Schema: ${signals.hasStructuredData ? "tak" : "nie"}`,
  ].join("\n");
  const body = sorted.length
    ? sorted.map((x, i) => `### ${i + 1}. ${x.area} — priorytet: ${x.priority}\n- Obserwacja: ${x.observation}\n- Rekomendacja: ${x.recommendation}`).join("\n\n")
    : "Brak krytycznych problemów — strona spełnia podstawowe wytyczne on-page.";
  return `# Audyt SEO: ${title}\n\n## Zmierzone sygnały on-page\n${metrics}\n\n## Wykryte problemy i rekomendacje (wg priorytetu)\n${body}\n\n## Następne kroki\n1. Wdrożyć rekomendacje wysokiego priorytetu.\n2. Zmierzyć efekt (ruch, pozycje) po 30 dniach.\n3. Iterować na podstawie danych z Search Console.\n\n— Audyt wygenerowany automatycznie przez RadarPL na podstawie realnej analizy strony.`;
}
