// Operator dashboard. Synthesizes the whole business state into one markdown
// report: pipeline, P&L, demand forecast, execution quality, deliverables, and
// a prioritized "what to do next" checklist. This is the top-level "kontrola co
// trzeba zrobić" — the control panel the autonomous system surfaces every cycle.

import type { AgentConfig } from "./config.ts";
import { computeFunnel, recommend } from "./strategy.ts";
import { forecast, prealloc } from "./forecast.ts";
import type { Store } from "./store.ts";

export function buildReport(store: Store, cfg: AgentConfig, nowISO: string): string {
  const s = store.stats();
  const funnel = computeFunnel(store.leadFacts());
  const stratRecs = recommend(funnel, { tenants: cfg.tenants.map((t) => ({ id: t.id, plan: t.plan })) });
  const fc = forecast(store.leadTimeline().map((e) => ({ key: e.category, date: e.date })));
  const preRecs = prealloc(fc);
  const quality = store.getQualityModel();
  const dels = store.deliverables();
  const outbox = store.outbox();
  const toReview = dels.filter((d) => d.gate === "review");

  const L: string[] = [];
  L.push(`# RadarPL — panel operatora`);
  L.push(`_${nowISO.slice(0, 16).replace("T", " ")}_`);
  L.push("");

  L.push(`## Pipeline`);
  L.push(`- Sygnały: ${s.signalsSeen} · Leady: ${s.leads} · Wysyłki: ${s.sends} · Dostawy: ${s.deliveries}`);
  L.push(`- Status: ${fmtMap(s.byStatus)}`);
  L.push(`- Outreach: ${fmtMap(s.byOutreach)}`);
  L.push("");

  L.push(`## Wynik (P&L)`);
  const t = funnel.totals;
  L.push(`- Przychód: **${t.revenue} zł** · Koszt: ${t.cost} zł · Marża: **${t.margin} zł**`);
  if (funnel.byCategory.length) {
    L.push(`- Top kategorie:`);
    for (const c of funnel.byCategory.slice(0, 5)) L.push(`  - ${c.key}: marża ${c.margin} zł, ROI ${c.roi}x, akceptacja ${pct(c.acceptanceRate)}`);
  }
  L.push("");

  L.push(`## Prognoza popytu`);
  if (!fc.length) L.push(`- (za mało danych)`);
  for (const f of fc.slice(0, 5)) L.push(`- ${f.key}: ${trendIcon(f.trend)} momentum ${f.momentum}x, prognoza ${f.predictedNext}/dzień`);
  L.push("");

  L.push(`## Wycena i ranking (RL-lite)`);
  const ranked = (["source", "channel", "category"] as const)
    .map((ns) => ({ ns, arms: store.rankedArms(ns).filter((a) => a.n > 0) }))
    .filter((x) => x.arms.length);
  if (ranked.length) {
    for (const { ns, arms } of ranked) {
      const top = arms.slice(0, 3).map((a) => `${a.arm} ${a.value.toFixed(2)} (${a.n})`).join(", ");
      L.push(`- ${ns}: ${top}`);
    }
  } else L.push(`- (brak wyników — oznacz leady WON/REJECTED, by uczyć bandita)`);
  L.push("");

  L.push(`## Jakość wykonania`);
  if (quality && Object.keys(quality.byCapability).length) {
    for (const q of Object.values(quality.byCapability)) L.push(`- ${q.capability}: akceptacja ${pct(q.acceptanceRate)} (${q.accepted}/${q.n}) — ${q.autoAllowed ? "auto OK" : "**wymaga przeglądu**"}`);
  } else L.push(`- (brak ocen — użyj mark-exec)`);
  L.push("");

  L.push(`## Deliverable (${dels.length})`);
  for (const d of dels.slice(0, 10)) L.push(`- [${d.gate}] ${d.title} — ${d.capability ?? "?"} ${d.confidence ?? "?"}/100${d.outcome ? " · " + d.outcome : ""}`);
  L.push("");

  L.push(`## ✅ Co trzeba zrobić (priorytet)`);
  const todo: string[] = [];
  if (outbox.length) todo.push(`Zaakceptuj/odrzuć ${outbox.length} ofert w skrzynce (\`approve\`/\`reject\`)`);
  if (toReview.length) todo.push(`Przejrzyj ${toReview.length} deliverabli oznaczonych do review`);
  for (const r of stratRecs.slice(0, 3)) todo.push(`${r.autoApplicable ? "[auto] " : ""}${r.action} → ${r.target} (+${r.expectedImpactPln} zł): ${r.rationale}`);
  for (const r of preRecs.slice(0, 2)) todo.push(`${r.action} → ${r.target}: ${r.rationale}`);
  if (!todo.length) todo.push(`Brak pilnych akcji — system pracuje autonomicznie.`);
  todo.forEach((x, i) => L.push(`${i + 1}. ${x}`));
  L.push("");

  L.push(`## Zdrowie źródeł`);
  for (const [name, st] of Object.entries(s.sources)) L.push(`- ${st.healthy ? "🟢" : "🔴"} ${name} ${st.lastError ? "— " + st.lastError : ""}`);

  return L.join("\n");
}

function fmtMap(m: Record<string, number>): string {
  const e = Object.entries(m).filter(([k]) => k !== "none");
  return e.length ? e.map(([k, v]) => `${k}:${v}`).join(", ") : "—";
}
function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
function trendIcon(t: string): string {
  return t === "rising" ? "▲" : t === "declining" ? "▼" : "→";
}
