// Billing & plan entitlements. Pure, deterministic, testable. The Stripe webhook
// route maps events to plan changes via mapStripeEvent(); the agent enforces the
// resulting entitlements (digest size, auto-approve, outreach cap) at runtime.

export type Plan = "TRIAL" | "STARTER" | "PRO" | "AGENCY";

export interface Entitlements {
  plan: Plan;
  priceMonthlyPln: number;
  maxICPs: number;
  maxLeadsPerDigest: number;
  instantAlerts: boolean;
  autoApproveAllowed: boolean;
  apiAccess: boolean;
  dailyOutreachCap: number;
}

export const PLANS: Record<Plan, Entitlements> = {
  TRIAL: { plan: "TRIAL", priceMonthlyPln: 0, maxICPs: 1, maxLeadsPerDigest: 5, instantAlerts: false, autoApproveAllowed: false, apiAccess: false, dailyOutreachCap: 3 },
  STARTER: { plan: "STARTER", priceMonthlyPln: 49, maxICPs: 1, maxLeadsPerDigest: 10, instantAlerts: false, autoApproveAllowed: false, apiAccess: false, dailyOutreachCap: 10 },
  PRO: { plan: "PRO", priceMonthlyPln: 149, maxICPs: 3, maxLeadsPerDigest: 25, instantAlerts: true, autoApproveAllowed: true, apiAccess: false, dailyOutreachCap: 30 },
  AGENCY: { plan: "AGENCY", priceMonthlyPln: 499, maxICPs: 10, maxLeadsPerDigest: 100, instantAlerts: true, autoApproveAllowed: true, apiAccess: true, dailyOutreachCap: 100 },
};

export function entitlements(plan: Plan | undefined): Entitlements {
  return PLANS[plan ?? "STARTER"] ?? PLANS.STARTER;
}

export function canAddICP(plan: Plan | undefined, currentCount: number): boolean {
  return currentCount < entitlements(plan).maxICPs;
}

/** Auto-approve only when both requested AND allowed by the plan. */
export function effectiveAutoApprove(plan: Plan | undefined, requested: boolean): boolean {
  return requested && entitlements(plan).autoApproveAllowed;
}

/** The smaller of the configured value and the plan limit (plan is the ceiling). */
export function effectiveDigestCap(plan: Plan | undefined, configured: number): number {
  return Math.min(configured, entitlements(plan).maxLeadsPerDigest);
}
export function effectiveDailyCap(plan: Plan | undefined, configured: number): number {
  return Math.min(configured, entitlements(plan).dailyOutreachCap);
}

// --- Stripe event mapping (pure) -----------------------------------------

export interface StripeEventLike {
  type: string;
  data: { object: Record<string, unknown> };
}

export interface PlanChange {
  customerId?: string;
  subscriptionId?: string;
  plan?: Plan;
  status?: "ACTIVE" | "CHURNED" | "PAUSED";
}

/** Resolve a Stripe price id to a plan using a configured price->plan map. */
export function planFromPriceId(priceId: string | undefined, priceMap: Record<string, Plan>): Plan | undefined {
  return priceId ? priceMap[priceId] : undefined;
}

/**
 * Translate a Stripe webhook event into a plan change. Returns null for events
 * we don't act on. priceMap maps Stripe price ids to our plans.
 */
export function mapStripeEvent(event: StripeEventLike, priceMap: Record<string, Plan>): PlanChange | null {
  const o = event.data.object;
  const customerId = (o.customer as string) ?? undefined;

  switch (event.type) {
    case "checkout.session.completed":
      return {
        customerId,
        subscriptionId: (o.subscription as string) ?? undefined,
        plan: planFromPriceId(extractPriceId(o), priceMap),
        status: "ACTIVE",
      };
    case "customer.subscription.updated":
      return {
        customerId,
        subscriptionId: (o.id as string) ?? undefined,
        plan: planFromPriceId(extractPriceId(o), priceMap),
        status: subStatus(o),
      };
    case "customer.subscription.deleted":
      return { customerId, subscriptionId: (o.id as string) ?? undefined, plan: "TRIAL", status: "CHURNED" };
    case "invoice.payment_failed":
      return { customerId, status: "PAUSED" };
    default:
      return null;
  }
}

function subStatus(o: Record<string, unknown>): PlanChange["status"] {
  const s = o.status as string | undefined;
  if (s === "active" || s === "trialing") return "ACTIVE";
  if (s === "past_due" || s === "unpaid") return "PAUSED";
  if (s === "canceled") return "CHURNED";
  return "ACTIVE";
}

/** Pull the first line-item price id out of a checkout session or subscription. */
function extractPriceId(o: Record<string, unknown>): string | undefined {
  const items = (o.items as { data?: { price?: { id?: string } }[] } | undefined)?.data;
  if (items?.[0]?.price?.id) return items[0].price.id;
  const lines = (o.line_items as { data?: { price?: { id?: string } }[] } | undefined)?.data;
  if (lines?.[0]?.price?.id) return lines[0].price.id;
  return (o.price as { id?: string } | undefined)?.id;
}
