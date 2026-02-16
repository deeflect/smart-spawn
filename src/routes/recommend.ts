import { Hono } from "hono";
import { pipeline } from "../enrichment/pipeline.ts";
import { dbGetPersonalScore } from "../db.ts";
import type { Budget, Category, EnrichedModel } from "../types.ts";
import { BUDGET_THRESHOLDS } from "../types.ts";
import { KNOWN_CATEGORIES, classifyTask } from "../scoring-utils.ts";
import { parseContextTags } from "../context-signals.ts";
import { sortModelsByScore } from "../model-selection.ts";

export const recommendRoute = new Hono();

recommendRoute.get("/", (c) => {
  const taskParam = c.req.query("task");
  if (!taskParam) {
    return c.json(
      { error: { code: "MISSING_PARAM", message: "task parameter is required" } },
      400
    );
  }

  const budget = (c.req.query("budget") ?? "medium") as Budget;
  const count = Math.max(1, Math.min(parseInt(c.req.query("count") ?? "1", 10) || 1, 5));
  const exclude = (c.req.query("exclude") ?? "").split(",").filter(Boolean);
  const require = (c.req.query("require") ?? "").split(",").filter(Boolean);
  const minContext = parseInt(c.req.query("minContext") ?? "0", 10) || 0;
  const contextTags = parseContextTags(c.req.query("context") ?? undefined);

  // Classify task
  const category = KNOWN_CATEGORIES.includes(taskParam as Category)
    ? (taskParam as Category)
    : classifyTask(taskParam);

  const state = pipeline.getState();
  let candidates = [...state.models];

  // Filter by budget
  const tier = BUDGET_THRESHOLDS[budget] ?? BUDGET_THRESHOLDS.medium;
  candidates = candidates.filter((m) => m.pricing.prompt >= tier.min && m.pricing.prompt <= tier.max);

  // Filter by exclusions
  if (exclude.length > 0) {
    candidates = candidates.filter((m) => !exclude.includes(m.id));
  }

  // Filter by required capabilities
  for (const req of require) {
    candidates = candidates.filter((m) => {
      if (req === "vision") return m.capabilities.vision;
      if (req === "functionCalling") return m.capabilities.functionCalling;
      if (req === "json") return m.capabilities.json;
      if (req === "reasoning") return m.capabilities.reasoning;
      return true;
    });
  }

  // Filter by minimum context
  if (minContext > 0) {
    candidates = candidates.filter((m) => m.contextLength >= minContext);
  }

  // Filter by category relevance
  candidates = candidates.filter(
    (m) => m.categories.includes(category) || m.categories.includes("general")
  );

  // Sort by blended score (benchmark + personal + context + community)
  sortModelsByScore(candidates, category, contextTags);

  // Take top N, preferring diverse providers
  const recommendations = pickDiverse(candidates, count, category);

  return c.json({
    data: recommendations.map((model) => ({
      model,
      reason: buildReason(model, category, budget),
      confidence: computeConfidence(model, category),
    })),
    meta: {
      task: category,
      taskRaw: taskParam,
      budget,
      candidatesConsidered: candidates.length,
    },
  });
});

/** Pick top N models, preferring provider diversity */
function pickDiverse(
  sorted: EnrichedModel[],
  count: number,
  _category: Category
): EnrichedModel[] {
  if (count <= 1) return sorted.slice(0, 1);

  const picked: EnrichedModel[] = [];
  const seenProviders = new Set<string>();

  // First pass: one per provider
  for (const model of sorted) {
    if (picked.length >= count) break;
    if (!seenProviders.has(model.provider)) {
      picked.push(model);
      seenProviders.add(model.provider);
    }
  }

  // Second pass: fill remaining from top if needed
  if (picked.length < count) {
    for (const model of sorted) {
      if (picked.length >= count) break;
      if (!picked.includes(model)) {
        picked.push(model);
      }
    }
  }

  return picked;
}

function buildReason(
  model: EnrichedModel,
  category: Category,
  budget: Budget
): string {
  const score = model.scores[category] ?? model.scores.general ?? 0;
  const parts: string[] = [];

  if (score >= 80) parts.push(`Top ${category} model`);
  else if (score >= 60) parts.push(`Strong ${category} model`);
  else parts.push(`Available ${category} model`);

  parts.push(`at ${budget} budget`);

  if (model.speed?.outputTokensPerSecond && model.speed.outputTokensPerSecond >= 80) {
    parts.push("(fast)");
  }

  if (model.sourcesCovered.length > 1) {
    parts.push(`(${model.sourcesCovered.length} benchmark sources)`);
  }

  return parts.join(" ");
}

function computeConfidence(model: EnrichedModel, category: Category): number {
  const score = model.scores[category] ?? model.scores.general;
  if (score === undefined) return 0.3;

  let confidence = 0.5;

  // More benchmark sources = higher confidence
  confidence += model.sourcesCovered.length * 0.1;

  // Has category-specific score
  if (model.scores[category] !== undefined) confidence += 0.1;

  // Has arena ELO (human preference data)
  if (model.benchmarks?.arena) confidence += 0.1;

  // Has personal feedback data — strong signal
  const personal = dbGetPersonalScore(model.id, category);
  if (personal != null) confidence += 0.15;

  return Math.min(confidence, 0.99);
}
