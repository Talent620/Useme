// Loads the autonomous agent's runtime config (tenants, ICPs, sources).
// Config-driven so the operator changes behavior without touching code.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ICP, SourceKind } from "../packages/core/src/index.ts";
import type { SenderProfile } from "../packages/core/src/proposal/template.ts";

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

export interface AgentConfig {
  settings: {
    intervalMinutes: number;
    threshold: number;
    maxLeadsPerDigest: number;
    outreach?: OutreachSettings;
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

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig(path?: string): AgentConfig {
  const file = path ?? process.env.RADAR_CONFIG ?? resolve(ROOT, "config/tenants.json");
  const cfg = JSON.parse(readFileSync(file, "utf8")) as AgentConfig;
  // Normalize ICPs into full core ICP objects (inject ids).
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
