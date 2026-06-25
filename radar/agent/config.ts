// Loads the autonomous agent's runtime config (tenants, ICPs, sources).
// Config-driven so the operator changes behavior without touching code.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ICP, SourceKind } from "../packages/core/src/index.ts";
import type { SenderProfile } from "../packages/core/src/proposal/template.ts";
import type { Plan } from "./billing.ts";

export interface SourceDef {
  name: string;
  kind: SourceKind;
  feed: string; // http(s):// or file:./relative
  enabled: boolean;
}

export interface TenantDef {
  id: string;
  name: string;
  email: string;
  channel: "file" | "email" | "slack" | "webhook";
  /** Billing plan — governs digest size, auto-approve and outreach caps. */
  plan?: Plan;
  sender: SenderProfile;
  icp: Omit<ICP, "id" | "tenantId">;
}

export interface OutreachSettings {
  /** Master switch for the outreach pipeline. */
  enabled: boolean;
  /** Minimum lead score to enqueue for outreach. */
  threshold: number;
  /** If true, queued leads are auto-approved (skip human gate). Use with care. */
  autoApprove: boolean;
  /** Max sends per tenant per rolling 24h (deliverability/safety). */
  dailyCapPerTenant: number;
}

export interface LearnSettings {
  /** Re-train the per-tenant model at the end of every cycle. */
  autoTrain: boolean;
  /** Minimum labeled examples before a model is trained/applied. */
  minExamples: number;
}

export interface AgentConfig {
  settings: {
    intervalMinutes: number;
    threshold: number;
    maxLeadsPerDigest: number;
    outreach?: OutreachSettings;
    learn?: LearnSettings;
    execution?: ExecutionSettings;
  };
  sources: SourceDef[];
  tenants: TenantDef[];
}

export const DEFAULT_OUTREACH: OutreachSettings = {
  enabled: true,
  threshold: 75,
  autoApprove: false,
  dailyCapPerTenant: 20,
};

export const DEFAULT_LEARN: LearnSettings = { autoTrain: true, minExamples: 5 };

export interface ExecutionSettings {
  /** Master switch for the autonomous execution engine. */
  enabled: boolean;
  /** Execute won leads automatically at the end of each cycle. */
  autoExecuteOnWon: boolean;
  /** Self-revision budget per task. */
  maxIterations: number;
  /** Confidence required to auto-deliver (below => queued for human review). */
  minConfidence: number;
}

export const DEFAULT_EXECUTION: ExecutionSettings = {
  enabled: true,
  autoExecuteOnWon: true,
  maxIterations: 3,
  minConfidence: 80,
};

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Path to the runtime overlay where self-service signups append tenants. */
export function tenantsOverlayPath(): string {
  return (
    process.env.RADAR_TENANTS_FILE ??
    resolve(process.env.RADAR_DATA_DIR ?? resolve(ROOT, "data"), "tenants-extra.json")
  );
}

/** Minimal working config written on first run of a standalone binary. */
export const DEFAULT_CONFIG: AgentConfig = {
  settings: {
    intervalMinutes: 30,
    threshold: 45,
    maxLeadsPerDigest: 15,
    outreach: { enabled: true, threshold: 75, autoApprove: false, dailyCapPerTenant: 20 },
    learn: { autoTrain: true, minExamples: 5 },
    execution: { enabled: true, autoExecuteOnWon: true, maxIterations: 3, minConfidence: 80 },
  },
  sources: [{ name: "useme", kind: "job_board", feed: "https://useme.com/pl/jobs/feed/", enabled: false }],
  tenants: [
    {
      id: "self",
      name: "RadarPL",
      email: "you@example.com",
      channel: "file",
      plan: "STARTER",
      sender: { name: "Twoje Imię", role: "freelancer", proofPoints: ["uzupełnij profil"] },
      icp: { name: "Twój ICP", keywords: ["uzupełnij"], excludeKeywords: ["wolontariat", "za darmo"], categories: ["web"], langs: ["pl"], minBudget: 300, maxBudget: 100000 },
    },
  ],
};

/** Resolve the config file, bootstrapping a default one if none exists. */
function resolveConfigFile(path?: string): string {
  if (path) return path;
  if (process.env.RADAR_CONFIG) return process.env.RADAR_CONFIG;
  const rootCfg = resolve(ROOT, "config/tenants.json");
  if (existsSync(rootCfg)) return rootCfg;
  const cwdCfg = resolve(process.cwd(), "config/tenants.json");
  if (existsSync(cwdCfg)) return cwdCfg;
  // First run of a standalone binary: write an editable default next to CWD.
  mkdirSync(resolve(process.cwd(), "config"), { recursive: true });
  writeFileSync(cwdCfg, JSON.stringify(DEFAULT_CONFIG, null, 2));
  return cwdCfg;
}

export function loadConfig(path?: string): AgentConfig {
  const file = resolveConfigFile(path);
  const cfg = JSON.parse(readFileSync(file, "utf8")) as AgentConfig;
  // Merge self-service signups (overlay), deduped by id. Base config wins on clash.
  const overlay = tenantsOverlayPath();
  if (existsSync(overlay)) {
    try {
      const extra = JSON.parse(readFileSync(overlay, "utf8")) as TenantDef[];
      const have = new Set(cfg.tenants.map((t) => t.id));
      for (const t of extra) if (!have.has(t.id)) cfg.tenants.push(t);
    } catch {
      /* malformed overlay is ignored, never crashes a cycle */
    }
  }
  return cfg;
}

/** Build a core ICP from a tenant definition. */
export function tenantICP(t: TenantDef): ICP {
  return { id: `icp-${t.id}`, tenantId: t.id, ...t.icp };
}

/** Resolve a source feed to an absolute path/URL. */
export function resolveFeed(feed: string): string {
  if (feed.startsWith("file:")) return resolve(ROOT, feed.slice("file:".length));
  return feed;
}
