import { pipeline } from "./enrichment/pipeline.ts";
import { dbGetContextScoreBatch, dbGetCommunityScoreBatch } from "./db.ts";
import type { Budget, Category, EnrichedModel } from "./types.ts";
import { BUDGET_THRESHOLDS } from "./types.ts";
import { blendScore } from "./scoring-utils.ts";
import { computeContextBoost } from "./context-signals.ts";

/**
 * Sort models by blended score (benchmark + personal + context + community + context boost).
 * Mutates the array in-place and returns it.
 */
export function sortModelsByScore(
  models: EnrichedModel[],
  category: Category,
  contextTags: string[] = []
): EnrichedModel[] {
  const normParams = pipeline.getNormParams();
  const ctxScores = dbGetContextScoreBatch(category, contextTags);
  const cmScores = dbGetCommunityScoreBatch(category);

  return models.sort((a, b) => {
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
}

export interface ModelPick {
  id: string;
  name: string;
  provider: string;
  score: number;
  pricing: { prompt: number; completion: number };
  reason: string;
}

/**
 * Pick the best model for a category + budget, with optional exclusions.
 * Returns the model and its blended score, or null if no candidates.
 */
export function pickBestModel(
  category: Category,
  budget: Budget,
  contextTags: string[] = [],
  opts?: { exclude?: string[] }
): ModelPick | null {
  const state = pipeline.getState();
  const tier = BUDGET_THRESHOLDS[budget] ?? BUDGET_THRESHOLDS.medium;
  const normParams = pipeline.getNormParams();
  const excludeIds = opts?.exclude ?? [];

  const filtered = state.models
    .filter((m) => m.pricing.prompt >= tier.min && m.pricing.prompt <= tier.max)
    .filter((m) => !excludeIds.includes(m.id))
    .filter((m) => m.categories.includes(category) || m.categories.includes("general"));

  const candidates = sortModelsByScore(filtered, category, contextTags);

  const best = candidates[0];
  if (!best) return null;

  // Compute final blended score for the picked model
  const ctxScores = dbGetContextScoreBatch(category, contextTags);
  const cmScores = dbGetCommunityScoreBatch(category);
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
