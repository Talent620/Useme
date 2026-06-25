// RadarPL tools exposed over MCP. Each tool is a thin wrapper over the same
// Store/actions/cycle the CLI uses, so the agent-facing surface stays in sync.
// callTool() builds a fresh Store per call to reflect external (CLI) changes.

import { loadConfig } from "../config.ts";
import { runSend, runTrain } from "../actions.ts";
import { runCycle } from "../cycle.ts";
import { storePath } from "../daemon.ts";
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
  { name: "radar_run_cycle", description: "Uruchom jeden pełny cykl: crawl→enrich→score→draft→dostawa.", inputSchema: obj() },
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
          budget: l.signalBudget, status: l.status, outreach: l.outreachStatus ?? "none",
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
      return { text: ok ? `${leadId} -> ${status}` : `Brak leada ${leadId}.`, isError: !ok };
    }

    case "radar_train":
      return { text: JSON.stringify(runTrain(store, cfg), null, 2) };

    case "radar_run_cycle": {
      const m = await runCycle(store, cfg, Date.now());
      return { text: JSON.stringify({ newSignals: m.newSignals, leads: m.leadsCreated, queuedForOutreach: m.queuedForOutreach, digests: m.digests.length, ms: m.durationMs }, null, 2) };
    }

    default:
      return { text: `Nieznane narzędzie: ${name}`, isError: true };
  }
}
