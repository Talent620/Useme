// Turn scored signals into leads for the tenants whose ICP they fit.

import type { ICP, Lead, Signal } from "../signals/types.ts";
import { scoreSignal } from "../signals/score.ts";

export interface MatchOptions {
  /** Minimum score to emit a lead. Default 45. */
  threshold?: number;
  now: number;
}

/** Match one signal against many ICPs, emitting a lead per qualifying ICP. */
export function matchSignal(signal: Signal, icps: ICP[], opts: MatchOptions): Lead[] {
  const threshold = opts.threshold ?? 45;
  const leads: Lead[] = [];
  for (const icp of icps) {
    const r = scoreSignal(signal, icp, opts.now);
    if (r.score >= threshold) {
      leads.push({
        signalId: signal.id,
        icpId: icp.id,
        tenantId: icp.tenantId,
        score: r.score,
        reasons: r.reasons,
        matchedKeywords: r.matchedKeywords,
        createdAt: new Date(opts.now).toISOString(),
      });
    }
  }
  return leads.sort((a, b) => b.score - a.score);
}

/** Batch helper: match many signals, returning leads grouped per tenant. */
export function matchBatch(
  signals: Signal[],
  icps: ICP[],
  opts: MatchOptions,
): Map<string, Lead[]> {
  const byTenant = new Map<string, Lead[]>();
  for (const signal of signals) {
    for (const lead of matchSignal(signal, icps, opts)) {
      const arr = byTenant.get(lead.tenantId) ?? [];
      arr.push(lead);
      byTenant.set(lead.tenantId, arr);
    }
  }
  for (const arr of byTenant.values()) arr.sort((a, b) => b.score - a.score);
  return byTenant;
}
