import type { Category, EnrichedModel } from "../types.ts";
import { TIER_BASELINES } from "../types.ts";

// === Normalization ===
// Each benchmark has a different effective range. AA indices compress everything
// into a 24-point window (50-74) while LiveCodeBench uses 90 points (1.9-91.7).
// Without normalization, a 1-point change in codingIndex (noise) would count
// the same as a 1-point change in LiveCodeBench (real signal).
//
// We use z-score normalization: (value - mean) / stddev, then map to 0-100.
// This way a model 2σ above mean on LiveCodeBench gets the same score as one
// 2σ above mean on codingIndex — both are "equally exceptional" on their metric.
//
// Mapping: z=-2.5→0, z=0→50, z=+1→70, z=+2→90, z=+2.5→100

type BenchmarkKey = keyof NonNullable<EnrichedModel["benchmarks"]>;

export interface NormParams {
  mean: number;
  stddev: number;
}

/**
 * Compute mean and stddev for each benchmark from the current model set.
 * Call once before scoring all models.
 */
export function computeNormParams(
  models: EnrichedModel[]
): Record<string, NormParams> {
  const buckets: Record<string, number[]> = {};

  for (const m of models) {
    if (!m.benchmarks) continue;
    for (const [key, val] of Object.entries(m.benchmarks)) {
      if (val !== undefined && val !== null) {
        (buckets[key] ??= []).push(val);
      }
    }
  }

  const params: Record<string, NormParams> = {};
  for (const [key, vals] of Object.entries(buckets)) {
    if (vals.length < 5) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance =
      vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / vals.length;
    const stddev = Math.sqrt(variance);
    if (stddev > 0) params[key] = { mean, stddev };
  }

  return params;
}

/**
 * Normalize a benchmark value to 0-100 via z-score.
 * z = (value - mean) / stddev → mapped = 50 + z * 20
 * So: mean→50, +1σ→70, +2σ→90, +2.5σ→100, -2.5σ→0
 */
function norm(
  value: number | undefined,
  key: BenchmarkKey,
  params: Record<string, NormParams>
): number | undefined {
  if (value === undefined) return undefined;
  const p = params[key];
  if (!p) return value;
  const z = (value - p.mean) / p.stddev;
  return Math.max(0, Math.min(100, 50 + z * 20));
}

// === Weighted average ===

interface WeightedSource {
  value: number | undefined;
  weight: number;
}

/**
 * Weighted average of available sources.
 * Missing sources are skipped; their weight is redistributed proportionally.
 */
function wavg(sources: WeightedSource[]): number | undefined {
  let totalWeight = 0;
  let totalValue = 0;
  for (const { value, weight } of sources) {
    if (value !== undefined) {
      totalWeight += weight;
      totalValue += value * weight;
    }
  }
  if (totalWeight === 0) return undefined;
  return totalValue / totalWeight;
}

// === Scoring ===
//
// Weight rationale (informed by data analysis):
//
// CODING:
//   LiveCodeBench (w4) — widest spread (signal 53.7%), 171 models, direct code generation
//   LiveBench Agentic Coding (w3) — most practical (multi-step real coding), signal 53%
//   LiveBench Coding (w2) — contamination-free but compressed (signal 9.3%)
//   AA Coding Index (w1) — 9.4% signal, 24-point range, barely differentiates
//
// GENERAL:
//   Arena ELO (w3) — 29.3% signal, gold standard for human preference
//   MMLU-Pro (w2) — 25.4% signal, broad knowledge, 182 models
//   GPQA (w2) — 38.3% signal, graduate-level QA, 193 models
//   AA Intelligence Index (w1) — 9.3% signal, compressed
//
// REASONING:
//   LiveBench Reasoning (w3) — 28.6% signal, direct measurement
//   GPQA (w3) — 38.3% signal, graduate-level reasoning, widest spread
//   Math Index (w2) — 21.5% signal, reasoning-adjacent
//   Arena ELO (w1) — indirect reasoning signal
//   AA Intelligence Index (w1) — compressed
//
// CREATIVE:
//   Arena ELO (w4) — human preference IS creative quality
//   LiveBench Language (w2) — language quality
//   general score (w1) — baseline

