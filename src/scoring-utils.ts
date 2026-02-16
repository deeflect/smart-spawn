import { dbGetPersonalScore } from "./db.ts";
import type { Category } from "./types.ts";

export const KNOWN_CATEGORIES: Category[] = [
  "coding", "reasoning", "creative", "research", "general", "fast-cheap", "vision",
];

export const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  coding: [
    "code", "coding", "program", "debug", "fix", "implement", "refactor",
    "typescript", "python", "javascript", "rust", "go", "java", "sql",
    "api", "endpoint", "function", "class", "test", "bug", "compile",
    "build", "deploy", "docker", "git", "schema", "database", "db",
    "pr", "review",
  ],
  reasoning: [
    "reason", "reasoning", "analyze", "analysis", "think", "logic",
    "math", "calculate", "prove", "deduce", "evaluate", "compare",
    "decision", "strategy", "plan", "architecture", "design",
  ],
  creative: [
    "creative", "write", "story", "poem", "essay", "blog", "content",
    "marketing", "copy", "brainstorm", "idea", "name", "slogan",
    "narrative", "fiction", "script",
  ],
  research: [
    "research", "search", "find", "look up", "investigate", "survey",
    "summarize", "compile", "report", "literature", "paper", "study",
    "document", "learn about",
  ],
  "fast-cheap": [
    "quick", "fast", "cheap", "simple", "brief", "short", "classify",
    "label", "tag", "extract", "parse", "format", "convert",
  ],
  vision: [
    "image", "picture", "photo", "screenshot", "diagram", "chart",
    "visual", "see", "look at", "describe image", "ocr",
  ],
  general: [],
};

export function classifyTask(taskText: string): Category {
  const lower = taskText.toLowerCase();
  let bestCategory: Category = "general";
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [Category, string[]][]) {
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

export interface BlendScoreOpts {
  contextScore?: number | null;   // 0-1, from context_scores table
  communityScore?: number | null; // 0-1, from community_scores table
}

/**
 * Blend benchmark score with personal feedback, context, and community scores.
 *
 * Blending matrix:
 * | Personal | Context | Community | Formula |
 * |----------|---------|-----------|---------|
 * | null     | null    | null      | benchmark only |
 * | yes      | null    | null      | 70% bench + 30% personal |
 * | yes      | yes     | null      | 60% bench + 20% personal + 20% context |
 * | null     | yes     | null      | 80% bench + 20% context |
 * | null     | null    | yes       | 70% bench + 30% community |
 * | yes      | null    | yes       | 50% bench + 25% personal + 25% community |
 * | null     | yes     | yes       | 55% bench + 20% context + 25% community |
 * | yes      | yes     | yes       | 45% bench + 20% personal + 15% context + 20% community |
 */
export function blendScore(
  benchmarkScore: number,
  modelId: string,
  category: string,
  opts?: BlendScoreOpts
): number {
  const personal = dbGetPersonalScore(modelId, category);
  const context = opts?.contextScore ?? null;
  const community = opts?.communityScore ?? null;

  const hasPersonal = personal != null;
  const hasContext = context != null;
  const hasCommunity = community != null;

  // Scale 0-1 values to 0-100 for blending
  const pScore = hasPersonal ? personal * 100 : 0;
  const cxScore = hasContext ? context * 100 : 0;
  const cmScore = hasCommunity ? community * 100 : 0;

  let result: number;

  if (!hasPersonal && !hasContext && !hasCommunity) {
    return benchmarkScore;
  } else if (hasPersonal && !hasContext && !hasCommunity) {
    result = benchmarkScore * 0.7 + pScore * 0.3;
  } else if (hasPersonal && hasContext && !hasCommunity) {
    result = benchmarkScore * 0.6 + pScore * 0.2 + cxScore * 0.2;
  } else if (!hasPersonal && hasContext && !hasCommunity) {
    result = benchmarkScore * 0.8 + cxScore * 0.2;
  } else if (!hasPersonal && !hasContext && hasCommunity) {
    result = benchmarkScore * 0.7 + cmScore * 0.3;
  } else if (hasPersonal && !hasContext && hasCommunity) {
    result = benchmarkScore * 0.5 + pScore * 0.25 + cmScore * 0.25;
  } else if (!hasPersonal && hasContext && hasCommunity) {
    result = benchmarkScore * 0.55 + cxScore * 0.2 + cmScore * 0.25;
  } else {
    // all three
    result = benchmarkScore * 0.45 + pScore * 0.2 + cxScore * 0.15 + cmScore * 0.2;
  }

  return Math.round(result * 100) / 100;
}
