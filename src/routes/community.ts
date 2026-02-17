import { Hono } from "hono";
import { dbReportCommunityOutcome, dbGetCommunityScores } from "../db.ts";
import { sanitizeCategory } from "../utils/validation.ts";

export const communityRoute = new Hono();

/**
 * POST /community/report — Anonymous community outcome report.
 * Body: { model, category, rating (1-5), instanceId }
 * No task content — just model + category + rating.
 */
communityRoute.post("/report", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.model || !body?.category || body?.rating == null || !body?.instanceId) {
    return c.json(
      { error: { code: "INVALID_BODY", message: "model, category, rating (1-5), and instanceId are required" } },
      400
    );
  }

  const rating = Math.max(1, Math.min(5, Math.round(body.rating)));
  const modelId = (body.model as string).replace(/^openrouter\//, "");

  const result = dbReportCommunityOutcome(modelId, body.category, rating, body.instanceId);

  if (!result.recorded) {
    return c.json(
      { error: { code: "RATE_LIMITED", message: result.error ?? "Rate limit exceeded" } },
      429
    );
  }

  return c.json({ data: { recorded: true } });
});

/**
 * GET /community/scores?category=coding&minRatings=10 — Community model scores.
 */
communityRoute.get("/scores", (c) => {
  const rawCategory = c.req.query("category") ?? undefined;
  const category = sanitizeCategory(rawCategory) ?? undefined;
  if (rawCategory && !category) {
    return c.json(
      { error: { code: "INVALID_PARAM", message: "category is invalid" } },
      400
    );
  }
  const minRatings = Math.max(1, parseInt(c.req.query("minRatings") ?? "10", 10) || 10);
  const scores = dbGetCommunityScores(category, minRatings);
  return c.json({ data: scores });
});
