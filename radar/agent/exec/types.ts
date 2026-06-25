// Autonomous execution engine — types. A won lead becomes a Job; the engine
// plans it into tasks, executes each via a capability, self-verifies against
// acceptance criteria, and packages a deliverable with a confidence score.

export type Capability = "writer" | "landing" | "audit" | "spec" | "translate" | "scaffold";

export interface Job {
  id: string;
  title: string;
  brief: string; // the client's request (signal body)
  categories: string[];
  lang: string;
  budget?: number;
}

export type CriterionType =
  | "minWords"
  | "hasSections"
  | "keywordCoverage"
  | "noPlaceholders"
  | "htmlValid"
  | "jsonValid";

export interface AcceptanceCriterion {
  id: string;
  type: CriterionType;
  /** Parameters: e.g. {min: 300} or {sections: [...]} or {keywords: [...]}. */
  params?: Record<string, unknown>;
  weight: number; // contribution to the 0..100 score
}

export interface TaskSpec {
  id: string;
  capability: Capability;
  instruction: string;
  acceptance: AcceptanceCriterion[];
}

export type ArtifactFormat = "md" | "html" | "txt" | "json";

export interface Artifact {
  taskId: string;
  format: ArtifactFormat;
  content: string;
  meta?: Record<string, unknown>;
}

export interface ReviewResult {
  score: number; // 0..100
  passed: boolean;
  issues: string[];
}

export interface TaskOutcome {
  task: TaskSpec;
  artifact: Artifact;
  review: ReviewResult;
  iterations: number;
}

export interface ExecutionReport {
  jobId: string;
  outcomes: TaskOutcome[];
  /** 0..100 — min of task scores (a chain is only as strong as its weakest link). */
  confidence: number;
  /** "auto" = ready to deliver; "review" = needs a human glance. */
  gate: "auto" | "review";
  deliverable: string; // packaged markdown bundle
}
