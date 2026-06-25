// Picks the persistence backend: Postgres/Prisma when DATABASE_URL is set,
// otherwise an in-memory repo seeded from config (handy for local dev/tests).

import { loadConfig, tenantICP } from "./config.ts";
import { InMemoryLeadRepo } from "./repo-memory.ts";
import type { LeadRepo } from "./repo.ts";

export async function createLeadRepo(): Promise<LeadRepo> {
  if (process.env.DATABASE_URL) {
    // Lazy: only touch @prisma/client when actually using Postgres.
    const { PrismaClient } = await import("@prisma/client");
    const { PrismaLeadRepo } = await import("./repo-prisma.ts");
    return new PrismaLeadRepo(new PrismaClient());
  }
  const cfg = loadConfig();
  return new InMemoryLeadRepo(cfg.tenants.map(tenantICP));
}
