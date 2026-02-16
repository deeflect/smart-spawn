import { Hono } from "hono";
import { pipeline } from "../enrichment/pipeline.ts";
import { dbGetContextScoreBatch, dbGetCommunityScoreBatch } from "../db.ts";
import type { Budget, Category } from "../types.ts";
import { BUDGET_THRESHOLDS } from "../types.ts";
import { blendScore } from "../scoring-utils.ts";
import { computeContextBoost, parseContextTags } from "../context-signals.ts";
import { splitTask } from "../task-splitter.ts";
import type { SplitMethod } from "../task-splitter.ts";

export const swarmRoute = new Hono();

// --- Persona auto-mapping ---

interface PersonaRule {
  keywords: string[];
  persona: string;
  priority: number;
}

const PERSONA_RULES: PersonaRule[] = [
  { keywords: ["frontend", "react", "vue", "css", "ui", "ux", "tailwind", "svelte", "angular"], persona: "frontend-engineer", priority: 10 },
  { keywords: ["backend", "api", "server", "endpoint", "rest", "graphql", "microservice"], persona: "backend-engineer", priority: 10 },
  { keywords: ["database", "schema", "sql", "postgres", "mysql", "mongo", "migration", "orm"], persona: "database-architect", priority: 10 },
  { keywords: ["deploy", "docker", "ci", "cd", "pipeline", "kubernetes", "k8s", "aws", "gcp", "azure", "infrastructure", "terraform"], persona: "devops-engineer", priority: 10 },
  { keywords: ["security", "auth", "authentication", "authorization", "oauth", "jwt", "encrypt", "vulnerability"], persona: "security-engineer", priority: 10 },
  { keywords: ["test", "spec", "unit test", "integration test", "e2e", "coverage", "jest", "vitest", "pytest"], persona: "software-engineer", priority: 8 },
  { keywords: ["docs", "documentation", "guide", "readme", "tutorial", "manual", "wiki"], persona: "technical-writer", priority: 8 },
];

const CATEGORY_PERSONA_FALLBACK: Record<string, string> = {
  coding: "software-engineer",
  research: "analyst",
  creative: "writer",
  reasoning: "analyst",
  general: "software-engineer",
  "fast-cheap": "software-engineer",
  vision: "analyst",
};

function assignPersona(taskText: string, category: Category): string {
  const lower = taskText.toLowerCase();
  let bestPersona = CATEGORY_PERSONA_FALLBACK[category] ?? "software-engineer";
  let bestPriority = 0;
  let bestMatchCount = 0;

  for (const rule of PERSONA_RULES) {
    const matchCount = rule.keywords.filter((kw) => lower.includes(kw)).length;
    if (matchCount > 0 && (rule.priority > bestPriority || (rule.priority === bestPriority && matchCount > bestMatchCount))) {
      bestPersona = rule.persona;
      bestPriority = rule.priority;
      bestMatchCount = matchCount;
    }
  }

  return bestPersona;
}

// --- Dependency detection ---

// Phase keywords: lower phase = earlier in pipeline
const PHASE_KEYWORDS: { keywords: string[]; phase: number }[] = [
  { keywords: ["design", "plan", "architect", "schema", "spec", "define", "model", "structure"], phase: 0 },
  { keywords: ["set up", "setup", "configure", "scaffold", "initialize", "bootstrap"], phase: 1 },
  { keywords: ["implement", "build", "create", "develop", "code", "write"], phase: 2 },
  { keywords: ["integrate", "connect", "wire", "hook up", "combine"], phase: 3 },
  { keywords: ["test", "spec", "verify", "validate", "check", "qa"], phase: 4 },
  { keywords: ["deploy", "release", "publish", "ship", "docs", "document", "documentation"], phase: 5 },
];

// Artifact categories for cross-reference detection
const ARTIFACT_PATTERNS: { produces: RegExp; category: string }[] = [
  { produces: /\b(?:schema|model|data\s*model|entity|table)\b/i, category: "schema" },
  { produces: /\b(?:api|endpoint|route|rest|graphql)\b/i, category: "api" },
  { produces: /\b(?:component|widget|page|view|layout|ui)\b/i, category: "component" },
  { produces: /\b(?:config|configuration|settings|env|environment)\b/i, category: "config" },
  { produces: /\b(?:test|spec|fixture|mock)\b/i, category: "test" },
  { produces: /\b(?:docs|documentation|readme|guide)\b/i, category: "docs" },
];

