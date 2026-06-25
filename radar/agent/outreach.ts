// Outreach sender. Takes an APPROVED lead and ships the message via the
// tenant's channel. Default channel is "manual" (file) — the message lands in
// data/outbox/ for you to paste on the platform — because mass unsolicited
// sending is a compliance/deliverability risk. Real channels (webhook/slack/
// email) are env-guarded and opt-in.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, type TenantDef } from "./config.ts";
import type { StoredLead } from "./store.ts";

const COMPLIANCE_PL =
  "\n\n—\nWiadomość wysłana w odpowiedzi na publiczne ogłoszenie. Jeśli to pomyłka, odpisz STOP.";

export interface SendResult {
  via: string;
  ref: string;
  ok: boolean;
}

function outboxDir(): string {
  return resolve(process.env.RADAR_DATA_DIR ?? resolve(ROOT, "data"), "outbox");
}

export async function sendOutreach(
  tenant: TenantDef,
  lead: StoredLead,
  now: string,
): Promise<SendResult> {
  const subject = lead.draftSubject ?? `Re: ${lead.signalTitle}`;
  const body = (lead.draftBody ?? "") + COMPLIANCE_PL;
  const channel = tenant.channel;

  // Real channels — only if explicitly configured.
  if (channel === "webhook" && process.env.RADAR_WEBHOOK_URL) {
    const ok = await postJSON(process.env.RADAR_WEBHOOK_URL, {
      tenant: tenant.id, leadId: lead.id, to: lead.signalUrl, subject, body,
    });
    return { via: "webhook", ref: process.env.RADAR_WEBHOOK_URL, ok };
  }
  if (channel === "slack" && process.env.SLACK_WEBHOOK_URL) {
    const ok = await postJSON(process.env.SLACK_WEBHOOK_URL, {
      text: `*${subject}*\n${body}\n<${lead.signalUrl}>`,
    });
    return { via: "slack", ref: "slack", ok };
  }
  if (channel === "email" && process.env.RESEND_API_KEY && tenant.email) {
    const ok = await sendEmail(tenant.email, subject, body);
    return { via: "email", ref: tenant.email, ok };
  }

  // Default: manual outbox file (durable, you paste it on the platform).
  const dir = outboxDir();
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${tenant.id}_${lead.id}.txt`);
  writeFileSync(
    file,
    `# DO WYSŁANIA — ${tenant.name}\n# Ogłoszenie: ${lead.signalUrl}\n# Score: ${lead.score}/100  ·  ${now}\n\nTemat: ${subject}\n\n${body}\n`,
  );
  return { via: "manual", ref: file, ok: true };
}

async function postJSON(url: string, body: unknown): Promise<boolean> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? "RadarPL <onboarding@resend.dev>",
        to,
        subject,
        text,
      }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
