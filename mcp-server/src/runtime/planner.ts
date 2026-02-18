import { randomUUID } from "node:crypto";
import type { RunCreateInput, PlannedRun, PlannedNode } from "../types.ts";
import { SmartSpawnClient } from "../smart-spawn-client.ts";

function makeNodeId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function fallbackModel(): string {
  return "openai/gpt-4o-mini";
}

function fallbackPremiumModel(): string {
  return "anthropic/claude-sonnet-4";
}

function fallbackCollectiveModels(count: number): string[] {
  const base = [
    "openai/gpt-4o-mini",
    "anthropic/claude-sonnet-4",
    "google/gemini-2.5-pro",
    "openai/gpt-4o",
    "meta-llama/llama-3.3-70b-instruct",
  ];
  return base.slice(0, Math.max(1, Math.min(count, base.length)));
}

function splitTaskFallback(task: string): string[] {
  const numbered = task
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+[.)]\s+/.test(line))
    .map((line) => line.replace(/^\d+[.)]\s+/, "").trim())
    .filter(Boolean);
  if (numbered.length > 0) return numbered;

  const bullet = task
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
  if (bullet.length > 0) return bullet;

  const byAnd = task
    .split(/\s+(?:and then|then|and)\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 8);
  if (byAnd.length > 1) return byAnd.slice(0, 6);

  return [task.trim()];
}

export async function buildRunPlan(
  input: RunCreateInput,
  smartSpawn: SmartSpawnClient
): Promise<PlannedRun> {
  switch (input.mode) {
    case "single":
      return buildSinglePlan(input, smartSpawn);
    case "collective":
      return buildCollectivePlan(input, smartSpawn);
    case "cascade":
      return buildCascadePlan(input, smartSpawn);
    case "plan":
      return buildSequentialPlan(input, smartSpawn);
    case "swarm":
      return buildSwarmPlan(input, smartSpawn);
    default:
      return buildSinglePlan(input, smartSpawn);
  }
}

export async function buildSinglePlan(
  input: RunCreateInput,
  smartSpawn?: SmartSpawnClient
): Promise<PlannedRun> {
  let planningSource: "api" | "fallback" = smartSpawn ? "api" : "fallback";
  let picked = { modelId: fallbackModel(), reason: "Fallback single model" };
  if (smartSpawn) {
    try {
      picked = await smartSpawn.pick({
        task: input.task,
        budget: input.budget,
        context: input.context,
      });
    } catch {
      planningSource = "fallback";
      picked = {
        modelId: fallbackModel(),
        reason: "Fallback single model (Smart Spawn API unavailable)",
      };
    }
  }

  let prompt = input.task;
  if (smartSpawn) {
    try {
      prompt = await smartSpawn.composeRole(input.task, input.role);
    } catch {
      prompt = input.task;
    }
  }

  const node: PlannedNode = {
    id: makeNodeId("node"),
    kind: "task",
    wave: 0,
    dependsOn: [],
    task: input.task,
    model: picked.modelId,
    prompt,
    meta: { reason: picked.reason, mode: "single", planningSource },
  };

  return {
    plannerSummary: `single plan with model ${picked.modelId}`,
    nodes: [node],
  };
}

async function buildCollectivePlan(
  input: RunCreateInput,
  smartSpawn: SmartSpawnClient
): Promise<PlannedRun> {
  const count = Math.max(2, Math.min(input.collectiveCount ?? 3, 5));
  let picks: Array<{ modelId: string; reason: string }> = [];
  let planningSource: "api" | "fallback" = "api";
  try {
    picks = await smartSpawn.recommend({
      task: input.task,
      budget: input.budget,
      count,
      context: input.context,
    });
  } catch {
    planningSource = "fallback";
    picks = fallbackCollectiveModels(count).map((modelId) => ({
      modelId,
      reason: "Fallback recommendation (Smart Spawn API unavailable)",
    }));
  }

  let prompt = input.task;
  try {
    prompt = await smartSpawn.composeRole(input.task, input.role);
  } catch {
    prompt = input.task;
  }
  const taskNodes: PlannedNode[] = picks.map((p, idx) => ({
    id: makeNodeId(`collective-${idx + 1}`),
    kind: "task",
    wave: 0,
    dependsOn: [],
    task: input.task,
    model: p.modelId,
    prompt,
    meta: { reason: p.reason, mode: "collective", planningSource },
  }));

  if (taskNodes.length === 0) {
    return buildSinglePlan(input, smartSpawn);
  }

  const mergeNode: PlannedNode = {
    id: "merged",
    kind: "merge",
    wave: 1,
    dependsOn: taskNodes.map((n) => n.id),
    task: input.task,
    model: input.merge?.model ?? taskNodes[0]?.model ?? fallbackModel(),
    prompt: "",
    meta: {
      mode: "collective",
      mergeStyle: input.merge?.style ?? "detailed",
      planningSource,
    },
  };

  return {
    plannerSummary: `collective plan with ${taskNodes.length} worker nodes`,
    nodes: [...taskNodes, mergeNode],
  };
}