interface SwarmTask {
  id: string;
  description: string;
  category: Category;
  budget: Budget;
  persona: string;
  dependsOn: string[];
  phase: number;
  artifacts: string[]; // artifact categories this task produces/mentions
}

interface Edge {
  from: string;
  to: string;
  type: "phase" | "artifact" | "temporal";
}

function detectPhase(text: string): number {
  const lower = text.toLowerCase();
  let bestPhase = 2; // default: implementation phase
  let bestMatchCount = 0;

  for (const entry of PHASE_KEYWORDS) {
    const matchCount = entry.keywords.filter((kw) => lower.includes(kw)).length;
    if (matchCount > bestMatchCount) {
      bestPhase = entry.phase;
      bestMatchCount = matchCount;
    }
  }

  return bestPhase;
}

function detectArtifacts(text: string): string[] {
  const artifacts: string[] = [];
  for (const pattern of ARTIFACT_PATTERNS) {
    if (pattern.produces.test(text)) {
      artifacts.push(pattern.category);
    }
  }
  return artifacts;
}

function buildDependencyEdges(tasks: SwarmTask[], method: SplitMethod): Edge[] {
  const edges: Edge[] = [];
  const edgeSet = new Set<string>();

  const addEdge = (from: string, to: string, type: Edge["type"]) => {
    const key = `${from}->${to}`;
    if (!edgeSet.has(key) && from !== to) {
      edgeSet.add(key);
      edges.push({ from, to, type });
    }
  };

  // Layer 1: Phase-based dependencies
  // Group tasks by phase, earlier phases become dependencies for later ones
  const phaseGroups = new Map<number, SwarmTask[]>();
  for (const t of tasks) {
    const group = phaseGroups.get(t.phase) || [];
    group.push(t);
    phaseGroups.set(t.phase, group);
  }

  const sortedPhases = [...phaseGroups.keys()].sort((a, b) => a - b);
  for (let i = 1; i < sortedPhases.length; i++) {
    const prevPhase = phaseGroups.get(sortedPhases[i - 1])!;
    const currPhase = phaseGroups.get(sortedPhases[i])!;
    // Each task in current phase depends on all tasks in previous phase
    for (const curr of currPhase) {
      for (const prev of prevPhase) {
        addEdge(prev.id, curr.id, "phase");
      }
    }
  }

  // Layer 2: Artifact cross-references
  // If task A produces artifact X and task B (at same or later phase) also mentions X,
  // and A appears before B, B depends on A
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i];
      const b = tasks[j];
      const shared = a.artifacts.filter((art) => b.artifacts.includes(art));
      if (shared.length > 0 && a.phase <= b.phase) {
        addEdge(a.id, b.id, "artifact");
      }
    }
  }

  // Layer 3: Temporal markers — if original text used numbered list or conjunctions,
  // add weak ordering edges between consecutive tasks
  if (method === "numbered" || method === "conjunctions") {
    for (let i = 0; i < tasks.length - 1; i++) {
      addEdge(tasks[i].id, tasks[i + 1].id, "temporal");
    }
  }

  return edges;
}

// --- Cycle detection + topological sort (Kahn's algorithm) ---

function topologicalSort(taskIds: string[], edges: Edge[]): { sorted: string[]; hasCycle: boolean } {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of taskIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const edge of edges) {
    adj.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    // Sort queue for deterministic ordering (by task id)
    queue.sort();
    const node = queue.shift()!;
    sorted.push(node);

    for (const neighbor of adj.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return { sorted, hasCycle: sorted.length !== taskIds.length };
}

// --- Transitive reduction ---

function transitiveReduction(taskIds: string[], edges: Edge[]): Edge[] {
  // Build adjacency for reachability
  const adj = new Map<string, Set<string>>();
  for (const id of taskIds) adj.set(id, new Set());
  for (const e of edges) adj.get(e.from)!.add(e.to);

  // For each node, compute transitive closure via BFS
  const reachable = new Map<string, Set<string>>();
  for (const id of taskIds) {
    const visited = new Set<string>();
    const stack = [...(adj.get(id) ?? [])];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (visited.has(n)) continue;
      visited.add(n);
      for (const next of adj.get(n) ?? []) {
        stack.push(next);
      }
    }
    reachable.set(id, visited);
  }

  // Remove edge A->C if there exists a path A->B->...->C (through another node)
  return edges.filter((e) => {
    // Check if `to` is reachable from `from` via any other direct neighbor
    for (const neighbor of adj.get(e.from) ?? []) {
      if (neighbor !== e.to && reachable.get(neighbor)?.has(e.to)) {
        return false; // redundant edge
      }
    }
    return true;
  });
}

