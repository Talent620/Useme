// RadarPL tools exposed over MCP. Each tool is a thin wrapper over the same
// Store/actions/cycle the CLI uses, so the agent-facing surface stays in sync.
// callTool() builds a fresh Store per call to reflect external (CLI) changes.

import { loadConfig } from "../config.ts";
import { recordToMemory, runAttest, runBoard, runCrm, runExecute, runExecuteLead, runFinance, runForecast, runNegotiate, runPrice, runPriceTrain, runQualityTrain, runRank, runReport, runSend, runStrategy, runTrain, runVerifyAttestation } from "../actions.ts";
import { runCycle } from "../cycle.ts";
import { storePath } from "../daemon.ts";
import { buildTenant, previewForProfile, registerTenant } from "../onboarding.ts";
import { Store } from "../store.ts";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
}

const obj = (properties: Record<string, unknown> = {}, required: string[] = []) =>
  ({ type: "object" as const, properties, required });

export const TOOLS: ToolDef[] = [
  { name: "radar_status", description: "Statystyki agenta: sygnały, leady, wysyłki, modele, zdrowie źródeł.", inputSchema: obj() },
  {
    name: "radar_list_leads",
    description: "Lista leadów wg intencji (score malejąco). Filtruj po tenantId i min score.",
    inputSchema: obj({ tenantId: { type: "string" }, min: { type: "number", description: "min score 0-100" } }),
  },
  { name: "radar_get_draft", description: "Pełny draft wiadomości (temat+treść) dla leada.", inputSchema: obj({ leadId: { type: "string" } }, ["leadId"]) },
  { name: "radar_outbox", description: "Leady czekające na akceptację/wysyłkę (bramka outreachu).", inputSchema: obj() },
  { name: "radar_approve", description: "Zatwierdź lead do wysłania. leadId='all' zatwierdza wszystkie czekające.", inputSchema: obj({ leadId: { type: "string" } }, ["leadId"]) },
  { name: "radar_reject", description: "Pomiń lead w outreachu.", inputSchema: obj({ leadId: { type: "string" } }, ["leadId"]) },
  { name: "radar_send", description: "Wyślij zaakceptowane leady (respektuje dzienny limit). Zwraca co wysłano.", inputSchema: obj() },
  {
    name: "radar_mark",
    description: "Ustaw wynik leada (zasila self-improving scoring).",
    inputSchema: obj({ leadId: { type: "string" }, status: { type: "string", enum: ["WON", "REPLIED", "REJECTED", "SENT"] } }, ["leadId", "status"]),
  },
  { name: "radar_train", description: "Przelicz modele scoringu z wyników WON/LOST.", inputSchema: obj() },
  { name: "radar_execute", description: "Autonomicznie zrealizuj wygrane (WON) zlecenia: plan→produkcja→samo-weryfikacja→deliverable. Zwraca pewność i bramkę auto/review.", inputSchema: obj() },
  { name: "radar_work", description: "Wykonaj konkretne zlecenie teraz (na żądanie) — pełny deliverable + ścieżki plików.", inputSchema: obj({ leadId: { type: "string" } }, ["leadId"]) },
  {
    name: "radar_mark_exec",
    description: "Oceń dostarczony deliverable (werdykt klienta). Zasila samokalibrację jakości.",
    inputSchema: obj({ leadId: { type: "string" }, outcome: { type: "string", enum: ["ACCEPTED", "REVISION", "REJECTED"] } }, ["leadId", "outcome"]),
  },
  { name: "radar_quality", description: "Model jakości wykonania per kompetencja (akceptacja, samokalibrowany próg/iteracje).", inputSchema: obj() },
  { name: "radar_strategy", description: "Agent-CEO: P&L lejka (marża/ROI per kategoria/źródło/tenant) + rekomendacje realokacji. apply=true auto-wyłącza martwe źródła.", inputSchema: obj({ apply: { type: "boolean" } }) },
  { name: "radar_forecast", description: "Prognoza popytu per kategoria (trend/momentum/predykcja next) + prealokacja wyprzedzająca.", inputSchema: obj() },
  { name: "radar_rank", description: "RL-lite ranking: czego agent nauczył się z realnych wyników (wartość per źródło/kanał/kategoria, EWMA bandit).", inputSchema: obj() },
  { name: "radar_price", description: "Dynamiczna wycena leada: rekomendowana cena + P(wygranej) + wartość oczekiwana (intent×historia×konkurencja, deterministycznie).", inputSchema: obj({ leadId: { type: "string" } }, ["leadId"]) },
  { name: "radar_price_train", description: "Skalibruj wagi modelu cenowego z realnej historii win/loss (regresja logistyczna, deterministyczna). System uczy się własnej elastyczności cenowej.", inputSchema: obj() },
  { name: "radar_negotiate", description: "Doradca negocjacji: dla kontroferty klienta zwraca accept/counter/decline maksymalizując EV powyżej progu marży. Zwiększa rundę negocjacji leada i loguje do pamięci.", inputSchema: obj({ leadId: { type: "string" }, clientOffer: { type: "number", description: "kwota oferty klienta w zł" } }, ["leadId", "clientOffer"]) },
  { name: "radar_attest", description: "Proof-of-Outcome: replayowalny dowód wykonania deliverable (hash artifact+spec+result, werdykt pass/fail). Każdy z plikiem i specyfikacją może niezależnie zweryfikować — bez zaufania do wykonawcy.", inputSchema: obj({ leadId: { type: "string" } }, ["leadId"]) },
  { name: "radar_verify", description: "Niezależnie zweryfikuj atestację leada przez re-egzekucję specyfikacji na bieżącym pliku deliverable. Wykrywa manipulację pracą lub dowodem.", inputSchema: obj({ leadId: { type: "string" } }, ["leadId"]) },
  { name: "radar_report", description: "Panel operatora: pełny stan biznesu (pipeline, P&L, prognoza, jakość, deliverable) + lista 'co trzeba zrobić'.", inputSchema: obj() },
  { name: "radar_board", description: "Zespół agentów (CEO/Sales/Research/Outreach/Execution/QA/Finance/Strategy) nad wspólną pamięcią — widoki + priorytety CEO.", inputSchema: obj() },
  { name: "radar_finance", description: "Agent finansowy: P&L, MRR, marża, CAC, LTV, ROI.", inputSchema: obj() },
  { name: "radar_crm", description: "CRM: pipeline wg etapu + follow-upy do wysłania.", inputSchema: obj() },
  { name: "radar_run_cycle", description: "Uruchom jeden pełny cykl: crawl→enrich→score→draft→dostawa.", inputSchema: obj() },
  {
    name: "radar_onboard",
    description: "Samoobsługowy onboarding: z opisu freelancera buduje ICP + profil i pokazuje proof-of-value (leady teraz). register=true zapisuje go do stałego monitoringu.",
    inputSchema: obj(
      {
        name: { type: "string" },
        email: { type: "string" },
        headline: { type: "string", description: "Opis: co robi, umiejętności, usługi" },
        minBudget: { type: "number" },
        maxBudget: { type: "number" },
        register: { type: "boolean" },
      },
      ["email", "headline"],
    ),
  },
];

