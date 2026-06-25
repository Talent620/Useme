// Per-host rate limiter — keeps a minimum delay between requests to the same
// host so we never hammer a source. Clock is injectable for deterministic tests.

export class RateLimiter {
  private last = new Map<string, number>();
  private minDelayMs: number;
  constructor(minDelayMs: number) {
    this.minDelayMs = Math.max(0, minDelayMs);
  }

  /** Milliseconds the caller should wait before hitting `host` at time `now`. */
  delayFor(host: string, now: number): number {
    const prev = this.last.get(host);
    if (prev == null) return 0;
    return Math.max(0, prev + this.minDelayMs - now);
  }

  /** Record that a request to `host` happened at `now` (call after waiting). */
  record(host: string, now: number): void {
    this.last.set(host, now + this.delayFor(host, now));
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((res) => setTimeout(res, ms));
}
