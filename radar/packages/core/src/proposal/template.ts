// Outreach draft generation. The deterministic template here is what the
// AI agent fills/upgrades at runtime — but the slot logic is pure and tested
// so we never ship an empty or broken message.

import type { Signal } from "../signals/types.ts";

export interface SenderProfile {
  name: string;
  role: string; // "freelancer WordPress", "agencja SEO"
  portfolioUrl?: string;
  signaturePhone?: string;
  /** Short, reusable proof points. */
  proofPoints: string[];
}

export interface ProposalDraft {
  subject: string;
  body: string;
  /** Variables the AI layer should personalize further. */
  personalizationSlots: string[];
}

function firstSentence(text: string): string {
  const s = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return s.length > 160 ? s.slice(0, 157) + "..." : s;
}

/**
 * Build a grounded first-touch proposal from a signal + sender profile.
 * Deterministic: same inputs => same draft. The AI agent receives this as a
 * scaffold plus the full signal to rewrite in the client's tone.
 */
export function buildProposal(signal: Signal, sender: SenderProfile): ProposalDraft {
  const hook = firstSentence(signal.body || signal.title);
  const proof = sender.proofPoints.slice(0, 2).join("; ");
  const langPL = signal.lang === "pl";

  const subject = langPL
    ? `Re: ${signal.title.slice(0, 60)} — mogę pomóc`
    : `Re: ${signal.title.slice(0, 60)} — I can help`;

  const body = langPL
    ? [
        `Dzień dobry,`,
        ``,
        `widzę Twoje ogłoszenie: „${hook}". Zajmuję się tym jako ${sender.role}.`,
        proof ? `W skrócie: ${proof}.` : ``,
        `Mogę przygotować konkretną wycenę i harmonogram w ciągu 24h.`,
        sender.portfolioUrl ? `Portfolio: ${sender.portfolioUrl}` : ``,
        ``,
        `Pozdrawiam,`,
        `${sender.name}`,
        sender.signaturePhone ?? ``,
      ]
    : [
        `Hi,`,
        ``,
        `I saw your post: "${hook}". I do exactly this as a ${sender.role}.`,
        proof ? `In short: ${proof}.` : ``,
        `I can send a concrete quote and timeline within 24h.`,
        sender.portfolioUrl ? `Portfolio: ${sender.portfolioUrl}` : ``,
        ``,
        `Best,`,
        `${sender.name}`,
        sender.signaturePhone ?? ``,
      ];

  return {
    subject,
    body: body.filter((l) => l !== ``).join("\n").replace(/\n{3,}/g, "\n\n"),
    personalizationSlots: ["hook", "proofPoints", "price", "timeline"],
  };
}
