-- RadarPL initial schema (PostgreSQL). Generated to match prisma/schema.prisma.

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('TRIAL', 'STARTER', 'PRO', 'AGENCY');
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CHURNED');
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'SENT', 'REPLIED', 'WON', 'REJECTED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'TRIAL',
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tenant_email_key" ON "Tenant"("email");

CREATE TABLE "Icp" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT[],
    "excludeKeywords" TEXT[],
    "categories" TEXT[],
    "langs" TEXT[],
    "minBudget" INTEGER,
    "maxBudget" INTEGER,
    "sourceWeights" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Icp_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Icp_tenantId_active_idx" ON "Icp"("tenantId", "active");

CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "budget" INTEGER,
    "categories" TEXT[],
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT NOT NULL,
    "raw" JSONB,
    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Signal_dedupeKey_key" ON "Signal"("dedupeKey");
CREATE INDEX "Signal_source_publishedAt_idx" ON "Signal"("source", "publishedAt");
CREATE INDEX "Signal_fetchedAt_idx" ON "Signal"("fetchedAt");

CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "icpId" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" TEXT[],
    "matchedKeywords" TEXT[],
    "draftSubject" TEXT,
    "draftBody" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Lead_tenantId_signalId_icpId_key" ON "Lead"("tenantId", "signalId", "icpId");
CREATE INDEX "Lead_tenantId_status_score_idx" ON "Lead"("tenantId", "status", "score");

CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "leadIds" TEXT[],
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Delivery_tenantId_createdAt_idx" ON "Delivery"("tenantId", "createdAt");

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "plan" "Plan" NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

CREATE TABLE "SourceState" (
    "id" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "cursor" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "healthy" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "SourceState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SourceState_sourceName_key" ON "SourceState"("sourceName");

-- AddForeignKey
ALTER TABLE "Icp" ADD CONSTRAINT "Icp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_icpId_fkey" FOREIGN KEY ("icpId") REFERENCES "Icp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
