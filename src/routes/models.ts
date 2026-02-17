import { Hono } from "hono";
import { pipeline } from "../enrichment/pipeline.ts";
import type { Category, Tier } from "../types.ts";
import { KNOWN_CATEGORIES } from "../scoring-utils.ts";
import { sanitizeCategory, sanitizeSort, sanitizeTier } from "../utils/validation.ts";

export const modelsRoute = new Hono();

modelsRoute.get("/", (c) => {
  const state = pipeline.getState();

  // Query params
  const rawCategory = c.req.query("category") ?? undefined;
  const category = sanitizeCategory(rawCategory) ?? undefined;
  if (rawCategory && !category) {
    return c.json(
      { error: { code: "INVALID_PARAM", message: "category is invalid" } },
      400
    );
  }

  const rawTier = c.req.query("tier") ?? undefined;
  const tier = sanitizeTier(rawTier) ?? undefined;
  if (rawTier && !tier) {
    return c.json(
      { error: { code: "INVALID_PARAM", message: "tier is invalid" } },
      400
    );
  }

  const limit = Math.max(1, Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 500));
  const sort = sanitizeSort(c.req.query("sort") ?? undefined);

  let filtered = [...state.models];

  // Filter by category
  if (category) {
    filtered = filtered.filter((m) => m.categories.includes(category));
  }

  // Filter by tier
  if (tier) {
    filtered = filtered.filter((m) => m.tier === tier);
  }

  // Sort — sort param can be "cost", "efficiency", a category name, or "score" (default)
  const categorySet = new Set<string>(KNOWN_CATEGORIES);
  // If sort is a category name, use that as the sort category
  const sortCategory = categorySet.has(sort) ? (sort as Category) : category;

  if (sort === "cost") {
    filtered.sort((a, b) => a.pricing.prompt - b.pricing.prompt);
  } else if (sort === "efficiency") {
    filtered.sort((a, b) => {
      const aEff = sortCategory
        ? (a.costEfficiency[sortCategory] ?? 0)
        : avgEfficiency(a.costEfficiency);
      const bEff = sortCategory
        ? (b.costEfficiency[sortCategory] ?? 0)
        : avgEfficiency(b.costEfficiency);
      return bEff - aEff;
    });
  } else {
    // Default: sort by score (descending)
    filtered.sort((a, b) => {
      const aScore = sortCategory
        ? (a.scores[sortCategory] ?? 0)
        : avgScore(a.scores);
      const bScore = sortCategory
        ? (b.scores[sortCategory] ?? 0)
        : avgScore(b.scores);
      return bScore - aScore;
    });
  }

  const total = filtered.length;
  filtered = filtered.slice(0, limit);

  return c.json({
    data: filtered,
    meta: {
      total: state.models.length,
      filtered: total,
      returned: filtered.length,
      lastRefresh: state.lastRefresh,
      version: state.version,
    },
  });
});

function avgScore(scores: Partial<Record<Category, number>>): number {
  const vals = Object.values(scores).filter(
    (v): v is number => v !== undefined
  );
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function avgEfficiency(
  eff: Partial<Record<Category, number>>
): number {
  const vals = Object.values(eff).filter(
    (v): v is number => v !== undefined
  );
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
