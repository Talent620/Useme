// Agent-CEO: autonomous P&L meta-optimizer. Reads the whole funnel's economics
// (cost vs realized revenue per category / source / tenant) and emits prioritized
// reallocation actions — what to push, sunset, re-price, or upsell. Deterministic
// and auditable; a safe subset is auto-applicable. Pure (no I/O), unit-tested.

export interface LeadFact {
  category: string;
  source: string;
  tenantId: string;
  status: string; // NEW/SENT/REPLIED/WON/REJECTED
  budget?: number;
  sent?: boolean;
  executed?: boolean;
  executionOutcome?: "ACCEPTED" | "REVISION" | "REJECTED";
}

export interface TenantFact {
  id: string;
  plan?: string; // TRIAL/STARTER/PRO/AGENCY
}

export interface Costs {
  perLead: number; // ingest + enrich + score, amortized
  perSend: number; // outreach
  perExecution: number; // produce + verify (LLM/compute)
}

export const DEFAULT_COSTS: Costs = { perLead: 0.4, perSend: 0.2, perExecution: 2.5 };

// Monthly plan prices (PLN) for upsell impact estimation.
const PLAN_PRICE: Record<string, number> = { TRIAL: 0, STARTER: 49, PRO: 149, AGENCY: 499 };
const PLAN_NEXT: Record<string, string> = { TRIAL: "STARTER", STARTER: "PRO", PRO: "AGENCY" };

export interface Segment {
  key: string;
  leads: number;
  won: number;
  winRate: number;
  executed: number;
  accepted: number;
  acceptanceRate: number;
  revenue: number;
  cost: number;
  margin: number;
  roi: number; // margin / cost
}

export interface Funnel {
  byCategory: Segment[];
  bySource: Segment[];
  byTenant: Segment[];
  totals: { leads: number; won: number; revenue: number; cost: number; margin: number };
}

function emptyAgg() {
  return { leads: 0, won: 0, executed: 0, accepted: 0, revenue: 0, cost: 0 };
}

function aggregate(facts: LeadFact[], keyOf: (f: LeadFact) => string, costs: Costs): Segment[] {
  const map = new Map<string, ReturnType<typeof emptyAgg>>();
  for (const f of facts) {
    const key = keyOf(f) || "(brak)";
    const a = map.get(key) ?? emptyAgg();
    a.leads += 1;
    a.cost += costs.perLead + (f.sent ? costs.perSend : 0) + (f.executed ? costs.perExecution : 0);
    if (f.status === "WON") a.won += 1;
    if (f.executed) a.executed += 1;
    if (f.executionOutcome === "ACCEPTED") {
      a.accepted += 1;
      a.revenue += f.budget ?? 0; // realized revenue = delivered & accepted budget
    }
    map.set(key, a);
  }
  return [...map.entries()]
    .map(([key, a]) => ({
      key,
      leads: a.leads,
      won: a.won,
      winRate: a.leads ? a.won / a.leads : 0,
      executed: a.executed,
      accepted: a.accepted,
      acceptanceRate: a.executed ? a.accepted / a.executed : 0,
      revenue: Math.round(a.revenue),
      cost: Math.round(a.cost * 100) / 100,
      margin: Math.round((a.revenue - a.cost) * 100) / 100,
      roi: a.cost ? Math.round(((a.revenue - a.cost) / a.cost) * 100) / 100 : 0,
    }))
    .sort((x, y) => y.margin - x.margin);
}

export function computeFunnel(facts: LeadFact[], costs: Costs = DEFAULT_COSTS): Funnel {
  const byCategory = aggregate(facts, (f) => f.category, costs);
  const bySource = aggregate(facts, (f) => f.source, costs);
  const byTenant = aggregate(facts, (f) => f.tenantId, costs);
  const totals = byCategory.reduce(
    (t, s) => ({ leads: t.leads + s.leads, won: t.won + s.won, revenue: t.revenue + s.revenue, cost: t.cost + s.cost, margin: t.margin + s.margin }),
    { leads: 0, won: 0, revenue: 0, cost: 0, margin: 0 },
  );
  totals.cost = Math.round(totals.cost * 100) / 100;
  totals.margin = Math.round(totals.margin * 100) / 100;
  return { byCategory, bySource, byTenant, totals };
}

