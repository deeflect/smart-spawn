import { Hono } from "hono";
import { dbLogSpawn, dbGetSpawnStats, dbReportOutcome, dbReportContextOutcome, dbGetPersonalScores } from "../db.ts";
import { pipeline } from "../enrichment/pipeline.ts";
import { parseContextTags } from "../context-signals.ts";

export const spawnLogRoute = new Hono();

/**
 * POST /spawn-log — Plugin reports a spawn event.
 * Body: { model, category, budget, mode, source }
 * Pricing is looked up from the model catalog automatically.
 */
spawnLogRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.model || !body?.category) {
    return c.json(
      { error: { code: "INVALID_BODY", message: "model and category are required" } },
      400
    );
  }

  // Look up pricing from catalog
  const state = pipeline.getState();
  const modelId = (body.model as string).replace(/^openrouter\//, "");
  const found = state.models.find((m) => m.id === modelId);

  dbLogSpawn({
    model: modelId,
    category: body.category,
    budget: body.budget ?? "medium",
    mode: body.mode ?? "single",
    role: body.role ?? "primary",
    source: body.source ?? "api",
    promptPrice: found?.pricing.prompt ?? 0,
    completionPrice: found?.pricing.completion ?? 0,
    context: body.context ?? undefined,
  });

  return c.json({ data: { logged: true } });
});

/**
 * POST /spawn-log/outcome — Report quality feedback for a model+category.
 * Body: { model, category, rating } where rating is 1-5.
 */
spawnLogRoute.post("/outcome", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.model || !body?.category || body?.rating == null) {
    return c.json(
      { error: { code: "INVALID_BODY", message: "model, category, and rating (1-5) are required" } },
      400
    );
  }

  const rating = Math.max(1, Math.min(5, Math.round(body.rating)));
  const modelId = (body.model as string).replace(/^openrouter\//, "");

  dbReportOutcome(modelId, body.category, rating);

  // Also update context-aware scores if context tags provided
  const contextTags = parseContextTags(body.context);
  if (contextTags.length > 0) {
    dbReportContextOutcome(modelId, body.category, contextTags, rating);
  }

  return c.json({ data: { recorded: true, model: modelId, category: body.category, rating } });
});

/**
 * GET /spawn-log/scores?category=coding&minSamples=3 — Personal model scores.
 */
spawnLogRoute.get("/scores", (c) => {
  const category = c.req.query("category");
  const minSamples = Math.max(1, parseInt(c.req.query("minSamples") ?? "3", 10) || 3);
  const scores = dbGetPersonalScores(category || undefined, minSamples);
  return c.json({ data: scores });
});

/**
 * GET /spawn-log/stats?days=7 — Spawn statistics for cost dashboard.
 */
spawnLogRoute.get("/stats", (c) => {
  const days = Math.max(1, Math.min(parseInt(c.req.query("days") ?? "7", 10) || 7, 365));
  const stats = dbGetSpawnStats(days);
  return c.json({ data: stats });
});
