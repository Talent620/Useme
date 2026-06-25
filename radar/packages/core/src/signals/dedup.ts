// Deterministic deduplication of raw signals across sources and runs.

/** Normalize text for hashing: lowercase, strip punctuation, collapse spaces. */
export function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, "l") // ł is a distinct letter, NFKD won't decompose it
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Small, dependency-free 32-bit FNV-1a hash, hex-encoded. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Build a stable dedupe key. Same job re-posted (or mirrored across boards)
 * collapses to one key. We hash the normalized title + a budget bucket so
 * minor body edits don't create duplicates, but distinct jobs stay distinct.
 */
export function dedupeKey(title: string, budget?: number): string {
  const t = normalizeForHash(title).split(" ").slice(0, 12).join(" ");
  const bucket = budget ? Math.round(budget / 250) : 0; // 250 PLN buckets
  return fnv1a(`${t}|${bucket}`);
}

/** Remove duplicates from a batch, keeping the earliest-published instance. */
export function dedupe<T extends { dedupeKey: string; publishedAt: string }>(
  items: T[],
): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const existing = byKey.get(item.dedupeKey);
    if (!existing || item.publishedAt < existing.publishedAt) {
      byKey.set(item.dedupeKey, item);
    }
  }
  return [...byKey.values()];
}