async function buildCascadePlan(
  input: RunCreateInput,
  smartSpawn: SmartSpawnClient
): Promise<PlannedRun> {
  let planningSource: "api" | "fallback" = "api";
  let cheap: { modelId: string; reason: string };
  let premium: { modelId: string; reason: string };
  try {
    cheap = await smartSpawn.pick({
      task: input.task,
      budget: "low",
      context: input.context,
    });

    premium = await smartSpawn.pick({
      task: input.task,
      budget: input.budget === "high" ? "high" : "medium",
      context: input.context,
      exclude: [cheap.modelId],
    });
  } catch {
    planningSource = "fallback";
    cheap = {
      modelId: fallbackModel(),
      reason: "Fallback cheap model (Smart Spawn API unavailable)",
    };
    premium = {
      modelId: fallbackPremiumModel(),
      reason: "Fallback premium model (Smart Spawn API unavailable)",
    };
  }

  let prompt = input.task;
  try {
    prompt = await smartSpawn.composeRole(input.task, input.role);
  } catch {
    prompt = input.task;
  }
  const cheapNode: PlannedNode = {
    id: makeNodeId("cascade-cheap"),
    kind: "task",
    wave: 0,
    dependsOn: [],
    task: input.task,
    model: cheap.modelId,
    prompt,
    meta: { mode: "cascade", tier: "cheap", reason: cheap.reason, planningSource },
  };

  const premiumNode: PlannedNode = {
    id: makeNodeId("cascade-premium"),
    kind: "task",
    wave: 1,
    dependsOn: [cheapNode.id],
    task: input.task,
    model: premium.modelId,
    prompt,
    meta: { mode: "cascade", tier: "premium", reason: premium.reason, conditional: true, planningSource },
  };

  const mergeNode: PlannedNode = {
    id: "merged",
    kind: "merge",
    wave: 2,
    dependsOn: [cheapNode.id, premiumNode.id],
    task: input.task,
    model: input.merge?.model ?? premium.modelId,
    prompt: "",
    meta: { mode: "cascade", mergeStyle: input.merge?.style ?? "decision", planningSource },
  };

  return {
    plannerSummary: "cascade plan with cheap and premium fallback",
    nodes: [cheapNode, premiumNode, mergeNode],
  };
}