export function computeScores(
  model: EnrichedModel,
  normParams: Record<string, NormParams>
): Partial<Record<Category, number>> {
  const scores: Partial<Record<Category, number>> = {};
  const b = model.benchmarks;
  const baseline = TIER_BASELINES[model.tier];
  const n = (val: number | undefined, key: BenchmarkKey) => norm(val, key, normParams);

  // === General ===
  scores.general =
    wavg([
      { value: n(b?.arena, "arena"), weight: 3 },
      { value: n(b?.mmluPro, "mmluPro"), weight: 2 },
      { value: n(b?.gpqa, "gpqa"), weight: 2 },
      { value: n(b?.intelligenceIndex, "intelligenceIndex"), weight: 1 },
    ]) ?? baseline;

  // === Coding ===
  scores.coding =
    wavg([
      { value: n(b?.liveCodeBench, "liveCodeBench"), weight: 4 },
      { value: n(b?.liveBenchAgenticCoding, "liveBenchAgenticCoding"), weight: 3 },
      { value: n(b?.liveBenchCoding, "liveBenchCoding"), weight: 2 },
      { value: n(b?.codingIndex, "codingIndex"), weight: 1 },
    ]) ?? Math.round((scores.general ?? baseline) * 0.85);

  // === Reasoning ===
  scores.reasoning =
    wavg([
      { value: n(b?.liveBenchReasoning, "liveBenchReasoning"), weight: 3 },
      { value: n(b?.gpqa, "gpqa"), weight: 3 },
      { value: n(b?.mathIndex, "mathIndex"), weight: 2 },
      { value: n(b?.arena, "arena"), weight: 1 },
      { value: n(b?.intelligenceIndex, "intelligenceIndex"), weight: 1 },
    ]) ?? baseline;
  if (model.capabilities.reasoning && scores.reasoning < 80) {
    scores.reasoning = Math.max(scores.reasoning, 65);
  }

  // === Vision ===
  if (model.capabilities.vision) {
    scores.vision = scores.general;
  }

  // === Fast-cheap ===
  if (model.pricing.prompt < 2) {
    scores["fast-cheap"] = Math.round(100 - model.pricing.prompt * 50);
  }

  // === Research ===
  if (model.contextLength >= 100_000) {
    const contextBonus = Math.min(
      (model.contextLength / 1_000_000) * 20,
      20
    );
    scores.research = Math.round((scores.general ?? baseline) + contextBonus);
  }

  // === Creative ===
  if (b?.arena || b?.liveBenchLanguage) {
    scores.creative = wavg([
      { value: n(b?.arena, "arena"), weight: 4 },
      { value: n(b?.liveBenchLanguage, "liveBenchLanguage"), weight: 2 },
      { value: scores.general, weight: 1 },
    ]);
  } else if (model.tier === "premium") {
    scores.creative = scores.general;
  }

  // Clamp all scores to 0-100
  for (const key of Object.keys(scores) as Category[]) {
    const val = scores[key];
    if (val !== undefined) {
      scores[key] = Math.max(0, Math.min(100, Math.round(val)));
    }
  }

  return scores;
}

/**
 * Cost-efficiency: score / price ratio per category.
 */
export function computeCostEfficiency(
  model: EnrichedModel
): Partial<Record<Category, number>> {
  const efficiency: Partial<Record<Category, number>> = {};
  const totalPrice = model.pricing.prompt + model.pricing.completion;

  if (totalPrice <= 0) return efficiency;

  for (const [cat, score] of Object.entries(model.scores) as [
    Category,
    number,
  ][]) {
    if (score !== undefined) {
      efficiency[cat] = Math.round((score / totalPrice) * 100) / 100;
    }
  }

  return efficiency;
}