export type RecAction =
  | "disable_source"
  | "grow_category"
  | "raise_quality"
  | "sunset_category"
  | "upsell_tenant"
  | "raise_price";

export interface Recommendation {
  action: RecAction;
  target: string;
  rationale: string;
  expectedImpactPln: number;
  confidence: number; // 0..1
  autoApplicable: boolean;
}

export interface RecommendOpts {
  minLeads?: number;
  growRoi?: number;
  tenants?: TenantFact[];
}

export function recommend(funnel: Funnel, opts: RecommendOpts = {}): Recommendation[] {
  const minLeads = opts.minLeads ?? 5;
  const growRoi = opts.growRoi ?? 2;
  const recs: Recommendation[] = [];

  // Sources that burn cost with zero conversions → cut them (safe to auto-apply).
  for (const s of funnel.bySource) {
    if (s.leads >= minLeads && s.won === 0) {
      recs.push({ action: "disable_source", target: s.key, rationale: `${s.leads} leadów, 0 wygranych — koszt ${s.cost} zł bez konwersji`, expectedImpactPln: Math.round(s.cost), confidence: 0.85, autoApplicable: true });
    }
  }

  // Categories: grow the profitable, fix or sunset the unprofitable.
  for (const c of funnel.byCategory) {
    if (c.accepted >= 2 && c.roi >= growRoi) {
      recs.push({ action: "grow_category", target: c.key, rationale: `ROI ${c.roi}x, marża ${c.margin} zł — rozszerz ICP / pozyskaj więcej klientów`, expectedImpactPln: Math.round(c.margin), confidence: 0.7, autoApplicable: false });
    }
    if (c.executed >= 3 && c.acceptanceRate < 0.5) {
      recs.push({ action: "raise_quality", target: c.key, rationale: `akceptacja wykonania ${Math.round(c.acceptanceRate * 100)}% — podnieś próg jakości / iteracje`, expectedImpactPln: Math.round(c.revenue * 0.3), confidence: 0.6, autoApplicable: true });
    }
    if (c.leads >= minLeads && c.margin < 0) {
      recs.push({ action: "sunset_category", target: c.key, rationale: `marża ujemna ${c.margin} zł przy ${c.leads} leadach`, expectedImpactPln: Math.round(-c.margin), confidence: 0.55, autoApplicable: false });
    }
    if (c.accepted >= 2 && c.revenue > 0 && c.accepted <= 3 && c.revenue / Math.max(1, c.accepted) > 3000) {
      recs.push({ action: "raise_price", target: c.key, rationale: `wysoka wartość zlecenia (śr. ${Math.round(c.revenue / c.accepted)} zł) przy małym wolumenie — premium pricing`, expectedImpactPln: Math.round(c.revenue * 0.2), confidence: 0.5, autoApplicable: false });
    }
  }

  // Tenants on a small plan with traction → upsell (revenue expansion).
  const planById = new Map((opts.tenants ?? []).map((t) => [t.id, t.plan ?? "STARTER"]));
  for (const t of funnel.byTenant) {
    const plan = planById.get(t.key) ?? "STARTER";
    const next = PLAN_NEXT[plan];
    if (next && t.won >= 3) {
      const delta = (PLAN_PRICE[next] ?? 0) - (PLAN_PRICE[plan] ?? 0);
      recs.push({ action: "upsell_tenant", target: t.key, rationale: `${t.won} wygranych na planie ${plan} — upsell do ${next}`, expectedImpactPln: delta, confidence: 0.6, autoApplicable: false });
    }
  }

  return recs.sort((a, b) => b.expectedImpactPln * b.confidence - a.expectedImpactPln * a.confidence);
}
