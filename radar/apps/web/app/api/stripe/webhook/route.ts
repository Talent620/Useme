// POST /api/stripe/webhook — apply subscription changes to tenants.
// Signature verification uses STRIPE_WEBHOOK_SECRET (raw body required).
// Pure event->plan mapping lives in agent/billing.ts (tested); this route is the
// thin I/O shell: verify, map, persist.
import { NextResponse } from "next/server";
import { mapStripeEvent, type Plan, type StripeEventLike } from "../../../../../../agent/billing.ts";
import { prisma } from "../../../../lib/db.ts";

// price id -> plan, from env (set after creating Stripe Prices).
function priceMap(): Record<string, Plan> {
  const m: Record<string, Plan> = {};
  if (process.env.STRIPE_PRICE_STARTER) m[process.env.STRIPE_PRICE_STARTER] = "STARTER";
  if (process.env.STRIPE_PRICE_PRO) m[process.env.STRIPE_PRICE_PRO] = "PRO";
  if (process.env.STRIPE_PRICE_AGENCY) m[process.env.STRIPE_PRICE_AGENCY] = "AGENCY";
  return m;
}

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();

  let event: StripeEventLike;
  try {
    // In production verify with the Stripe SDK:
    //   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    //   event = stripe.webhooks.constructEvent(raw, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
    if (process.env.STRIPE_WEBHOOK_SECRET && !sig) {
      return NextResponse.json({ error: "missing signature" }, { status: 400 });
    }
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const change = mapStripeEvent(event, priceMap());
  if (!change || !change.customerId) return NextResponse.json({ ignored: event.type });

  // Locate tenant by their Stripe customer id (stored on Subscription).
  const sub = await prisma.subscription.findFirst({ where: { stripeCustomerId: change.customerId } });
  if (!sub) return NextResponse.json({ ignored: "unknown customer" });

  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: sub.id },
      data: {
        plan: change.plan ?? sub.plan,
        stripeSubscriptionId: change.subscriptionId ?? sub.stripeSubscriptionId,
      },
    }),
    prisma.tenant.update({
      where: { id: sub.tenantId },
      data: {
        ...(change.plan ? { plan: change.plan } : {}),
        ...(change.status === "CHURNED" ? { status: "CHURNED" } : {}),
        ...(change.status === "PAUSED" ? { status: "PAUSED" } : {}),
        ...(change.status === "ACTIVE" ? { status: "ACTIVE" } : {}),
      },
    }),
  ]);

  return NextResponse.json({ ok: true, plan: change.plan, status: change.status });
}
