// Long-term memory — the data moat. Persists outcomes, client/industry/ICP
// profiles, and win/loss history across runs so every other module (pricing,
// ranking, agents, strategy) can learn from accumulated reality. Deterministic,
// file-backed, dependency-free. Separate from the operational Store so it can be
// reasoned about and exported on its own.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface DealOutcome {
  tenantId: string;
  category: string;
  source: string;
  channel: string; // outreach channel used
  industry?: string;
  budget?: number;
  price?: number; // what we billed / bid
  outcome: "win" | "loss";
  at: string;
}

export interface NegotiationStep {
  leadId: string;
  from: "us" | "client";
  price?: number;
  note?: string;
  at: string;
}

interface MemDb {
  deals: DealOutcome[];
  negotiations: NegotiationStep[];
  clients: Record<string, { industries: string[]; deals: number; lastSeen: string }>;
}

const EMPTY: MemDb = { deals: [], negotiations: [], clients: {} };

export class Memory {
  private db: MemDb;
  private path: string;
  constructor(path: string) {
    this.path = path;
    this.db = existsSync(path) ? { ...EMPTY, ...JSON.parse(readFileSync(path, "utf8")) } : structuredClone(EMPTY);
  }

  recordDeal(d: DealOutcome) {
    this.db.deals.push(d);
    const c = this.db.clients[d.tenantId] ?? { industries: [], deals: 0, lastSeen: d.at };
    c.deals += 1;
    c.lastSeen = d.at;
    if (d.industry && !c.industries.includes(d.industry)) c.industries.push(d.industry);
    this.db.clients[d.tenantId] = c;
    this.save();
  }

  recordNegotiation(s: NegotiationStep) {
    this.db.negotiations.push(s);
    this.save();
  }

  /** Win rate over deals matching a filter (any subset of fields). */
  winRate(filter: Partial<Pick<DealOutcome, "category" | "source" | "channel" | "industry">> = {}): { rate: number; n: number; wins: number } {
    const m = this.db.deals.filter((d) => Object.entries(filter).every(([k, v]) => (d as Record<string, unknown>)[k] === v));
    const wins = m.filter((d) => d.outcome === "win").length;
    return { rate: m.length ? wins / m.length : 0, n: m.length, wins };
  }

  /** Average winning price for a category (for pricing recommendations). */
  avgWinPrice(category: string): number | undefined {
    const wins = this.db.deals.filter((d) => d.category === category && d.outcome === "win" && d.price);
    if (!wins.length) return undefined;
    return Math.round(wins.reduce((s, d) => s + (d.price ?? 0), 0) / wins.length);
  }

  industryProfile(industry: string) {
    const m = this.db.deals.filter((d) => d.industry === industry);
    const wins = m.filter((d) => d.outcome === "win");
    const budgets = m.map((d) => d.budget ?? 0).filter(Boolean);
    return {
      industry,
      deals: m.length,
      winRate: m.length ? wins.length / m.length : 0,
      avgBudget: budgets.length ? Math.round(budgets.reduce((s, b) => s + b, 0) / budgets.length) : 0,
    };
  }

  clientProfile(tenantId: string) {
    return this.db.clients[tenantId] ?? { industries: [], deals: 0, lastSeen: "" };
  }

  stats() {
    const wins = this.db.deals.filter((d) => d.outcome === "win").length;
    return {
      deals: this.db.deals.length,
      wins,
      winRate: this.db.deals.length ? wins / this.db.deals.length : 0,
      clients: Object.keys(this.db.clients).length,
      negotiations: this.db.negotiations.length,
    };
  }

  /** Distinct categories/sources/channels seen — the "arms" for ranking. */
  arms() {
    const cat = new Set<string>(), src = new Set<string>(), ch = new Set<string>();
    for (const d of this.db.deals) { cat.add(d.category); src.add(d.source); ch.add(d.channel); }
    return { categories: [...cat], sources: [...src], channels: [...ch] };
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.db, null, 2));
  }
}
