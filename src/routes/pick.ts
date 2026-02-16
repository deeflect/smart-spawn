import { Hono } from "hono";
import { pipeline } from "../enrichment/pipeline.ts";
import { dbGetPersonalScore, dbGetContextScore, dbGetCommunityScore } from "../db.ts";
import type { Budget, Category } from "../types.ts";
import { BUDGET_THRESHOLDS } from "../types.ts";
import { KNOWN_CATEGORIES, blendScore } from "../scoring-utils.ts";
import { computeContextBoost, parseContextTags } from "../context-signals.ts";
import { sortModelsByScore } from "../model-selection.ts";

export const pickRoute = new Hono();

pickRoute.get("/", (c) => {
  const taskParam = c.req.query("task");
  if (!taskParam) {
    return c.json(
      { error: { code: "MISSING_PARAM", message: "task parameter is required" } },
      400
    );
  }

  const budget = (c.req.query("budget") ?? "medium") as Budget;
  const category: Category = KNOWN_CATEGORIES.includes(taskParam as Category)
    ? (taskParam as Category)
    : "general";

  // Exclude specific model IDs (used by cascade to avoid duplicates)
  const excludeParam = c.req.query("exclude");
  const excludeIds = excludeParam ? excludeParam.split(",").map((s) => s.trim()) : [];

  // Context tags for context-aware routing
  const contextTags = parseContextTags(c.req.query("context") ?? undefined);

  const state = pipeline.getState();
  const tier = BUDGET_THRESHOLDS[budget] ?? BUDGET_THRESHOLDS.medium;

  // Filter by price range (min AND max) + category + exclusions
  const filtered = state.models
    .filter((m) => m.pricing.prompt >= tier.min && m.pricing.prompt <= tier.max)
    .filter((m) => !excludeIds.includes(m.id))
    .filter(
      (m) => m.categories.includes(category) || m.categories.includes("general")
    );

  const candidates = sortModelsByScore(filtered, category, contextTags);

  const best = candidates[0];

  if (!best) {
    return c.json(
      {
        error: {
          code: "NO_MODEL",
          message: `No model found for task=${taskParam} budget=${budget}`,
        },
      },
      404
    );
  }

  const benchmarkScore = best.scores[category] ?? best.scores.general ?? 0;
  const personalScore = dbGetPersonalScore(best.id, category);
  const contextScore = contextTags.length ? dbGetContextScore(best.id, category, contextTags) : null;
  const communityScore = dbGetCommunityScore(best.id, category);
  const contextBoost = computeContextBoost(best, contextTags, pipeline.getNormParams());
  const finalScore = blendScore(benchmarkScore, best.id, category, { contextScore, communityScore }) + contextBoost;

  return c.json({
    data: {
      id: best.id,
      name: best.name,
      provider: best.provider,
      score: Math.round(finalScore * 100) / 100,
      benchmarkScore,
      personalScore,
      ...(contextTags.length > 0 ? { contextBoost, contextTags } : {}),
      pricing: best.pricing,
      budget,
      tier: { min: tier.min, max: tier.max },
      candidateCount: candidates.length,
      reason: `Best ${category} model at ${budget} budget ($${tier.min}-${tier.max}/M) — score: ${Math.round(finalScore * 100) / 100}${personalScore != null ? ` (personal: ${Math.round(personalScore * 100)}%)` : ""}${contextBoost > 0 ? ` (context boost: +${contextBoost})` : ""}`,
    },
  });
});
