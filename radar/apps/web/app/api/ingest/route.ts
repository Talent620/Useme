// POST /api/ingest — push a batch of raw listings (from n8n / external crawlers)
// through the SAME core pipeline the agent uses. Idempotent on dedupeKey.
// Backend (Postgres via Prisma, or in-memory dev fallback) chosen by factory.
import { NextResponse } from "next/server";
import { z } from "zod";
import { ingest } from "../../../../../agent/ingest-pipeline.ts";
import { createLeadRepo } from "../../../../../agent/repo-factory.ts";

const Body = z.object({
  sourceName: z.string(),
  kind: z.enum(["job_board", "tender", "registry", "funding", "social", "rss"]),
  listings: z.array(
    z.object({
      url: z.string().url(),
      title: z.string(),
      body: z.string().default(""),
      publishedAt: z.string().optional(),
      rawBudget: z.string().optional(),
    }),
  ),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const repo = await createLeadRepo();
  const result = await ingest(repo, parsed.data);
  return NextResponse.json(result);
}
