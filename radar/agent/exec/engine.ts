// Execution engine. Orchestrates the multi-agent loop: plan (planner) → execute
// (capability) → verify (critic) → revise until criteria pass or budget runs
// out. Produces a packaged deliverable + a confidence-gated autonomy decision.

import { runCapability, type ExecCtx } from "./capabilities.ts";
import { review } from "./critic.ts";
import { planJob } from "./planner.ts";
import { gather } from "./orchestrator.ts";
import { gateOpts, type QualityModel } from "./quality.ts";
import { repair } from "./refine.ts";
import type { ExecutionReport, Job, TaskOutcome } from "./types.ts";

export interface ExecuteOptions {
  maxIterations?: number; // total generation budget per task
  minConfidence?: number; // gate threshold for autonomous delivery
  quality?: QualityModel; // learned per-capability quality calibration
  candidates?: number; // best-of-N initial drafts (tournament)
  targetScore?: number; // keep refining until reached (default 100)
}

export async function executeJob(job: Job, opts: ExecuteOptions = {}): Promise<ExecutionReport> {
  const tasks = planJob(job);
  // Self-calibrated autonomy: raise the bar / block auto where clients reject.
  const adj = gateOpts(opts.quality, tasks.map((t) => t.capability), {
    minConfidence: opts.minConfidence ?? 80,
    maxIterations: opts.maxIterations ?? 4,
  });
  const maxIterations = adj.maxIterations;
  const minConfidence = adj.minConfidence;
  const targetScore = opts.targetScore ?? 100;
  const candidates = Math.max(1, Math.min(opts.candidates ?? 2, maxIterations));
  const outcomes: TaskOutcome[] = [];

  for (const task of tasks) {
    const bundle = await gather(job, task.capability);
    let best: TaskOutcome | null = null;
    let used = 0;

    // 1) Best-of-N: generate diverse candidates (vary depth), keep the strongest.
    for (let c = 1; c <= candidates; c++) {
      used++;
      const artifact = await runCapability(task, job, { depth: c, hints: [], bundle });
      const r = review(artifact, task.acceptance);
      if (!best || r.score > best.review.score) best = { task, artifact, review: r, iterations: used };
    }

    // 2) Refine toward perfection: feed all critic issues back until target hit.
    while (best!.review.score < targetScore && used < maxIterations) {
      used++;
      const artifact = await runCapability(task, job, { depth: used + 1, hints: best!.review.issues, bundle });
      const r = review(artifact, task.acceptance);
      if (r.score > best!.review.score) best = { task, artifact, review: r, iterations: used };
    }

    // 3) Deterministic repair: guarantee every measurable criterion is satisfied.
    // (Skip when the executor explicitly escalated — e.g. translation needs an LLM.)
    const escalated = best!.artifact.meta?.engine === "escalate";
    if (!escalated && best!.review.score < targetScore) {
      const repaired = repair(best!.artifact, task.acceptance, job);
      const rr = review(repaired, task.acceptance);
      if (rr.score >= best!.review.score) best = { task, artifact: repaired, review: rr, iterations: used + 1 };
    }
    outcomes.push(best!);
  }

  const confidence = Math.min(...outcomes.map((o) => o.review.score));
  const allowed = adj.blocked.length === 0;
  const noEscalation = outcomes.every((o) => o.artifact.meta?.engine !== "escalate");
  const gate: "auto" | "review" = confidence >= minConfidence && outcomes.every((o) => o.review.passed) && allowed && noEscalation ? "auto" : "review";

  return { jobId: job.id, outcomes, confidence, gate, deliverable: packageDeliverable(job, outcomes) };
}

function packageDeliverable(job: Job, outcomes: TaskOutcome[]): string {
  const parts: string[] = [];
  parts.push(`# Dostarczenie: ${job.title}`);
  parts.push(`> Zlecenie: ${job.brief}`);
  parts.push("");
  for (const o of outcomes) {
    parts.push(`## Rezultat (${o.task.capability}) — jakość ${o.review.score}/100`);
    if (o.artifact.format === "html") {
      parts.push("```html");
      parts.push(o.artifact.content);
      parts.push("```");
    } else {
      parts.push(o.artifact.content);
    }
    if (o.review.issues.length) {
      parts.push("");
      parts.push(`_Uwagi QA: ${o.review.issues.join("; ")}_`);
    }
    parts.push("");
  }
  return parts.join("\n");
}

/** Build a Job from a stored won lead (title + brief from the signal). */
export function jobFromLead(lead: { id: string; signalTitle: string; signalUrl: string; signalBudget?: number; matchedKeywords: string[] }, brief: string, categories: string[], lang: string): Job {
  return {
    id: lead.id,
    title: lead.signalTitle,
    brief: brief || lead.signalTitle,
    categories,
    lang,
    budget: lead.signalBudget,
  };
}
