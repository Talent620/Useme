// GET /api/leads?tenantId=...&status=NEW&min=60
// Returns scored leads for a tenant, highest intent first. Backend-agnostic.
import { NextResponse } from "next/server";
import { createLeadRepo } from "../../../../../agent/repo-factory.ts";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  const status = url.searchParams.get("status") ?? undefined;
  const min = Number(url.searchParams.get("min") ?? "0");

  const repo = await createLeadRepo();
  const leads = await repo.listLeads(tenantId, { min, status, limit: 100 });
  return NextResponse.json({ count: leads.length, leads });
}
