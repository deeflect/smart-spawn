import type { EnrichedModel } from "./types.ts";
import type { NormParams } from "./enrichment/scoring.ts";

interface ContextSignal {
  field: keyof NonNullable<EnrichedModel["benchmarks"]>;
  weight: number;
}

/**
 * Context tags map to benchmark fields that are most relevant for that tech stack.
 * When a user passes `?context=typescript,nextjs`, models with strong scores on
 * the associated benchmarks get a boost (up to 15 points).
 */
export const CONTEXT_SIGNALS: Record<string, ContextSignal[]> = {
  // Languages
  typescript: [
    { field: "liveBenchAgenticCoding", weight: 0.15 },
    { field: "liveBenchCoding", weight: 0.10 },
    { field: "liveCodeBench", weight: 0.10 },
  ],
  javascript: [
    { field: "liveBenchAgenticCoding", weight: 0.15 },
    { field: "liveBenchCoding", weight: 0.10 },
    { field: "liveCodeBench", weight: 0.08 },
  ],
  python: [
    { field: "liveCodeBench", weight: 0.15 },
    { field: "liveBenchCoding", weight: 0.10 },
    { field: "codingIndex", weight: 0.08 },
  ],
  rust: [
    { field: "liveCodeBench", weight: 0.15 },
    { field: "liveBenchCoding", weight: 0.10 },
    { field: "liveBenchReasoning", weight: 0.08 },
  ],
  go: [
    { field: "liveCodeBench", weight: 0.12 },
    { field: "liveBenchCoding", weight: 0.10 },
    { field: "codingIndex", weight: 0.08 },
  ],
  java: [
    { field: "liveCodeBench", weight: 0.12 },
    { field: "liveBenchCoding", weight: 0.10 },
    { field: "codingIndex", weight: 0.08 },
  ],

  // Frameworks
  nextjs: [
    { field: "liveBenchAgenticCoding", weight: 0.15 },
    { field: "liveBenchCoding", weight: 0.10 },
    { field: "liveCodeBench", weight: 0.08 },
  ],
  react: [
    { field: "liveBenchAgenticCoding", weight: 0.12 },
    { field: "liveBenchCoding", weight: 0.10 },
    { field: "liveCodeBench", weight: 0.08 },
  ],
  vue: [
    { field: "liveBenchAgenticCoding", weight: 0.12 },
    { field: "liveBenchCoding", weight: 0.10 },
    { field: "liveCodeBench", weight: 0.08 },
  ],
  supabase: [
    { field: "liveBenchAgenticCoding", weight: 0.12 },
    { field: "liveBenchCoding", weight: 0.10 },
    { field: "gpqa", weight: 0.05 },
  ],

  // Domains
  math: [
    { field: "mathIndex", weight: 0.15 },
    { field: "liveBenchMath", weight: 0.15 },
    { field: "math500", weight: 0.10 },
  ],
  security: [
    { field: "liveBenchReasoning", weight: 0.12 },
    { field: "gpqa", weight: 0.10 },
    { field: "liveBenchCoding", weight: 0.08 },
  ],
  data: [
    { field: "liveBenchReasoning", weight: 0.10 },
    { field: "mmluPro", weight: 0.10 },
    { field: "gpqa", weight: 0.08 },
  ],
  sql: [
    { field: "liveCodeBench", weight: 0.12 },
    { field: "liveBenchCoding", weight: 0.10 },
    { field: "liveBenchReasoning", weight: 0.08 },
  ],
  css: [
    { field: "liveBenchAgenticCoding", weight: 0.12 },
    { field: "liveBenchCoding", weight: 0.10 },
    { field: "arena", weight: 0.05 },
  ],
};

/**
 * Compute a context boost for a model given context tags and normalization params.
 * Returns 0-15 point boost based on how well the model scores on benchmarks
 * relevant to the specified context tags.
 */
export function computeContextBoost(
  model: EnrichedModel,
  contextTags: string[],
  normParams: Record<string, NormParams>
): number {
  if (!contextTags.length || !model.benchmarks) return 0;

  let totalBoost = 0;

  for (const tag of contextTags) {
    const signals = CONTEXT_SIGNALS[tag];
    if (!signals) continue;

    for (const signal of signals) {
      const rawValue = model.benchmarks[signal.field];
      if (rawValue === undefined || rawValue === null) continue;

      const params = normParams[signal.field];
      if (!params || params.stddev === 0) continue;

      // Z-score: how many stddevs above mean
      const z = (rawValue - params.mean) / params.stddev;

      // Only boost for above-average models (z > 0), scale by weight
      if (z > 0) {
        totalBoost += z * signal.weight * 10;
      }
    }
  }

  // Cap at 15 to prevent overwhelming base score
  return Math.min(15, Math.round(totalBoost * 100) / 100);
}

/** Parse a context query param into validated tags */
export function parseContextTags(contextParam: string | undefined): string[] {
  if (!contextParam) return [];
  return contextParam
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}
