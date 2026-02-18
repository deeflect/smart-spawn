export type RunMode = "single" | "collective" | "cascade" | "plan" | "swarm";
export type Budget = "low" | "medium" | "high" | "any";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "canceled";
export type NodeStatus = "queued" | "running" | "completed" | "failed" | "canceled" | "skipped";
export type NodeKind = "task" | "merge";

export interface RoleConfig {
  persona?: string;
  stack?: string[];
  domain?: string;
  format?: string;
  guardrails?: string[];
}

export interface MergeConfig {
  style?: "concise" | "detailed" | "decision";
  model?: string;
}

export interface RunCreateInput {
  task: string;
  mode: RunMode;
  budget?: Budget;
  context?: string;
  collectiveCount?: number;
  role?: RoleConfig;
  merge?: MergeConfig;
}

export interface RunRecord {
  id: string;
  task: string;
  mode: RunMode;
  budget: Budget;
  context: string | null;
  paramsJson: string;
  status: RunStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface NodeRecord {
  id: string;
  runId: string;
  kind: NodeKind;
  wave: number;
  dependsOnJson: string;
  task: string;
  model: string;
  prompt: string;
  metaJson: string;
  status: NodeStatus;
  retryCount: number;
  maxRetries: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  tokensPrompt: number;
  tokensCompletion: number;
  costUsd: number;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  nodeId: string;
  type: "raw" | "merged" | "plan" | "log";
  path: string;
  bytes: number;
  sha256: string;
  createdAt: string;
}

export interface PlannedNode {
  id: string;
  kind: NodeKind;
  wave: number;
  dependsOn: string[];
  task: string;
  model: string;
  prompt: string;
  meta?: Record<string, unknown>;
  maxRetries?: number;
}

export interface PlannedRun {
  nodes: PlannedNode[];
  plannerSummary: string;
}

export interface OpenRouterExecutionResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface RunProgress {
  totalNodes: number;
  doneNodes: number;
  runningNodes: number;
  failedNodes: number;
  percent: number;
}
