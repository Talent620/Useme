// POST /api/ingest — push a batch of raw listings (from n8n / external crawlers)
// straight through the core pipeline. Idempotent on dedupeKey.
import { NextResponse } from "next/server";
import { z } from "zod";
import { matchSignal, toSignal, type ICP } from "@radar/core";
import { prisma } from "../../../lib/db.ts";

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

  const { sourceName, kind, listings } = parsed.data;
  const now = Date.now();
  const icps = (await prisma.icp.findMany({ where: { active: true } })) as unknown as ICP[];

  let created = 0;
  let leads = 0;
  for (const raw of listings) {
    const sig = toSignal(raw, kind, sourceName, "tmp", now);
    const existing = await prisma.signal.findUnique({ where: { dedupeKey: sig.dedupeKey } });
    if (existing) continue;

    const saved = await prisma.signal.create({
      data: {
        source: sig.source, sourceName: sig.sourceName, url: sig.url, title: sig.title,
        body: sig.body, lang: sig.lang, budget: sig.budget, categories: sig.categories,
        publishedAt: new Date(sig.publishedAt), dedupeKey: sig.dedupeKey, raw,
      },
    });
    created++;

    for (const lead of matchSignal({ ...sig, id: saved.id }, icps, { now, threshold: 45 })) {
      await prisma.lead.upsert({
        where: { tenantId_signalId_icpId: { tenantId: lead.tenantId, signalId: saved.id, icpId: lead.icpId } },
        create: {
          tenantId: lead.tenantId, signalId: saved.id, icpId: lead.icpId,
          score: lead.score, reasons: lead.reasons, matchedKeywords: lead.matchedKeywords,
        },
        update: { score: lead.score },
      });
      leads++;
    }
  }

  return NextResponse.json({ received: listings.length, created, leads });
}
