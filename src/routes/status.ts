import { Hono } from "hono";
import { pipeline } from "../enrichment/pipeline.ts";
import { getAliasStats } from "../enrichment/alias-map.ts";

export const statusRoute = new Hono();

statusRoute.get("/", (c) => {
  const state = pipeline.getState();
  const aliasStats = getAliasStats();

  const modelsWithScores = state.models.filter(
    (m) => Object.keys(m.scores).length > 0
  ).length;

  const modelsWithBenchmarks = state.models.filter(
    (m) => m.benchmarks && Object.keys(m.benchmarks).length > 0
  ).length;

  return c.json({
    data: {
      status: state.models.length > 0 ? "ok" : "empty",
      lastRefresh: state.lastRefresh || null,
      modelCount: state.models.length,
      modelsWithScores,
      modelsWithBenchmarks,
      aliases: aliasStats,
      sources: state.sources,
      version: state.version,
    },
  });
});