// --- Wave computation ---

function computeWaves(taskIds: string[], edges: Edge[], maxParallel: number): Map<string, number> {
  // Compute wave (level) for each task based on longest path from root
  const inEdges = new Map<string, string[]>();
  for (const id of taskIds) inEdges.set(id, []);
  for (const e of edges) inEdges.get(e.to)!.push(e.from);

  const waveMap = new Map<string, number>();

  // BFS-like: tasks with no incoming edges are wave 0
  const resolved = new Set<string>();
  let currentWave = 0;

  while (resolved.size < taskIds.length) {
    const ready = taskIds.filter(
      (id) => !resolved.has(id) && (inEdges.get(id) ?? []).every((dep) => resolved.has(dep))
    );

    if (ready.length === 0) break; // safety: shouldn't happen after cycle check

    // Split into chunks of maxParallel
    for (let i = 0; i < ready.length; i += maxParallel) {
      const chunk = ready.slice(i, i + maxParallel);
      for (const id of chunk) {
        waveMap.set(id, currentWave);
        resolved.add(id);
      }
      if (i + maxParallel < ready.length) currentWave++;
    }

    currentWave++;
  }

  return waveMap;
}

// --- Model picking (reuses same pattern as decompose) ---

interface TaskModelPick {
  id: string;
  name: string;
  provider: string;
  score: number;
  pricing: { prompt: number; completion: number };
  reason: string;
}

function pickModelForTask(category: Category, budget: Budget, contextTags: string[] = []): TaskModelPick | null {
  const state = pipeline.getState();
  const tier = BUDGET_THRESHOLDS[budget] ?? BUDGET_THRESHOLDS.medium;
  const normParams = pipeline.getNormParams();

  const filtered = state.models
    .filter((m) => m.pricing.prompt >= tier.min && m.pricing.prompt <= tier.max)
    .filter((m) => m.categories.includes(category) || m.categories.includes("general"));

  const ctxScores = dbGetContextScoreBatch(category, contextTags);
  const cmScores = dbGetCommunityScoreBatch(category);

  const candidates = filtered.sort((a, b) => {
    const aCtx = contextTags.length ? (ctxScores.get(a.id) ?? null) : null;
    const bCtx = contextTags.length ? (ctxScores.get(b.id) ?? null) : null;
    const aCm = cmScores.get(a.id) ?? null;
    const bCm = cmScores.get(b.id) ?? null;
    const aBoost = computeContextBoost(a, contextTags, normParams);
    const bBoost = computeContextBoost(b, contextTags, normParams);
    const aScore = blendScore(a.scores[category] ?? a.scores.general ?? 0, a.id, category, { contextScore: aCtx, communityScore: aCm }) + aBoost;
    const bScore = blendScore(b.scores[category] ?? b.scores.general ?? 0, b.id, category, { contextScore: bCtx, communityScore: bCm }) + bBoost;
    return bScore - aScore;
  });

  const best = candidates[0];
  if (!best) return null;

  const ctxScore = contextTags.length ? (ctxScores.get(best.id) ?? null) : null;
  const cmScore = cmScores.get(best.id) ?? null;
  const ctxBoost = computeContextBoost(best, contextTags, normParams);
  const score = blendScore(best.scores[category] ?? best.scores.general ?? 0, best.id, category, { contextScore: ctxScore, communityScore: cmScore }) + ctxBoost;

  return {
    id: best.id,
    name: best.name,
    provider: best.provider,
    score: Math.round(score * 100) / 100,
    pricing: best.pricing,
    reason: `Best ${category} model at ${budget} budget ($${tier.min}-${tier.max}/M) — score: ${Math.round(score * 100) / 100}${ctxBoost > 0 ? ` (context boost: +${ctxBoost})` : ""}`,
  };
}

