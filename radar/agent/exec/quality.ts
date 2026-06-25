// Execution-quality self-improvement. Learns from real client outcomes
// (ACCEPTED / REVISION / REJECTED) per capability and tunes the autonomy gate:
// where deliverables get rejected, the system raises its OWN bar — higher
// confidence required + more self-revision before auto-delivering. Pure & tested.

export type ExecOutcome = "ACCEPTED" | "REVISION" | "REJECTED";

export interface QualitySample {
  capability: string;
  outcome: ExecOutcome;
}

export interface CapabilityQuality {
  capability: string;
  n: number;
  accepted: number;
  acceptanceRate: number;
  minConfidence: number; // recommended gate threshold
  maxIterations: number; // recommended self-revision budget
  autoAllowed: boolean; // may auto-deliver (false => always human review)
}

export interface QualityModel {
  byCapability: Record<string, CapabilityQuality>;
  trainedOn: number;
  updatedAt?: string;
}

export interface QualityBase {
  minConfidence: number;
  maxIterations: number;
  minSamples?: number;
  acceptThreshold?: number; // min acceptanceRate to allow auto-delivery
}

const DEFAULTS: Required<QualityBase> = { minConfidence: 80, maxIterations: 3, minSamples: 3, acceptThreshold: 0.6 };

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function trainQualityModel(samples: QualitySample[], base: QualityBase = DEFAULTS, now?: number): QualityModel {
  const b = { ...DEFAULTS, ...base };
  const groups = new Map<string, { accepted: number; n: number }>();
  for (const s of samples) {
    const g = groups.get(s.capability) ?? { accepted: 0, n: 0 };
    g.n += 1;
    if (s.outcome === "ACCEPTED") g.accepted += 1;
    groups.set(s.capability, g);
  }

  const byCapability: Record<string, CapabilityQuality> = {};
  for (const [capability, g] of groups) {
    const acceptanceRate = g.n ? g.accepted / g.n : 1;
    if (g.n < b.minSamples) {
      byCapability[capability] = { capability, n: g.n, accepted: g.accepted, acceptanceRate, minConfidence: b.minConfidence, maxIterations: b.maxIterations, autoAllowed: true };
      continue;
    }
    // The worse the acceptance, the higher we set our own bar.
    const minConfidence = clamp(Math.round(b.minConfidence + (1 - acceptanceRate) * 20), b.minConfidence, 95);
    const maxIterations = b.maxIterations + (acceptanceRate < 0.5 ? 2 : acceptanceRate < 0.8 ? 1 : 0);
    // Even a criteria-perfect deliverable goes to human review if clients keep
    // rejecting this capability (perfect-by-criteria ≠ accepted-by-client).
    const autoAllowed = acceptanceRate >= (b.acceptThreshold ?? 0.6);
    byCapability[capability] = { capability, n: g.n, accepted: g.accepted, acceptanceRate, minConfidence, maxIterations, autoAllowed };
  }

  return { byCapability, trainedOn: samples.length, updatedAt: now != null ? new Date(now).toISOString() : undefined };
}

/** Strictest recommendation across the job's capabilities, floored by base. */
export function gateOpts(
  model: QualityModel | undefined,
  capabilities: string[],
  base: QualityBase = DEFAULTS,
): { minConfidence: number; maxIterations: number; blocked: string[] } {
  const b = { ...DEFAULTS, ...base };
  let minConfidence = b.minConfidence;
  let maxIterations = b.maxIterations;
  const blocked: string[] = [];
  if (model) {
    for (const cap of capabilities) {
      const q = model.byCapability[cap];
      if (q) {
        minConfidence = Math.max(minConfidence, q.minConfidence);
        maxIterations = Math.max(maxIterations, q.maxIterations);
        if (!q.autoAllowed) blocked.push(cap);
      }
    }
  }
  return { minConfidence, maxIterations, blocked };
}
