// Reinforcement-style ranking (EWMA multi-armed bandit). Learns which arms
// (sources, outreach channels, ICPs, price tiers) yield the best reward from
// real outcomes, and recommends where to lean in. Deterministic — exploration
// uses a seeded hash, not Math.random — so decisions are reproducible/auditable.

export interface Arm {
  value: number; // running expected reward
  n: number; // pulls
}
export type RankTable = Record<string, Arm>;

/** Exponentially-weighted update: value ← (1-α)·value + α·reward. */
export function update(table: RankTable, arm: string, reward: number, alpha = 0.3): RankTable {
  const a = table[arm] ?? { value: 0, n: 0 };
  const value = a.n === 0 ? reward : (1 - alpha) * a.value + alpha * reward;
  table[arm] = { value: Math.round(value * 1000) / 1000, n: a.n + 1 };
  return table;
}

/** Rank arms by learned value (desc). */
export function rank(table: RankTable): { arm: string; value: number; n: number }[] {
  return Object.entries(table)
    .map(([arm, a]) => ({ arm, value: a.value, n: a.n }))
    .sort((x, y) => y.value - x.value);
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) / 0xffffffff;
}

/**
 * Deterministic epsilon-greedy pick. With prob ~epsilon explore (seeded), else
 * exploit the best arm. `seed` makes the choice reproducible (e.g. a cycle id).
 */
export function pick(table: RankTable, arms: string[], epsilon = 0.1, seed = "0"): string {
  if (!arms.length) return "";
  const ranked = rank(table).map((r) => r.arm).filter((a) => arms.includes(a));
  const best = ranked[0] ?? arms[0]!;
  if (hash(seed) < epsilon) return arms[Math.floor(hash(seed + "x") * arms.length) % arms.length]!;
  return best;
}

/** Build a reward (0..1) from an outcome: win + value realized. */
export function rewardOf(outcome: "win" | "loss", normalizedValue = 0): number {
  return outcome === "win" ? Math.min(1, 0.6 + 0.4 * normalizedValue) : 0;
}
