import { Hono } from "hono";
import { pipeline } from "../enrichment/pipeline.ts";
import { sanitizeModelIdList } from "../utils/validation.ts";

export const compareRoute = new Hono();

compareRoute.get("/", (c) => {
  const rawModels = c.req.query("models");
  if (!rawModels) {
    return c.json(
      { error: { code: "MISSING_PARAM", message: "models parameter is required" } },
      400
    );
  }

  const models = sanitizeModelIdList(rawModels, 5);
  if (!models || models.length < 2) {
    return c.json(
      { error: { code: "INVALID_PARAM", message: "models must include at least two valid model IDs" } },
      400
    );
  }

  const state = pipeline.getState();
  const found = models.map((id) => state.models.find((m) => m.id === id)).filter(Boolean);
  const missing = models.filter((id) => !state.models.find((m) => m.id === id));

  if (found.length === 0) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "No matching models found" } },
      404
    );
  }

  return c.json({
    data: {
      models: found.map((m) => ({
        id: m!.id,
        name: m!.name,
        provider: m!.provider,
        tier: m!.tier,
        contextLength: m!.contextLength,
        pricing: m!.pricing,
        capabilities: m!.capabilities,
        scores: m!.scores,
        costEfficiency: m!.costEfficiency,
        benchmarks: m!.benchmarks ?? {},
        speed: m!.speed ?? {},
        categories: m!.categories,
        sourcesCovered: m!.sourcesCovered,
        lastUpdated: m!.lastUpdated,
      })),
      missing,
    },
  });
});
