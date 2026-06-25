// Postgres-backed LeadRepo via Prisma. The PrismaClient is injected (the factory
// constructs it) so this module stays import-safe even where @prisma/client is
// absent — the type import is erased at runtime.

import type { PrismaClient } from "@prisma/client";
import type { ICP, Signal } from "../packages/core/src/index.ts";
import type { LeadRepo, LeadView, ListLeadsOptions, UpsertLeadInput } from "./repo.ts";

export class PrismaLeadRepo implements LeadRepo {
  private prisma: PrismaClient;
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async hasSignal(dedupeKey: string): Promise<boolean> {
    const found = await this.prisma.signal.findUnique({ where: { dedupeKey }, select: { id: true } });
    return found != null;
  }

  async createSignal(signal: Signal): Promise<{ id: string }> {
    const row = await this.prisma.signal.create({
      data: {
        source: signal.source, sourceName: signal.sourceName, url: signal.url,
        title: signal.title, body: signal.body, lang: signal.lang, budget: signal.budget,
        categories: signal.categories, publishedAt: new Date(signal.publishedAt),
        dedupeKey: signal.dedupeKey,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async listActiveICPs(): Promise<ICP[]> {
    const rows = await this.prisma.icp.findMany({ where: { active: true } });
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      tenantId: r.tenantId as string,
      name: r.name as string,
      keywords: r.keywords as string[],
      excludeKeywords: r.excludeKeywords as string[],
      categories: r.categories as string[],
      langs: r.langs as string[],
      minBudget: (r.minBudget as number | null) ?? undefined,
      maxBudget: (r.maxBudget as number | null) ?? undefined,
    }));
  }

  async upsertLead(input: UpsertLeadInput): Promise<void> {
    await this.prisma.lead.upsert({
      where: {
        tenantId_signalId_icpId: {
          tenantId: input.tenantId, signalId: input.signalId, icpId: input.icpId,
        },
      },
      create: {
        tenantId: input.tenantId, signalId: input.signalId, icpId: input.icpId,
        score: input.score, reasons: input.reasons, matchedKeywords: input.matchedKeywords,
        draftSubject: input.draftSubject, draftBody: input.draftBody,
      },
      update: { score: input.score, reasons: input.reasons },
    });
  }

  async listLeads(tenantId: string, opts: ListLeadsOptions = {}): Promise<LeadView[]> {
    const rows = await this.prisma.lead.findMany({
      where: {
        tenantId,
        score: { gte: opts.min ?? 0 },
        ...(opts.status ? { status: opts.status as never } : {}),
      },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: opts.limit ?? 100,
      include: { signal: { select: { title: true, url: true, budget: true } } },
    });
    return rows.map((l: Record<string, unknown>) => {
      const signal = l.signal as { title: string; url: string; budget: number | null };
      return {
        id: l.id as string, tenantId: l.tenantId as string, signalId: l.signalId as string,
        score: l.score as number, reasons: l.reasons as string[], matchedKeywords: l.matchedKeywords as string[],
        status: l.status as string, signalTitle: signal.title, signalUrl: signal.url,
        signalBudget: signal.budget ?? undefined,
      };
    });
  }
}
