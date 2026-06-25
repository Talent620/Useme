// Autonomous CRM. Deterministic pipeline + follow-up sequencing: leads that were
// contacted but went quiet get scheduled, cadence-based follow-ups (with ready
// message templates), up to a max-attempts cap. Drives nurturing/upsell without
// any external CRM. Pure functions over lead snapshots.

export type Stage = "nowy" | "kontakt" | "rozmowa" | "wygrany" | "realizacja" | "stracony";

export interface CrmLead {
  id: string;
  status: string; // NEW/SENT/REPLIED/WON/REJECTED
  outreachStatus?: string; // none/queued/approved/sent/skipped
  sentAt?: string;
  followUps?: number;
  title?: string;
}

/** Map operational status to a human pipeline stage. */
export function stageOf(l: CrmLead): Stage {
  if (l.status === "WON") return "wygrany";
  if (l.status === "REJECTED") return "stracony";
  if (l.status === "REPLIED") return "rozmowa";
  if (l.outreachStatus === "sent" || l.status === "SENT") return "kontakt";
  return "nowy";
}

export function pipeline(leads: CrmLead[]): Record<Stage, number> {
  const p: Record<Stage, number> = { nowy: 0, kontakt: 0, rozmowa: 0, wygrany: 0, realizacja: 0, stracony: 0 };
  for (const l of leads) p[stageOf(l)]++;
  return p;
}

export interface FollowUp {
  leadId: string;
  attempt: number;
  message: string;
}

const SEQUENCE: ((title: string) => string)[] = [
  (t) => `Dzień dobry, wracam do tematu „${t}". Czy mogę przygotować konkretną wycenę i harmonogram?`,
  (t) => `Krótkie przypomnienie ws. „${t}". Mam wolny termin w tym tygodniu — chętnie pomogę.`,
  (t) => `Ostatnia wiadomość ws. „${t}". Jeśli to nieaktualne, daj proszę znać — nie chcę zawracać głowy.`,
];

export function sequenceMessage(attempt: number, title = "Twoje zlecenie"): string {
  return SEQUENCE[Math.min(attempt, SEQUENCE.length - 1)]!(title);
}

const DAY = 86_400_000;

/**
 * Which contacted-but-silent leads are due for a follow-up now.
 * A lead qualifies if it was sent, isn't won/lost/replied, the cadence has
 * elapsed since `sentAt`, and we're under maxAttempts.
 */
export function dueFollowUps(leads: CrmLead[], nowMs: number, cadenceDays = 3, maxAttempts = 3): FollowUp[] {
  const out: FollowUp[] = [];
  for (const l of leads) {
    const sent = l.outreachStatus === "sent" || l.status === "SENT";
    if (!sent || l.status === "WON" || l.status === "REJECTED" || l.status === "REPLIED") continue;
    const attempts = l.followUps ?? 0;
    if (attempts >= maxAttempts) continue;
    const since = l.sentAt ? (nowMs - Date.parse(l.sentAt)) / DAY : Infinity;
    if (since >= cadenceDays * (attempts + 1)) {
      out.push({ leadId: l.id, attempt: attempts + 1, message: sequenceMessage(attempts, l.title) });
    }
  }
  return out;
}
