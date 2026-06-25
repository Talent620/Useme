// Multi-agent boardroom. Eight specialized agents read the shared state (Store +
// Memory) and each return a summary + concrete recommendations; the CEO agent
// synthesizes cross-agent priorities. Deterministic orchestration over the
// existing engines — this is the coordination layer that turns the modules into
// a "team". No LLM required (an LLM can later narrate, not decide).

import type { AgentConfig } from "./config.ts";
import type { Store } from "./store.ts";
import type { Memory } from "./memory.ts";
import { computeFunnel, recommend } from "./strategy.ts";
import { forecast } from "./forecast.ts";
import { financials } from "./finance.ts";
import { dueFollowUps, pipeline, type CrmLead } from "./crm.ts";

export interface AgentView {
  name: string;
  summary: string;
  recommendations: string[];
}
export interface Boardroom {
  agents: AgentView[];
  priorities: string[];
}

function allLeads(store: Store, cfg: AgentConfig) {
  return cfg.tenants.flatMap((t) => store.leadsForTenant(t.id, 0));
}

export function boardroom(store: Store, cfg: AgentConfig, nowMs: number, memory?: Memory): Boardroom {
  const stats = store.stats();
  const leads = allLeads(store, cfg);
  const crmLeads: CrmLead[] = leads.map((l) => ({ id: l.id, status: l.status, outreachStatus: l.outreachStatus, sentAt: l.sentAt, followUps: 0, title: l.signalTitle }));
  const funnel = computeFunnel(store.leadFacts());
  const fc = forecast(store.leadTimeline().map((e) => ({ key: e.category, date: e.date })));
  const fin = financials(store.leadFacts(), cfg.tenants.map((t) => ({ id: t.id, plan: t.plan })));
  const outbox = store.outbox();
  const dels = store.deliverables();
  const toReview = dels.filter((d) => d.gate === "review");
  const executable = store.executableLeads();
  const followUps = dueFollowUps(crmLeads, nowMs);
  const stratRecs = recommend(funnel, { tenants: cfg.tenants.map((t) => ({ id: t.id, plan: t.plan })) });
  const rising = fc.filter((f) => f.trend === "rising").map((f) => f.key);

  const agents: AgentView[] = [];
  const rec: string[] = [];

  agents.push({ name: "Research", summary: `Źródła: ${Object.keys(stats.sources).length}, sygnały: ${stats.signalsSeen}, leady: ${stats.leads}.`,
    recommendations: rising.length ? [`Rosnący popyt: ${rising.join(", ")} — pozyskaj więcej sygnałów`] : ["Włącz dodatkowe źródła popytu (intel.DEMAND_SOURCES)"] });

  const topLeads = [...leads].sort((a, b) => b.score - a.score).slice(0, 3).map((l) => `${l.signalTitle} (${l.score})`);
  agents.push({ name: "Sales", summary: `Pipeline: ${JSON.stringify(pipeline(crmLeads))}.`,
    recommendations: [topLeads.length ? `Priorytet: ${topLeads.join("; ")}` : "Brak leadów — uruchom cykl", followUps.length ? `${followUps.length} follow-upów do wysłania` : "Brak zaległych follow-upów"] });

  agents.push({ name: "Outreach", summary: `Skrzynka: ${outbox.length} ofert do akceptacji.`,
    recommendations: outbox.length ? [`Zatwierdź i wyślij ${outbox.length} ofert`] : ["Brak ofert w kolejce"] });

  agents.push({ name: "Execution", summary: `Do wykonania (WON): ${executable.length}, gotowe: ${dels.length}.`,
    recommendations: executable.length ? [`Wykonaj ${executable.length} wygranych zleceń`] : ["Brak zleceń do wykonania"] });

  agents.push({ name: "QA", summary: `Deliverable do przeglądu: ${toReview.length}.`,
    recommendations: toReview.length ? [`Przejrzyj ${toReview.length} deliverabli (gate=review)`] : ["Jakość OK — wszystko auto"] });

  agents.push({ name: "Finance", summary: `Przychód ${fin.executionRevenue} zł, marża ${fin.grossMargin} zł (${fin.marginPct}%), MRR ${fin.mrr} zł, LTV/CAC ${fin.ltvCacRatio}.`,
    recommendations: fin.marginPct < 50 && fin.executionRevenue > 0 ? ["Niska marża — rozważ wyższe ceny / tańszą egzekucję"] : ["Ekonomia zdrowa"] });

  agents.push({ name: "Strategy", summary: `Rekomendacji: ${stratRecs.length}. Prognoza: ${fc.slice(0, 3).map((f) => f.key + (f.trend === "rising" ? "▲" : f.trend === "declining" ? "▼" : "→")).join(" ")}.`,
    recommendations: stratRecs.slice(0, 2).map((r) => `${r.action} → ${r.target} (+${r.expectedImpactPln} zł)`) });

  if (memory) {
    const ms = memory.stats();
    agents.push({ name: "Memory", summary: `Historia: ${ms.deals} transakcji, win-rate ${Math.round(ms.winRate * 100)}%, klienci ${ms.clients}.`, recommendations: [] });
  }

  // CEO synthesizes the highest-impact priorities across agents.
  if (outbox.length) rec.push(`Zatwierdź ${outbox.length} ofert (przychód w toku)`);
  if (executable.length) rec.push(`Wykonaj ${executable.length} wygranych zleceń`);
  if (toReview.length) rec.push(`Przejrzyj ${toReview.length} deliverabli`);
  if (followUps.length) rec.push(`Wyślij ${followUps.length} follow-upów`);
  for (const r of stratRecs.slice(0, 2)) rec.push(`${r.action} → ${r.target}`);
  if (!rec.length) rec.push("Uruchom cykl (auto) — brak pilnych akcji.");

  agents.unshift({ name: "CEO", summary: `Synteza zespołu: ${rec.length} priorytetów.`, recommendations: rec.slice(0, 5) });
  return { agents, priorities: rec.slice(0, 5) };
}