export interface ToolResult {
  text: string;
  isError?: boolean;
}

function arg<T>(args: unknown, key: string): T | undefined {
  return (args as Record<string, T> | undefined)?.[key];
}

export async function callTool(name: string, args: unknown): Promise<ToolResult> {
  const store = new Store(storePath());
  const cfg = loadConfig();

  switch (name) {
    case "radar_status":
      return { text: JSON.stringify(store.stats(), null, 2) };

    case "radar_list_leads": {
      const tenantId = arg<string>(args, "tenantId");
      const min = arg<number>(args, "min") ?? 0;
      const tenants = tenantId ? cfg.tenants.filter((t) => t.id === tenantId) : cfg.tenants;
      const out = tenants.map((t) => ({
        tenant: t.id,
        leads: store.leadsForTenant(t.id, min).slice(0, 25).map((l) => ({
          id: l.id, score: l.score, title: l.signalTitle, url: l.signalUrl,
          budget: l.signalBudget, recommendedPrice: l.recommendedPrice, winProbability: l.winProbability,
          status: l.status, outreach: l.outreachStatus ?? "none",
        })),
      }));
      return { text: JSON.stringify(out, null, 2) };
    }

    case "radar_get_draft": {
      const lead = store.findLead(arg<string>(args, "leadId") ?? "");
      if (!lead) return { text: `Brak leada ${arg<string>(args, "leadId")}`, isError: true };
      return { text: JSON.stringify({ id: lead.id, subject: lead.draftSubject, body: lead.draftBody, url: lead.signalUrl, score: lead.score }, null, 2) };
    }

    case "radar_outbox":
      return { text: JSON.stringify(store.outbox().map((l) => ({ id: l.id, score: l.score, title: l.signalTitle, status: l.outreachStatus })), null, 2) };

    case "radar_approve": {
      const leadId = arg<string>(args, "leadId") ?? "";
      if (leadId === "all") {
        let n = 0;
        for (const l of store.outbox("queued")) { store.setOutreach(l.id, "approved"); n++; }
        return { text: `Zaakceptowano ${n} leadów.` };
      }
      const ok = store.setOutreach(leadId, "approved");
      return { text: ok ? `Zaakceptowano ${leadId}.` : `Brak leada ${leadId}.`, isError: !ok };
    }

    case "radar_reject": {
      const leadId = arg<string>(args, "leadId") ?? "";
      const ok = store.setOutreach(leadId, "skipped");
      return { text: ok ? `Pominięto ${leadId}.` : `Brak leada ${leadId}.`, isError: !ok };
    }

    case "radar_send": {
      const s = await runSend(store, cfg);
      return { text: JSON.stringify(s, null, 2) };
    }

    case "radar_mark": {
      const leadId = arg<string>(args, "leadId") ?? "";
      const status = arg<string>(args, "status") ?? "";
      const ok = store.setLeadStatus(leadId, status as never);
      // Keep parity with the CLI: closed deals feed memory + the RL-lite bandit.
      if (ok && status === "WON") recordToMemory(store, leadId, "win");
      if (ok && status === "REJECTED") recordToMemory(store, leadId, "loss");
      return { text: ok ? `${leadId} -> ${status}` : `Brak leada ${leadId}.`, isError: !ok };
    }

    case "radar_train":
      return { text: JSON.stringify(runTrain(store, cfg), null, 2) };

    case "radar_execute":
      return { text: JSON.stringify(await runExecute(store, cfg), null, 2) };

    case "radar_work": {
      const item = await runExecuteLead(store, cfg, arg<string>(args, "leadId") ?? "");
      return item ? { text: JSON.stringify(item, null, 2) } : { text: "brak leada", isError: true };
    }

    case "radar_mark_exec": {
      const ok = store.recordExecutionOutcome(arg<string>(args, "leadId") ?? "", (arg<string>(args, "outcome") ?? "") as never);
      return { text: ok ? "ok" : "brak leada", isError: !ok };
    }

    case "radar_quality":
      return { text: JSON.stringify(runQualityTrain(store), null, 2) };

    case "radar_strategy":
      return { text: JSON.stringify(runStrategy(store, cfg, arg<boolean>(args, "apply")), null, 2) };

    case "radar_forecast":
      return { text: JSON.stringify(runForecast(store), null, 2) };

    case "radar_rank":
      return { text: JSON.stringify(runRank(store), null, 2) };

    case "radar_price": {
      const r = runPrice(store, arg<string>(args, "leadId") ?? "");
      return r ? { text: JSON.stringify(r, null, 2) } : { text: "brak leada", isError: true };
    }

    case "radar_price_train":
      return { text: JSON.stringify(runPriceTrain(store), null, 2) };

    case "radar_negotiate": {
      const r = runNegotiate(store, arg<string>(args, "leadId") ?? "", arg<number>(args, "clientOffer") ?? 0);
      return r ? { text: JSON.stringify(r, null, 2) } : { text: "brak leada", isError: true };
    }

    case "radar_attest": {
      const r = await runAttest(store, arg<string>(args, "leadId") ?? "");
      return "error" in r ? { text: r.error, isError: true } : { text: JSON.stringify(r, null, 2) };
    }

    case "radar_verify": {
      const r = await runVerifyAttestation(store, arg<string>(args, "leadId") ?? "");
      return "error" in r ? { text: r.error, isError: true } : { text: JSON.stringify(r, null, 2) };
    }

    case "radar_report":
      return { text: runReport(store, cfg, new Date().toISOString()).markdown };

    case "radar_board":
      return { text: JSON.stringify(runBoard(store, cfg), null, 2) };
    case "radar_finance":
      return { text: JSON.stringify(runFinance(store, cfg), null, 2) };
    case "radar_crm":
      return { text: JSON.stringify(runCrm(store, cfg), null, 2) };

    case "radar_run_cycle": {
      const m = await runCycle(store, cfg, Date.now());
      return { text: JSON.stringify({ newSignals: m.newSignals, leads: m.leadsCreated, queuedForOutreach: m.queuedForOutreach, digests: m.digests.length, ms: m.durationMs }, null, 2) };
    }

    case "radar_onboard": {
      const email = arg<string>(args, "email");
      const headline = arg<string>(args, "headline");
      if (!email || !headline) return { text: "email i headline są wymagane", isError: true };
      const profile = {
        name: arg<string>(args, "name") ?? email,
        email,
        headline,
        minBudget: arg<number>(args, "minBudget"),
        maxBudget: arg<number>(args, "maxBudget"),
      };
      const { tenant, leads } = await previewForProfile(profile, cfg);
      let registered = false;
      if (arg<boolean>(args, "register")) registered = registerTenant(buildTenant(profile)).added;
      return {
        text: JSON.stringify({
          tenant: { id: tenant.id, role: tenant.sender.role, plan: tenant.plan, categories: tenant.icp.categories, keywords: tenant.icp.keywords },
          proofOfValue: leads.map((l) => ({ score: l.score, title: l.title, draftSubject: l.draftSubject })),
          registered,
        }, null, 2),
      };
    }

    default:
      return { text: `Nieznane narzędzie: ${name}`, isError: true };
  }
}
