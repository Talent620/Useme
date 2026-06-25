// Shared actions used by BOTH the CLI and the MCP server, so the two control
// surfaces never diverge. Each function takes a Store + config, mutates state,
// persists, and returns a plain result object (easy to render or serialize).

import { trainModel } from "../packages/core/src/index.ts";
import { DEFAULT_LEARN, DEFAULT_OUTREACH, type AgentConfig } from "./config.ts";
import { effectiveDailyCap } from "./billing.ts";
import { sendOutreach } from "./outreach.ts";
import type { Store } from "./store.ts";

export interface TrainResult {
  tenantId: string;
  trained: boolean;
  examples: number;
  top: { keyword: string; weight: number }[];
}

export function runTrain(store: Store, cfg: AgentConfig): TrainResult[] {
  const learn = cfg.settings.learn ?? DEFAULT_LEARN;
  const results: TrainResult[] = [];
  for (const t of cfg.tenants) {
    const ex = store.trainingExamples(t.id);
    if (ex.length < learn.minExamples) {
      results.push({ tenantId: t.id, trained: false, examples: ex.length, top: [] });
      continue;
    }
    const model = trainModel(ex, Date.now());
    store.setLearned(t.id, model);
    const top = Object.entries(model.keywordWeights)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 6)
      .map(([keyword, weight]) => ({ keyword, weight }));
    results.push({ tenantId: t.id, trained: true, examples: ex.length, top });
  }
  store.save();
  return results;
}

export interface SendResultItem {
  leadId: string;
  tenantId: string;
  via: string;
  ref: string;
}
export interface SendSummary {
  sent: number;
  capped: number;
  items: SendResultItem[];
}

export async function runSend(store: Store, cfg: AgentConfig, nowMs = Date.now()): Promise<SendSummary> {
  const out = cfg.settings.outreach ?? DEFAULT_OUTREACH;
  const approved = store.outbox("approved");
  const since = new Date(nowMs - 24 * 3600_000).toISOString();

  const byTenant = new Map<string, typeof approved>();
  for (const l of approved) {
    const arr = byTenant.get(l.tenantId) ?? [];
    arr.push(l);
    byTenant.set(l.tenantId, arr);
  }

  const items: SendResultItem[] = [];
  let sent = 0;
  let capped = 0;
  for (const [tenantId, leads] of byTenant) {
    const tenant = cfg.tenants.find((t) => t.id === tenantId);
    if (!tenant) continue;
    // Plan is the ceiling on daily sends, even if config asks for more.
    const dailyCap = effectiveDailyCap(tenant.plan, out.dailyCapPerTenant);
    let used = store.sentCountSince(tenantId, since);
    for (const l of leads) {
      if (used >= dailyCap) {
        capped++;
        continue;
      }
      const now = new Date().toISOString();
      const res = await sendOutreach(tenant, l, now);
      store.recordSend(tenantId, l.id, res.via, now);
      used++;
      sent++;
      items.push({ leadId: l.id, tenantId, via: res.via, ref: res.ref });
    }
  }
  store.save();
  return { sent, capped, items };
}
