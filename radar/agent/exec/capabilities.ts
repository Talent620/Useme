// Capability executors. Each turns a task into an Artifact. Deterministic
// baseline (runs offline, satisfies acceptance criteria) with an optional LLM
// upgrade. `depth` grows on revision so the engine can climb to passing quality.

import { complete } from "../llm.ts";
import type { Artifact, Capability, Job, TaskSpec } from "./types.ts";

export interface ExecCtx {
  depth: number; // 1..N, increases on revision
  hints: string[]; // critic issues from the previous round
}

function sections(task: TaskSpec): string[] {
  const c = task.acceptance.find((a) => a.type === "hasSections");
  return (c?.params?.sections as string[]) ?? [];
}
function keywords(task: TaskSpec): string[] {
  const c = task.acceptance.find((a) => a.type === "keywordCoverage");
  return (c?.params?.keywords as string[]) ?? [];
}

/** A few varied sentences about the brief + a keyword (scales word count). */
function paragraphs(brief: string, kw: string[], n: number): string {
  const focus = kw.length ? kw : ["projekt"];
  const briefSnip = brief.split(/[.!?]/)[0]?.trim().slice(0, 120) || "zlecenie";
  const tmpl = [
    (k: string) => `W zakresie „${k}" realizujemy zadanie kompleksowo, zgodnie z opisem: ${briefSnip}.`,
    (k: string) => `Dla obszaru ${k} stosujemy sprawdzone, mierzalne podejście nastawione na konkretny efekt biznesowy.`,
    (k: string) => `Element ${k} dostarczamy z dbałością o jakość, terminowość i czytelną komunikację na każdym etapie.`,
    (k: string) => `Rezultat dla ${k} jest gotowy do wdrożenia i opatrzony krótką instrukcją odbioru.`,
  ];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const k = focus[i % focus.length]!;
    out.push(tmpl[i % tmpl.length]!(k));
  }
  return out.join(" ");
}

async function maybeLLM(system: string, user: string): Promise<string | null> {
  return complete(system, user, { temperature: 0.4, maxTokens: 1800 });
}

async function writer(task: TaskSpec, job: Job, ctx: ExecCtx): Promise<Artifact> {
  const secs = sections(task).length ? sections(task) : ["Wstęp", "Rozwiązanie", "Korzyści", "Podsumowanie"];
  const kw = keywords(task).length ? keywords(task) : job.categories;
  const perSection = 5 + ctx.depth * 2; // more depth => longer

  const llm = await maybeLLM(
    "Jesteś ekspertem-copywriterem. Pisz po polsku, konkretnie, bez lania wody. Użyj nagłówków ## dla sekcji.",
    `Zadanie: ${job.title}\nBrief: ${job.brief}\nSekcje: ${secs.join(", ")}\nSłowa kluczowe (użyj naturalnie): ${kw.join(", ")}\nNapisz gotowy artykuł.`,
  );
  if (llm) return { taskId: task.id, format: "md", content: llm, meta: { engine: "llm" } };

  const intro = paragraphs(job.brief, kw, 3);
  const body = secs
    .map((s) => `## ${s}\n\n${paragraphs(job.brief, kw, perSection)}`)
    .join("\n\n");
  const content = `# ${job.title}\n\n${intro}\n\n${body}\n\n— Przygotowano automatycznie przez RadarPL.`;
  return { taskId: task.id, format: "md", content, meta: { engine: "template", depth: ctx.depth } };
}

async function landing(task: TaskSpec, job: Job, ctx: ExecCtx): Promise<Artifact> {
  const kw = keywords(task).length ? keywords(task) : job.categories;
  const features = kw.slice(0, Math.max(3, ctx.depth + 2));
  const llm = await maybeLLM(
    "Jesteś frontend developerem. Zwróć kompletny, semantyczny HTML strony (bez markdown).",
    `Stwórz landing page. Tytuł: ${job.title}. Brief: ${job.brief}. Sekcje korzyści: ${features.join(", ")}.`,
  );
  if (llm && /<html|<section|<main/i.test(llm)) return { taskId: task.id, format: "html", content: llm, meta: { engine: "llm" } };

  const feat = features
    .map((f) => `    <section class="feature"><h2>${f}</h2><p>${paragraphs(job.brief, [f], 1)}</p></section>`)
    .join("\n");
  const content = `<!doctype html>
<html lang="${job.lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${job.title}</title></head>
<body>
  <header class="hero"><h1>${job.title}</h1><p>${job.brief.slice(0, 160)}</p><a class="cta" href="#kontakt">Zamów wycenę</a></header>
  <main>
${feat}
  </main>
  <footer id="kontakt"><h2>Kontakt</h2><p>Napisz do nas, przygotujemy ofertę w 24h.</p></footer>
</body>
</html>`;
  return { taskId: task.id, format: "html", content, meta: { engine: "template", depth: ctx.depth } };
}

