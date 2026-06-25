// Finance agent (CFO). Turns the funnel + plan subscriptions into a full
// financial picture: P&L, MRR, gross margin, ROI, CAC, LTV, and a simple
// revenue forecast. Deterministic; complements the strategy P&L with SaaS
// economics. No external services.

import { computeFunnel, DEFAULT_COSTS, type Costs, type LeadFact } from "./strategy.ts";

const PLAN_PRICE: Record<string, number> = { TRIAL: 0, STARTER: 49, PRO: 149, AGENCY: 499 };

export interface Financials {
  // Execution (work delivered) economics
  executionRevenue: number;
  cost: number;
  grossMargin: number;
  marginPct: number;
  // SaaS economics
  mrr: number;
  arpu: number;
  activeTenants: number;
  payingTenants: number;
  // Unit economics
  customersWon: number;
  cac: number; // cost to acquire a won customer
  ltv: number; // lifetime value estimate
  ltvCacRatio: number;
  roi: number;
}

export interface FinanceOpts {
  costs?: Costs;
  avgLifetimeMonths?: number;
}

export function financials(facts: LeadFact[], tenants: { id: string; plan?: string }[], opts: FinanceOpts = {}): Financials {
  const costs = opts.costs ?? DEFAULT_COSTS;
  const lifetime = opts.avgLifetimeMonths ?? 10;
  const funnel = computeFunnel(facts, costs);

  const mrr = tenants.reduce((s, t) => s + (PLAN_PRICE[t.plan ?? "STARTER"] ?? 0), 0);
  const payingTenants = tenants.filter((t) => (PLAN_PRICE[t.plan ?? "STARTER"] ?? 0) > 0).length;
  const activeTenants = tenants.length || 1;
  const arpu = Math.round((mrr / activeTenants) * 100) / 100;

  const customersWon = new Set(facts.filter((f) => f.status === "WON").map((f) => f.tenantId)).size;
  const cost = funnel.totals.cost;
  const cac = customersWon ? Math.round((cost / customersWon) * 100) / 100 : 0;
  const ltv = Math.round(arpu * lifetime * 100) / 100;

  return {
    executionRevenue: funnel.totals.revenue,
    cost,
    grossMargin: funnel.totals.margin,
    marginPct: funnel.totals.revenue ? Math.round((funnel.totals.margin / funnel.totals.revenue) * 100) : 0,
    mrr,
    arpu,
    activeTenants,
    payingTenants,
    customersWon,
    cac,
    ltv,
    ltvCacRatio: cac ? Math.round((ltv / cac) * 100) / 100 : 0,
    roi: cost ? Math.round((funnel.totals.margin / cost) * 100) / 100 : 0,
  };
}

/** Naive revenue forecast: project MRR forward with a monthly growth rate. */
export function revenueForecast(mrr: number, months = 6, monthlyGrowth = 0.1): { month: number; mrr: number }[] {
  const out: { month: number; mrr: number }[] = [];
  let v = mrr;
  for (let m = 1; m <= months; m++) {
    v = Math.round(v * (1 + monthlyGrowth));
    out.push({ month: m, mrr: v });
  }
  return out;
}