// --- Route handler ---

swarmRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.task) {
    return c.json(
      { error: { code: "MISSING_PARAM", message: "task field is required in request body" } },
      400
    );
  }

  const task: string = body.task;
  const budget: Budget = body.budget ?? "medium";
  const context: string | undefined = body.context;
  const maxParallel = Math.min(Math.max(1, body.maxParallel ?? 5), 8);
  const contextTags = parseContextTags(context);

  // Split the task
  const { subtasks, method } = splitTask(task, budget);

  // Can't split → signal fallback
  if (subtasks.length === 0 || subtasks.length === 1) {
    return c.json({ decomposed: false, reason: "Task does not decompose into multiple independent subtasks" });
  }

  // Build swarm tasks with phase/artifact/persona detection
  const swarmTasks: SwarmTask[] = subtasks.map((st, i) => ({
    id: `swarm-${i + 1}`,
    description: st.task,
    category: st.category,
    budget: st.budget,
    persona: assignPersona(st.task, st.category),
    dependsOn: [],
    phase: detectPhase(st.task),
    artifacts: detectArtifacts(st.task),
  }));

  // Build dependency edges (3 heuristic layers)
  let edges = buildDependencyEdges(swarmTasks, method);

  // Transitive reduction
  const taskIds = swarmTasks.map((t) => t.id);
  edges = transitiveReduction(taskIds, edges);

  // Cycle detection via topological sort
  const { sorted, hasCycle } = topologicalSort(taskIds, edges);
  let warning: string | undefined;

  if (hasCycle) {
    // Fall back to sequential chain
    warning = "Cycle detected in dependency graph — falling back to sequential ordering";
    edges = [];
    for (let i = 0; i < swarmTasks.length - 1; i++) {
      edges.push({ from: swarmTasks[i].id, to: swarmTasks[i + 1].id, type: "temporal" });
    }
  }

  // Populate dependsOn from edges
  for (const t of swarmTasks) {
    t.dependsOn = edges.filter((e) => e.to === t.id).map((e) => e.from);
  }

  // Compute waves
  const waveMap = computeWaves(taskIds, edges, maxParallel);

  // Pick a model for each task
  const dagTasks = swarmTasks.map((t) => {
    const pick = pickModelForTask(t.category, t.budget, contextTags);
    return {
      id: t.id,
      description: t.description,
      category: t.category,
      budget: t.budget,
      persona: t.persona,
      dependsOn: t.dependsOn,
      model: pick
        ? { id: pick.id, name: pick.name, provider: pick.provider, score: pick.score, pricing: pick.pricing }
        : null,
      reason: pick?.reason ?? `No model found for ${t.category} at ${t.budget} budget`,
      wave: waveMap.get(t.id) ?? 0,
    };
  });

  // Build wave summary
  const waveGroups = new Map<number, string[]>();
  for (const t of dagTasks) {
    const group = waveGroups.get(t.wave) || [];
    group.push(t.id);
    waveGroups.set(t.wave, group);
  }

  const waves = [...waveGroups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([wave, ids]) => ({
      wave,
      taskIds: ids,
      description: `${ids.length} ${ids.length === 1 ? "task" : "parallel tasks"}`,
    }));

  // Cost estimation: assume 1K tokens (low) and 10K tokens (high) per task
  const estimatedCost = { low: 0, high: 0 };
  for (const t of dagTasks) {
    if (t.model) {
      // pricing is per 1M tokens, so 1K tokens = pricing / 1000, 10K = pricing / 100
      const promptCostLow = (t.model.pricing.prompt / 1000) + (t.model.pricing.completion / 1000);
      const promptCostHigh = (t.model.pricing.prompt / 100) + (t.model.pricing.completion / 100);
      estimatedCost.low += promptCostLow;
      estimatedCost.high += promptCostHigh;
    }
  }
  estimatedCost.low = Math.round(estimatedCost.low * 1000) / 1000;
  estimatedCost.high = Math.round(estimatedCost.high * 1000) / 1000;

  return c.json({
    decomposed: true,
    dag: {
      tasks: dagTasks,
      waves,
      edges,
      totalTasks: dagTasks.length,
      totalWaves: waves.length,
      originalTask: task,
      context: context ?? null,
      estimatedCost,
      ...(warning ? { warning } : {}),
    },
  });
});
