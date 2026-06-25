// Autonomous delivery: render a per-tenant digest and ship it.
// Channels: file (always, audit trail) + optional webhook/slack via env.
// Idempotent — the cycle only passes undelivered leads.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, type TenantDef } from "./config.ts";
import type { StoredLead } from "./store.ts";

function moneyPL(n?: number): string {
  return n ? `${n.toLocaleString("pl-PL")} zł` : "—";
}

export function renderDigest(tenant: TenantDef, leads: StoredLead[], dateISO: string): string {
  const lines: string[] = [];
  lines.push(`# RadarPL — leady dla: ${tenant.name}`);
  lines.push(`Data: ${dateISO.slice(0, 16).replace("T", " ")} · Nowych leadów: ${leads.length}`);
  lines.push("");
  if (!leads.length) {
    lines.push("_Brak nowych dopasowanych leadów w tym cyklu._");
    return lines.join("\n");
  }
  leads.forEach((l, i) => {
    lines.push(`## ${i + 1}. [${l.score}/100] ${l.signalTitle}`);
    lines.push(`- Budżet: ${moneyPL(l.signalBudget)}`);
    lines.push(`- Link: ${l.signalUrl}`);
    lines.push(`- Dlaczego: ${l.reasons.slice(0, 3).join(" · ")}`);
    if (l.draftSubject) {
      lines.push("");
      lines.push(`**Gotowy draft — temat:** ${l.draftSubject}`);
      lines.push("```");
      lines.push(l.draftBody ?? "");
      lines.push("```");
    }
    lines.push("");
  });
  return lines.join("\n");
}

export interface DeliveryResult {
  channel: string;
  ref: string; // file path or webhook status
}

export async function deliver(
  tenant: TenantDef,
  leads: StoredLead[],
  dateISO: string,
): Promise<DeliveryResult> {
  const md = renderDigest(tenant, leads, dateISO);

  // 1) Always write a file (audit + the "file" channel).
  const dir = resolve(process.env.RADAR_DATA_DIR ?? resolve(ROOT, "data"), "digests");
  mkdirSync(dir, { recursive: true });
  const stamp = dateISO.replace(/[:.]/g, "-").slice(0, 19);
  const file = resolve(dir, `${tenant.id}_${stamp}.md`);
  writeFileSync(file, md);

  // 2) Optional real channels (only if configured AND there are leads).
  if (leads.length) {
    if (tenant.channel === "webhook" && process.env.RADAR_WEBHOOK_URL) {
      await postJSON(process.env.RADAR_WEBHOOK_URL, { tenant: tenant.id, count: leads.length, leads, markdown: md });
    }
    if (tenant.channel === "slack" && process.env.SLACK_WEBHOOK_URL) {
      await postJSON(process.env.SLACK_WEBHOOK_URL, { text: md.slice(0, 3500) });
    }
    // email channel: wire Resend/SMTP here (left as env-guarded TODO).
  }
  return { channel: tenant.channel, ref: file };
}

async function postJSON(url: string, body: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    /* delivery best-effort; file channel is the durable record */
  }
}