async function buildSequentialPlan(
  input: RunCreateInput,
  smartSpawn: SmartSpawnClient
): Promise<PlannedRun> {
  let planningSource: "api" | "fallback" = "api";
  let steps: Array<{ id: string; task: string; modelId: string; wave: number; dependsOn: string[]; reason: string }> = [];
  try {
    const result = await smartSpawn.decompose({
      task: input.task,
      budget: input.budget,
      context: input.context,
    });
    if (result.decomposed && result.steps.length > 0) {
      steps = result.steps;
    }
  } catch {
    // fall through to fallback steps
  }

  if (steps.length === 0) {
    planningSource = "fallback";
    const split = splitTaskFallback(input.task);
    if (split.length <= 1) {
      return buildSinglePlan(input, smartSpawn);
    }
    steps = split.map((task, idx) => ({
      id: `step-${idx + 1}`,
      task,
      modelId: idx === split.length - 1 ? fallbackPremiumModel() : fallbackModel(),
      wave: idx,
      dependsOn: idx === 0 ? [] : [`step-${idx}`],
      reason: "Fallback decomposition (Smart Spawn API unavailable)",
    }));
  }

  const nodes: PlannedNode[] = [];
  for (const step of steps) {
    let prompt = step.task;
    try {
      prompt = await smartSpawn.composeRole(step.task, input.role);
    } catch {
      prompt = step.task;
    }
    nodes.push({
      id: step.id,
      kind: "task",
      wave: step.wave,
      dependsOn: step.dependsOn,
      task: step.task,
      model: step.modelId,
      prompt,
      meta: { mode: "plan", reason: step.reason, planningSource },
    });
  }

  const mergeNode: PlannedNode = {
    id: "merged",
    kind: "merge",
    wave: Math.max(...nodes.map((n) => n.wave)) + 1,
    dependsOn: nodes.map((n) => n.id),
    task: input.task,
    model: input.merge?.model ?? nodes[nodes.length - 1]?.model ?? fallbackModel(),
    prompt: "",
    meta: { mode: "plan", mergeStyle: input.merge?.style ?? "detailed", planningSource },
  };

  return {
    plannerSummary: `plan mode with ${nodes.length} sequential nodes`,
    nodes: [...nodes, mergeNode],
  };
}

async function buildSwarmPlan(
  input: RunCreateInput,
  smartSpawn: SmartSpawnClient
): Promise<PlannedRun> {
  let planningSource: "api" | "fallback" = "api";
  let tasks: Array<{ id: string; task: string; modelId: string; wave: number; dependsOn: string[]; reason: string }> = [];
  try {
    const result = await smartSpawn.swarm({
      task: input.task,
      budget: input.budget,
      context: input.context,
      maxParallel: 5,
    });
    if (result.decomposed && result.tasks.length > 0) {
      tasks = result.tasks;
    }
  } catch {
    // fall through to fallback tasks
  }

  if (tasks.length === 0) {
    planningSource = "fallback";
    const split = splitTaskFallback(input.task);
    if (split.length <= 1) {
      return buildSinglePlan(input, smartSpawn);
    }
    if (split.length === 2) {
      tasks = split.map((task, idx) => ({
        id: `swarm-${idx + 1}`,
        task,
        modelId: fallbackModel(),
        wave: idx,
        dependsOn: idx === 0 ? [] : ["swarm-1"],
        reason: "Fallback swarm decomposition (Smart Spawn API unavailable)",
      }));
    } else {
      const lastIdx = split.length - 1;
      tasks = split.map((task, idx) => ({
        id: `swarm-${idx + 1}`,
        task,
        modelId: idx === lastIdx ? fallbackPremiumModel() : fallbackModel(),
        wave: idx === lastIdx ? 1 : 0,
        dependsOn: idx === lastIdx ? split.slice(0, lastIdx).map((_, i) => `swarm-${i + 1}`) : [],
        reason: "Fallback swarm decomposition (Smart Spawn API unavailable)",
      }));
    }
  }

  const nodes: PlannedNode[] = [];
  for (const t of tasks) {
    let prompt = t.task;
    try {
      prompt = await smartSpawn.composeRole(t.task, input.role);
    } catch {
      prompt = t.task;
    }
    nodes.push({
      id: t.id,
      kind: "task",
      wave: t.wave,
      dependsOn: t.dependsOn,
      task: t.task,
      model: t.modelId,
      prompt,
      meta: { mode: "swarm", reason: t.reason, planningSource },
    });
  }

  const mergeNode: PlannedNode = {
    id: "merged",
    kind: "merge",
    wave: Math.max(...nodes.map((n) => n.wave)) + 1,
    dependsOn: nodes.map((n) => n.id),
    task: input.task,
    model: input.merge?.model ?? nodes[0]?.model ?? fallbackModel(),
    prompt: "",
    meta: { mode: "swarm", mergeStyle: input.merge?.style ?? "detailed", planningSource },
  };

  return {
    plannerSummary: `swarm mode with ${nodes.length} nodes`,
    nodes: [...nodes, mergeNode],
  };
}
