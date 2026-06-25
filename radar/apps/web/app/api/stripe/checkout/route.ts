// POST /api/stripe/checkout — start a subscription checkout for a plan.
// Body: { tenantId, plan }. Returns a Checkout URL. Thin shell over Stripe SDK.
import { NextResponse } from "next/server";
import { PLANS, type Plan } from "../../../../../../agent/billing.ts";

const PRICE_ENV: Record<Exclude<Plan, "TRIAL">, string> = {
  STARTER: "STRIPE_PRICE_STARTER",
  PRO: "STRIPE_PRICE_PRO",
  AGENCY: "STRIPE_PRICE_AGENCY",
};

export async function POST(req: Request) {
  const { tenantId, plan } = (await req.json()) as { tenantId?: string; plan?: Plan };
  if (!tenantId || !plan || !(plan in PLANS) || plan === "TRIAL") {
    return NextResponse.json({ error: "tenantId and a paid plan required" }, { status: 400 });
  }
  const priceId = process.env[PRICE_ENV[plan as Exclude<Plan, "TRIAL">]];
  if (!priceId || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "billing not configured" }, { status: 503 });
  }

  // Production:
  //   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  //   const session = await stripe.checkout.sessions.create({
  //     mode: "subscription",
  //     line_items: [{ price: priceId, quantity: 1 }],
  //     client_reference_id: tenantId,
  //     success_url: `${process.env.APP_URL}/billing/success`,
  //     cancel_url: `${process.env.APP_URL}/billing`,
  //   });
  //   return NextResponse.json({ url: session.url });

  return NextResponse.json({
    error: "Stripe SDK not wired in this build",
    plan,
    priceId,
    monthlyPln: PLANS[plan].priceMonthlyPln,
  }, { status: 501 });
}