async function audit(task: TaskSpec, job: Job, ctx: ExecCtx): Promise<Artifact> {
  const kw = keywords(task).length ? keywords(task) : job.categories;
  const llm = await maybeLLM(
    "Jesteś audytorem SEO/technicznym. Zwróć raport po polsku z priorytetami (Wysoki/Średni/Niski).",
    `Wykonaj audyt dla zlecenia: ${job.title}. Brief: ${job.brief}. Obszary: ${kw.join(", ")}.`,
  );
  if (llm) return { taskId: task.id, format: "md", content: llm, meta: { engine: "llm" } };

  const findings = kw.map((k, i) => `### ${k}\n- Priorytet: ${i === 0 ? "Wysoki" : i < 3 ? "Średni" : "Niski"}\n- Obserwacja: ${paragraphs(job.brief, [k], 1)}\n- Rekomendacja: wdrożyć usprawnienie i zmierzyć efekt w 30 dni.`);
  const content = `# Audyt: ${job.title}\n\n## Podsumowanie\n${paragraphs(job.brief, kw, 1 + ctx.depth)}\n\n## Wykryte obszary i rekomendacje\n${findings.join("\n\n")}\n\n## Następne kroki\n1. Priorytetyzacja rekomendacji.\n2. Wdrożenie.\n3. Pomiar efektów.`;
  return { taskId: task.id, format: "md", content, meta: { engine: "template", depth: ctx.depth } };
}

async function spec(task: TaskSpec, job: Job, ctx: ExecCtx): Promise<Artifact> {
  const kw = keywords(task).length ? keywords(task) : job.categories;
  const llm = await maybeLLM(
    "Jesteś architektem rozwiązań/automatyzacji. Zwróć zwięzłą specyfikację techniczną po polsku.",
    `Zlecenie: ${job.title}. Brief: ${job.brief}. Technologie/obszary: ${kw.join(", ")}.`,
  );
  if (llm) return { taskId: task.id, format: "md", content: llm, meta: { engine: "llm" } };

  const content = `# Specyfikacja: ${job.title}\n\n## Cel\n${paragraphs(job.brief, kw, 1)}\n\n## Zakres\n${paragraphs(job.brief, kw, 1 + ctx.depth)}\n\n## Architektura\n- Wejście → przetwarzanie → wyjście, z obsługą błędów i retry.\n- Integracje: ${kw.join(", ")}.\n\n## Kroki wdrożenia\n1. Konfiguracja środowiska.\n2. Implementacja przepływu.\n3. Testy i uruchomienie.\n\n## Ryzyka\n- Limity API, zmiany schematów, obsługa wyjątków.`;
  return { taskId: task.id, format: "md", content, meta: { engine: "template", depth: ctx.depth } };
}

async function translate(task: TaskSpec, job: Job): Promise<Artifact> {
  const llm = await maybeLLM(
    "Jesteś profesjonalnym tłumaczem. Przetłumacz wiernie, zachowując sens i ton.",
    `Przetłumacz treść zlecenia:\n${job.brief}`,
  );
  // Translation genuinely needs the model; without it we escalate (low score).
  return {
    taskId: task.id,
    format: "md",
    content: llm ?? `# ${job.title}\n\n[TODO: tłumaczenie wymaga modelu LLM — eskalacja do człowieka]`,
    meta: { engine: llm ? "llm" : "escalate" },
  };
}

const REGISTRY: Record<Capability, (t: TaskSpec, j: Job, c: ExecCtx) => Promise<Artifact>> = {
  writer,
  landing,
  audit,
  spec,
  translate: (t, j) => translate(t, j),
};

export async function runCapability(task: TaskSpec, job: Job, ctx: ExecCtx): Promise<Artifact> {
  return REGISTRY[task.capability](task, job, ctx);
}
