// Execution engine. Orchestrates the multi-agent loop: plan (planner) → execute
// (capability) → verify (critic) → revise until criteria pass or budget runs
// out. Produces a packaged deliverable + a confidence-gated autonomy decision.

import { runCapability, type ExecCtx } from "./capabilities.ts";
import { review } from "./critic.ts";
import { planJob } from "./planner.ts";
import { gather } from "./orchestrator.ts";
import type { ExecutionReport, Job, TaskOutcome } from "./types.ts";

export interface ExecuteOptions {
  maxIterations?: number; // self-revision budget per task
  minConfidence?: number; // gate threshold for autonomous delivery
}

export async function executeJob(job: Job, opts: ExecuteOptions = {}): Promise<ExecutionReport> {
  const maxIterations = opts.maxIterations ?? 3;
  const minConfidence = opts.minConfidence ?? 80;
  const tasks = planJob(job);
  const outcomes: TaskOutcome[] = [];

  for (const task of tasks) {
    // Orchestrator composes the tools this task needs (research/seo/image…).
    const bundle = await gather(job, task.capability);
    const ctx: ExecCtx = { depth: 1, hints: [], bundle };
    let best: TaskOutcome | null = null;

    for (let i = 1; i <= maxIterations; i++) {
      const artifact = await runCapability(task, job, ctx);
      const r = review(artifact, task.acceptance);
      if (!best || r.score > best.review.score) {
        best = { task, artifact, review: r, iterations: i };
      }
      if (r.passed) break;
      // Revise: feed the critic's issues back and increase depth.
      ctx.depth += 1;
      ctx.hints = r.issues;
    }
    outcomes.push(best!);
  }

  const confidence = Math.min(...outcomes.map((o) => o.review.score));
  const gate: "auto" | "review" = confidence >= minConfidence && outcomes.every((o) => o.review.passed) ? "auto" : "review";

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
