// POST /api/signup — self-service onboarding. Body: { name?, email, headline,
// minBudget?, maxBudget?, register? }. Returns the auto-built profile + instant
// proof-of-value leads (the conversion mechanic), optionally registering the
// tenant for ongoing monitoring. Logic lives in agent/onboarding.ts (tested).
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildTenant, previewForProfile, registerTenant } from "../../../../../agent/onboarding.ts";

const Body = z.object({
  name: z.string().optional(),
  email: z.string().email(),
  headline: z.string().min(8),
  minBudget: z.number().optional(),
  maxBudget: z.number().optional(),
  register: z.boolean().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const profile = { name: parsed.data.email, ...parsed.data };
  const { tenant, leads } = await previewForProfile(profile);
  const registered = parsed.data.register ? registerTenant(buildTenant(profile)).added : false;

  return NextResponse.json({
    tenant: { id: tenant.id, role: tenant.sender.role, plan: tenant.plan, categories: tenant.icp.categories, keywords: tenant.icp.keywords },
    proofOfValue: leads.map((l) => ({ score: l.score, title: l.title, url: l.url, draftSubject: l.draftSubject })),
    registered,
  });
}
