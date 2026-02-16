import { Hono } from "hono";
import { pipeline } from "../enrichment/pipeline.ts";
import { dbGetContextScoreBatch, dbGetCommunityScoreBatch } from "../db.ts";
import type { Budget, Category } from "../types.ts";
import { BUDGET_THRESHOLDS } from "../types.ts";
import { classifyTask, blendScore } from "../scoring-utils.ts";
import { computeContextBoost, parseContextTags } from "../context-signals.ts";
import { splitTask } from "../task-splitter.ts";

export const decomposeRoute = new Hono();

// --- Model picking for a subtask ---

interface SubtaskPick {
  id: string;
  name: string;
  provider: string;
  score: number;
  pricing: { prompt: number; completion: number };
  reason: string;
}

function pickModelForSubtask(category: Category, budget: Budget, contextTags: string[] = []): SubtaskPick | null {
  const state = pipeline.getState();
  const tier = BUDGET_THRESHOLDS[budget] ?? BUDGET_THRESHOLDS.medium;
  const normParams = pipeline.getNormParams();

  const filtered = state.models
    .filter((m) => m.pricing.prompt >= tier.min && m.pricing.prompt <= tier.max)
    .filter((m) => m.categories.includes(category) || m.categories.includes("general"));

  // Batch-load scores to avoid N+1 queries in sort
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

decomposeRoute.post("/", async (c) => {
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
  const contextTags = parseContextTags(context);

  const { subtasks } = splitTask(task, budget);

  // If no split detected, signal fallback to single mode
  if (subtasks.length === 0) {
    return c.json({ decomposed: false, reason: "Task does not appear to have multiple steps" });
  }

  // Pick a model for each subtask
  const steps = subtasks.map((st) => {
    const pick = pickModelForSubtask(st.category, st.budget, contextTags);
    return {
      step: st.step,
      task: st.task,
      category: st.category,
      budget: st.budget,
      model: pick
        ? { id: pick.id, name: pick.name, provider: pick.provider, score: pick.score, pricing: pick.pricing }
        : null,
      reason: pick?.reason ?? `No model found for ${st.category} at ${st.budget} budget`,
    };
  });

  return c.json({
    decomposed: true,
    totalSteps: steps.length,
    steps,
    originalTask: task,
    context: context ?? null,
  });
});
