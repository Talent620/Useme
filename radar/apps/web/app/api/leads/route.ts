// GET /api/leads?tenantId=...&status=NEW&min=60
// Returns scored leads for a tenant, highest intent first.
import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db.ts";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  const status = url.searchParams.get("status") ?? undefined;
  const min = Number(url.searchParams.get("min") ?? "0");

  const leads = await prisma.lead.findMany({
    where: { tenantId, score: { gte: min }, ...(status ? { status: status as never } : {}) },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: { signal: { select: { title: true, url: true, source: true, budget: true, publishedAt: true } } },
  });

  return NextResponse.json({ count: leads.length, leads });
}
