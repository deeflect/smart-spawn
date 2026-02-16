import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { dbGet, dbSet } from "../db.ts";
import type {
  EnrichedModel,
  PipelineState,
  SourceStatus,
  OpenRouterModel,
  ArtificialAnalysisModel,
  HFLeaderboardEntry,
  LMArenaEntry,
  Category,
} from "../types.ts";
import { pullOpenRouter, parsePricing, extractCapabilities } from "./sources/openrouter.ts";
import { pullArtificialAnalysis } from "./sources/artificial.ts";
import { pullHFLeaderboard } from "./sources/hf-leaderboard.ts";
import { pullLMArena } from "./sources/lmarena.ts";
import { pullLiveBench, type LiveBenchEntry } from "./sources/livebench.ts";
import { resolveAlias } from "./alias-map.ts";
import { classifyTier, deriveCategories, deriveTags } from "./rules.ts";
import { computeScores, computeCostEfficiency, computeNormParams } from "./scoring.ts";

const SEED_PATH = join(import.meta.dir, "../data/seed-overrides.yaml");
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

import type { NormParams } from "./scoring.ts";

let state: PipelineState = {
  models: [],
  lastRefresh: "",
  sources: {},
  version: "1.0.0",
};

let cachedNormParams: Record<string, NormParams> = {};
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Get current pipeline state */
export function getState(): PipelineState {
  return state;
}

/** Get cached normalization parameters (available after loadFromCache or refresh) */
export function getNormParams(): Record<string, NormParams> {
  return cachedNormParams;
}

/** Load cached data from SQLite */
export async function loadFromCache(): Promise<void> {
  try {
    const cached = dbGet<PipelineState>("pipeline_state");
    if (cached) {
      state = cached.data;
      // Recompute normParams so they're available before first refresh
      if (state.models.length > 0) {
        cachedNormParams = computeNormParams(state.models);
      }
      console.log(`[pipeline] Loaded ${state.models.length} models from cache (${cached.updatedAt})`);
      return;
    }

    // Fallback: try legacy JSON file (one-time migration)
    const legacyPath = join(import.meta.dir, "../../data/models.json");
    if (existsSync(legacyPath)) {
      const raw = readFileSync(legacyPath, "utf-8");
      const legacy = JSON.parse(raw) as PipelineState;
      state = legacy;
      dbSet("pipeline_state", state);
      console.log(`[pipeline] Migrated ${state.models.length} models from JSON to SQLite`);
      return;
    }

    console.log("[pipeline] No cache found, will refresh from sources");
  } catch (e) {
    console.error("[pipeline] Failed to load cache:", e);
  }
}

/** Save current state to SQLite */
function saveToCache(): void {
  try {
    dbSet("pipeline_state", state);
    console.log(`[pipeline] Saved ${state.models.length} models to cache`);
  } catch (e) {
    console.error("[pipeline] Failed to save cache:", e);
  }
}

/** Load seed overrides from YAML */
function loadSeedOverrides(): Record<string, { categories?: Category[]; scores?: Partial<Record<Category, number>> }> {
  try {
    if (!existsSync(SEED_PATH)) return {};
    const raw = readFileSync(SEED_PATH, "utf-8");
    return (parse(raw) as Record<string, { categories?: Category[]; scores?: Partial<Record<Category, number>> }>) ?? {};
  } catch {
    return {};
  }
}

/** Incremental refresh — update what's new, keep what's old */
export async function refresh(): Promise<void> {
  console.log("[pipeline] Starting refresh...");
  const sources: Record<string, SourceStatus> = {};

  // Pull all sources in parallel with per-source timeouts
  const SOURCE_TIMEOUT = 45_000; // 45s per source
  function withTimeout<T>(promise: Promise<T>, source: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${source} timed out after ${SOURCE_TIMEOUT / 1000}s`)), SOURCE_TIMEOUT)
      ),
    ]).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[pipeline] Source ${source} failed: ${msg}`);
      return { source, data: [], pulledAt: new Date().toISOString(), count: 0, error: msg } as unknown as T;
    });
  }

  const [orResult, aaResult, hfResult, arenaResult, lbResult] = await Promise.all([
    withTimeout(pullOpenRouter(), "openrouter"),
    withTimeout(pullArtificialAnalysis(), "artificial-analysis"),
    withTimeout(pullHFLeaderboard(), "hf-leaderboard"),
    withTimeout(pullLMArena(), "lmarena"),
    withTimeout(pullLiveBench(), "livebench"),
  ]);

  for (const [key, r] of Object.entries({
    openrouter: orResult,
    "artificial-analysis": aaResult,
    "hf-leaderboard": hfResult,
    lmarena: arenaResult,
    livebench: lbResult,
  })) {
    // Preserve last-known-good status for failed sources
    const prev = state.sources[key];
    sources[key] = r.error
      ? { status: "stale", lastPull: prev?.lastPull ?? null, count: prev?.count ?? 0, error: r.error }
      : { status: "ok", lastPull: r.pulledAt, count: r.count };
  }

  if (orResult.data.length === 0) {
    console.error("[pipeline] OpenRouter returned 0 models, aborting refresh");
    state.sources = sources;
    return;
  }

  // Step 1: Sync catalog from OpenRouter — add new models, update pricing/caps on existing
  const models = new Map<string, EnrichedModel>();
  const existing = new Map(state.models.map((m) => [m.id, m]));

  for (const or of orResult.data) {
    const prev = existing.get(or.id);
    if (prev) {
      // Update mutable fields from OR, keep enrichment data
      prev.name = or.name.replace(/^[^:]+:\s*/, "");
      prev.contextLength = or.context_length;
      prev.pricing = {
        prompt: parsePricing(or.pricing.prompt, or.id),
        completion: parsePricing(or.pricing.completion, or.id),
      };
      prev.capabilities = extractCapabilities(or);
      prev.tier = classifyTier(prev.provider, prev.pricing.prompt);
      models.set(or.id, prev);
    } else {
      models.set(or.id, buildBaseModel(or));
    }
  }

  // Step 2-5: Merge enrichment sources — only if they succeeded
  if (!aaResult.error && aaResult.data.length > 0) {
    mergeArtificialAnalysis(models, aaResult.data);
  } else {
    console.log(`[pipeline] Skipping AA merge (${aaResult.error ?? "no data"}), keeping old scores`);
  }

  if (!hfResult.error && hfResult.data.length > 0) {
    mergeHFLeaderboard(models, hfResult.data, orResult.data);
  } else {
    console.log(`[pipeline] Skipping HF merge (${hfResult.error ?? "no data"}), keeping old scores`);
  }

  if (!arenaResult.error && arenaResult.data.length > 0) {
    mergeLMArena(models, arenaResult.data);
  } else {
    console.log(`[pipeline] Skipping LMArena merge (${arenaResult.error ?? "no data"}), keeping old scores`);
  }

  if (!lbResult.error && lbResult.data.length > 0) {
    mergeLiveBench(models, lbResult.data);
  } else {
    console.log(`[pipeline] Skipping LiveBench merge (${lbResult.error ?? "no data"}), keeping old scores`);
  }

  // Step 6: Propagate enrichment to variant models (:free, :thinking, :exacto, etc.)
  propagateToVariants(models);

  // Step 7: Apply rules (categories, tiers, tags)
  for (const model of models.values()) {
    model.categories = deriveCategories(model);
    model.tags = deriveTags(model);
  }

  // Step 8: Compute scores (normalize benchmarks to common scale first)
  const normParams = computeNormParams(Array.from(models.values()));
  cachedNormParams = normParams;
  for (const model of models.values()) {
    model.scores = computeScores(model, normParams);
    model.costEfficiency = computeCostEfficiency(model);
  }

  // Step 9: Apply seed overrides (highest priority)
  const overrides = loadSeedOverrides();
  for (const [id, override] of Object.entries(overrides)) {
    const model = models.get(id);
    if (!model) continue;
    if (override.categories) model.categories = override.categories;
    if (override.scores) {
      model.scores = { ...model.scores, ...override.scores };
      model.costEfficiency = computeCostEfficiency(model);
    }
  }

  // Step 10: Finalize
  const modelArray = Array.from(models.values());
  const prevCount = state.models.length;

  state = {
    models: modelArray,
    lastRefresh: new Date().toISOString(),
    sources,
    version: "1.0.0",
  };

  saveToCache();

  const withBenchmarks = modelArray.filter(
    (m) => m.benchmarks && Object.keys(m.benchmarks).length > 0
  ).length;
  console.log(
    `[pipeline] Refresh complete: ${modelArray.length} models (was ${prevCount}), ${withBenchmarks} with benchmarks`
  );
}

/** Build a base EnrichedModel from OpenRouter data */
function buildBaseModel(or: OpenRouterModel): EnrichedModel {
  const provider = or.id.split("/")[0] ?? "unknown";
  const promptPrice = parsePricing(or.pricing.prompt, or.id);
  const completionPrice = parsePricing(or.pricing.completion, or.id);

  return {
    id: or.id,
    name: or.name.replace(/^[^:]+:\s*/, ""), // Strip "Provider: " prefix
    provider,
    contextLength: or.context_length,
    pricing: {
      prompt: promptPrice,
      completion: completionPrice,
    },
    capabilities: extractCapabilities(or),
    categories: [],
    scores: {},
    costEfficiency: {},
    tier: classifyTier(provider, promptPrice),
    benchmarks: {},
    speed: undefined,
    tags: [],
    lastUpdated: new Date().toISOString(),
    sourcesCovered: ["openrouter"],
  };
}

/**
 * Normalize AA Intelligence Index scores to 0-100 scale.
 *
 * AA Index v4.0 uses a -100 to +100 scale:
 *   - 0 means as many correct as incorrect answers
 *   - Negative means more incorrect than correct
 *   - Current top: Opus 4.6 ~53, GPT-5.2 ~51
 *   - 4 equal-weight categories: Agents, Coding, General, Scientific Reasoning
 *   - Scored via pass@1 across 10 evaluations
 *
 * We normalize the -100..+100 range to 0-100:
 *   normalized = (raw + 100) / 2
 *   So -100 → 0, 0 → 50, 53 → 76.5, 100 → 100
 */
function normalizeAA(raw: number | undefined | null): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  return Math.max(0, Math.min(100, Math.round((raw + 100) / 2)));
}

/** Convert 0-1 fraction to 0-100 percentage, rounding to 1 decimal */
function toPercent(raw: number | undefined | null): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  return Math.round(raw * 1000) / 10; // e.g. 0.896 → 89.6
}

/**
 * Strip AA name variant suffixes for alias matching.
 * AA has entries like "Claude 4.5 Sonnet (Reasoning)" — we need "Claude 4.5 Sonnet".
 */
function stripAAVariant(name: string): string {
  return name
    .replace(/\s*\(Adaptive Reasoning\)\s*$/i, "")
    .replace(/\s*\(Reasoning\)\s*$/i, "")
    .replace(/\s*\(Non-reasoning\)\s*$/i, "")
    .replace(/\s*\([^)]*'[0-9]{2}\)\s*$/i, "") // "(Sep '25)" date suffixes
    .trim();
}

/** Check if an AA entry is a reasoning variant (preferred over non-reasoning) */
function isReasoningVariant(name: string): boolean {
  return /\((?:Adaptive )?Reasoning\)/i.test(name);
}

/** Merge Artificial Analysis benchmark data into models */
function mergeArtificialAnalysis(
  models: Map<string, EnrichedModel>,
  aaModels: ArtificialAnalysisModel[]
): void {
  let matched = 0;

  // Group AA entries by resolved OpenRouter ID, preferring reasoning variants
  const bestByOrId = new Map<string, ArtificialAnalysisModel>();

  for (const aa of aaModels) {
    const stripped = stripAAVariant(aa.name);
    const id =
      resolveAlias(aa.name) ??
      resolveAlias(stripped) ??
      resolveAlias(aa.slug) ??
      resolveAlias(`${aa.model_creator.name} ${stripped}`) ??
      resolveAlias(`${aa.model_creator.slug} ${stripped}`);

    if (!id || !models.has(id)) continue;

    const existing = bestByOrId.get(id);
    if (!existing) {
      bestByOrId.set(id, aa);
    } else if (isReasoningVariant(aa.name) && !isReasoningVariant(existing.name)) {
      // Prefer reasoning variant
      bestByOrId.set(id, aa);
    }
  }

  for (const [id, aa] of bestByOrId) {
    const model = models.get(id);
    if (!model) continue;

    matched++;
    if (!model.sourcesCovered.includes("artificial-analysis")) {
      model.sourcesCovered.push("artificial-analysis");
    }

    // Merge benchmarks
    // AA Index scores (-100 to +100) → normalized to 0-100 via normalizeAA()
    // AA accuracy benchmarks (mmluPro, gpqa, etc.) are 0-1 fractions → multiply by 100
    // Note: HF uses a different normalization (random=0, perfect=100), so
    // these values are NOT directly comparable across sources.
    const evals = aa.evaluations;
    model.benchmarks = {
      ...model.benchmarks,
      intelligenceIndex: normalizeAA(evals.artificial_analysis_intelligence_index),
      codingIndex: normalizeAA(evals.artificial_analysis_coding_index),
      mathIndex: normalizeAA(evals.artificial_analysis_math_index),
      mmluPro: toPercent(evals.mmlu_pro),
      gpqa: toPercent(evals.gpqa),
      liveCodeBench: toPercent(evals.livecodebench),
      math500: toPercent(evals.math_500),
    };

    // Merge speed data
    if (aa.median_output_tokens_per_second || aa.median_time_to_first_token_seconds) {
      model.speed = {
        outputTokensPerSecond: aa.median_output_tokens_per_second,
        timeToFirstToken: aa.median_time_to_first_token_seconds,
      };
    }
  }

  console.log(
    `[pipeline] Artificial Analysis: matched ${matched}/${aaModels.length} models`
  );
}

/** Merge HF Leaderboard data using hugging_face_id + alias map */
function mergeHFLeaderboard(
  models: Map<string, EnrichedModel>,
  hfEntries: HFLeaderboardEntry[],
  orModels: OpenRouterModel[]
): void {
  // Build HF ID → OpenRouter ID mapping from OpenRouter's hugging_face_id field
  const hfToOr = new Map<string, string>();
  for (const or of orModels) {
    if (or.hugging_face_id) {
      hfToOr.set(or.hugging_face_id.toLowerCase(), or.id);
    }
  }

  // Group by resolved OpenRouter ID, keeping best entry (highest Average)
  const bestByOrId = new Map<string, HFLeaderboardEntry>();

  for (const hf of hfEntries) {
    if (!hf.Model) continue;

    // Strategy 1: Match via OpenRouter hugging_face_id
    let orId = hfToOr.get(hf.Model.toLowerCase());

    // Strategy 2: Try alias map with full HF path
    if (!orId) orId = resolveAlias(hf.Model) ?? null;

    // Strategy 3: Try alias map with just the model name (after org/)
    if (!orId && hf.Model.includes("/")) {
      const modelName = hf.Model.split("/").pop()!;
      orId = resolveAlias(modelName) ?? null;
    }

    // Strategy 4: Try matching HF org/model against OpenRouter ID patterns
    // e.g. "meta-llama/Meta-Llama-3.1-8B-Instruct" → "meta-llama/llama-3.1-8b-instruct"
    if (!orId) {
      const lowered = hf.Model.toLowerCase();
      if (models.has(lowered)) orId = lowered;
    }

    if (!orId || !models.has(orId)) continue;

    const existing = bestByOrId.get(orId);
    if (!existing || hf.Average > existing.Average) {
      bestByOrId.set(orId, hf);
    }
  }

  let matched = 0;

  for (const [orId, hf] of bestByOrId) {
    const model = models.get(orId);
    if (!model) continue;

    matched++;
    if (!model.sourcesCovered.includes("hf-leaderboard")) {
      model.sourcesCovered.push("hf-leaderboard");
    }

    // HF scores are already on 0-100 scale
    // Only set if we don't already have this data (from Artificial Analysis)
    model.benchmarks = {
      ...model.benchmarks,
      ifEval: model.benchmarks?.ifEval ?? hf.IFEval,
      bbh: model.benchmarks?.bbh ?? hf.BBH,
      mmluPro: model.benchmarks?.mmluPro ?? hf["MMLU-PRO"],
      gpqa: model.benchmarks?.gpqa ?? hf.GPQA,
    };
  }

  console.log(
    `[pipeline] HF Leaderboard: matched ${matched}/${hfEntries.length} models`
  );
}

/**
 * Progressively strip LMArena display name suffixes for alias matching.
 * Arena uses names like "ChatGPT-4o-latest (2025-03-26)", "Grok-4-0709",
 * "GPT-4.1-2025-04-14", "Gemini-2.5-Pro-Preview-05-06".
 * Returns array of candidate names from most specific to least.
 */
function arenaNameCandidates(name: string): string[] {
  const candidates: string[] = [name];

  // Strip parenthesized suffixes: "(2025-03-26)", "(Early Grok-3)", "(thinking-16k)", "(20250514)"
  let stripped = name.replace(/\s*\([^)]+\)\s*$/, "").trim();
  if (stripped !== name) candidates.push(stripped);

  // Strip trailing date: "-2025-04-14", "-0709", "-02-24"
  let noDate = stripped
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")
    .replace(/-\d{4}$/, "")
    .replace(/-\d{2}-\d{2}$/, "");
  if (noDate !== stripped) candidates.push(noDate);

  // Strip version suffixes: "-Preview-05-06", "-Exp-0827", "-001", "-002"
  let noVersion = noDate
    .replace(/-Preview(?:-\d{2}-\d{2})?$/i, "")
    .replace(/-Exp(?:-\d{4})?$/i, "")
    .replace(/-Experimental$/i, "")
    .replace(/-00[0-9]$/i, "")
    .replace(/-bf16$/i, "")
    .replace(/-fp8$/i, "");
  if (noVersion !== noDate) candidates.push(noVersion);

  // Dashes to spaces for each candidate
  const withSpaces = candidates.map((c) => c.replace(/-/g, " "));
  candidates.push(...withSpaces);

  // ChatGPT → GPT mapping
  const chatGptMapped = candidates
    .filter((c) => c.startsWith("ChatGPT"))
    .map((c) => c.replace(/^ChatGPT/, "GPT"));
  candidates.push(...chatGptMapped);

  // Handle "Meta-Llama-X" → "Llama X" (Arena uses Meta- prefix)
  const metaStripped = candidates
    .filter((c) => /^Meta[- ]Llama/i.test(c))
    .map((c) => c.replace(/^Meta[- ]/i, ""));
  candidates.push(...metaStripped);

  // Handle "Nvidia-Llama-X" → "Llama X" and keep "Nemotron" variants
  const nvidiaStripped = candidates
    .filter((c) => /^Nvidia[- ]/i.test(c))
    .map((c) => c.replace(/^Nvidia[- ]/i, ""));
  candidates.push(...nvidiaStripped);

  return [...new Set(candidates)];
}

/**
 * Normalize LMArena ELO score to 0-100 scale.
 * ELO typically ranges ~1000-1500. We map 1000→0, 1500→100.
 * This gives reasonable spread: 1200→40, 1300→60, 1400→80, 1470→94.
 */
function normalizeArenaElo(elo: number): number {
  const normalized = ((elo - 1000) / 500) * 100;
  return Math.max(0, Math.min(100, Math.round(normalized * 10) / 10));
}

/** Merge LMArena ELO scores into models */
function mergeLMArena(
  models: Map<string, EnrichedModel>,
  arenaEntries: LMArenaEntry[]
): void {
  // Group by resolved OpenRouter ID, keeping best entry (highest ELO)
  const bestByOrId = new Map<string, LMArenaEntry>();

  for (const entry of arenaEntries) {
    if (!entry.model || !entry.arenaScore) continue;

    // Generate candidate names and try resolving each
    const candidates = arenaNameCandidates(entry.model);
    let id: string | null = null;

    for (const candidate of candidates) {
      id = resolveAlias(candidate);
      if (id && models.has(id)) break;
      id = null;
    }

    // Also try with org prefix
    if (!id) {
      for (const candidate of candidates) {
        id = resolveAlias(`${entry.organization} ${candidate}`);
        if (id && models.has(id)) break;
        id = null;
      }
    }

    if (!id || !models.has(id)) continue;

    const existing = bestByOrId.get(id);
    if (!existing || entry.arenaScore > existing.arenaScore) {
      bestByOrId.set(id, entry);
    }
  }

  let matched = 0;

  for (const [id, entry] of bestByOrId) {
    const model = models.get(id);
    if (!model) continue;

    matched++;
    if (!model.sourcesCovered.includes("lmarena")) {
      model.sourcesCovered.push("lmarena");
    }

    model.benchmarks = {
      ...model.benchmarks,
      arena: normalizeArenaElo(entry.arenaScore),
    };
  }

  console.log(
    `[pipeline] LMArena: matched ${matched}/${arenaEntries.length} models`
  );
}

/**
 * Generate candidate names for LiveBench model name matching.
 * LiveBench website CSV uses variant-heavy names like:
 *   "claude-opus-4-6-thinking-auto-high-effort"
 *   "gpt-5.2-2025-12-11-high"
 *   "gemini-2.5-flash-06-05-highthinking"
 *   "claude-4-1-opus-20250805-base"
 * We iteratively strip suffixes until we find the base model name.
 */
function liveBenchNameCandidates(name: string): string[] {
  const candidates: string[] = [name];

  // Handle Amazon Bedrock format
  let cur = name.replace(/^amazon\./, "amazon/").replace(/:\d+$/, "");
  if (cur !== name) candidates.push(cur);

  // Iteratively strip known suffixes (order matters, run until stable)
  let prev = "";
  while (cur !== prev) {
    prev = cur;

    // Strip thinking/effort combos: -thinking-auto-high-effort, -thinking-64k-medium-effort
    cur = cur.replace(/-thinking(?:-[a-z0-9]+)*(?:-(high|medium|low)(?:-effort)?)?$/i, "");
    // Strip standalone effort: -high-effort, -medium-effort, -low-effort
    cur = cur.replace(/-(high|medium|low)-effort$/i, "");
    // Strip mode suffixes: -highthinking, -nothinking, -non-reasoning, -reasoning
    cur = cur.replace(/-(highthinking|nothinking|non-reasoning|reasoning)$/i, "");
    // Strip effort levels: -high, -medium, -low, -minimal
    cur = cur.replace(/-(high|medium|low|minimal)$/i, "");
    // Strip base/instruct: -base, -instruct
    cur = cur.replace(/-(base|instruct)$/i, "");
    // Strip trailing dates: -2025-12-11, -20251001, -11-2025, -06-05, -0825
    cur = cur.replace(/-\d{4}-\d{2}-\d{2}$/, "");
    cur = cur.replace(/-\d{8}$/, "");
    cur = cur.replace(/-\d{2}-\d{4}$/, "");
    cur = cur.replace(/-\d{2}-\d{2}$/, ""); // MM-DD (e.g. Gemini -06-05)
    cur = cur.replace(/-\d{4}$/, "");
    // Strip version suffixes: -preview-MM-YYYY, -preview, -exp, -001, -turbo
    cur = cur.replace(/-preview(?:-\d{2}-\d{4})?$/i, "");
    cur = cur.replace(/-exp(?:-\d{2}-\d{2})?$/i, "");
    cur = cur.replace(/-00[0-9]$/i, "");
    cur = cur.replace(/-turbo$/i, "");

    if (cur !== prev) candidates.push(cur);
  }

  // Handle "Meta-Llama-" / "meta-llama-" prefix
  const metaStripped = candidates
    .filter((c) => /^meta[-.]llama[-.]?/i.test(c))
    .map((c) => c.replace(/^meta[-.]llama[-.]?/i, "Llama-"));
  candidates.push(...metaStripped);

  // Try converting version dashes to dots: "claude-haiku-4-5" → "claude-haiku-4.5"
  // Matches patterns like X-N-N at the end or X-N-N-suffix
  const withDots = candidates
    .map((c) => c.replace(/(\d)-(\d)/g, "$1.$2"))
    .filter((c) => !candidates.includes(c));
  candidates.push(...withDots);

  // Dashes to spaces for each candidate
  const withSpaces = candidates.map((c) => c.replace(/-/g, " "));
  candidates.push(...withSpaces);

  return [...new Set(candidates)];
}

/** Merge LiveBench scores into models */
function mergeLiveBench(
  models: Map<string, EnrichedModel>,
  lbEntries: LiveBenchEntry[]
): void {
  let matched = 0;
  const unmatched: string[] = [];

  for (const entry of lbEntries) {
    if (!entry.model) continue;

    // Generate candidate names and try resolving each
    const candidates = liveBenchNameCandidates(entry.model);
    let id: string | null = null;

    for (const candidate of candidates) {
      id = resolveAlias(candidate);
      if (id && models.has(id)) break;
      id = null;
    }

    // Also try the raw name as an OpenRouter ID (some match directly)
    if (!id) {
      const lowered = entry.model.toLowerCase();
      if (models.has(lowered)) id = lowered;
    }

    if (!id || !models.has(id)) {
      unmatched.push(entry.model);
      continue;
    }

    const model = models.get(id)!;
    matched++;

    if (!model.sourcesCovered.includes("livebench")) {
      model.sourcesCovered.push("livebench");
    }

    // Only set if we don't already have this data from a higher-priority source
    model.benchmarks = {
      ...model.benchmarks,
      liveBenchCoding: model.benchmarks?.liveBenchCoding ?? entry.coding,
      liveBenchAgenticCoding:
        model.benchmarks?.liveBenchAgenticCoding ?? entry.agenticCoding,
      liveBenchReasoning:
        model.benchmarks?.liveBenchReasoning ?? entry.reasoning,
      liveBenchMath: model.benchmarks?.liveBenchMath ?? entry.mathematics,
      liveBenchLanguage: model.benchmarks?.liveBenchLanguage ?? entry.language,
      liveBenchIF: model.benchmarks?.liveBenchIF ?? entry.instructionFollowing,
    };
  }

  if (unmatched.length > 0) {
    console.log(
      `[pipeline] LiveBench unmatched (${unmatched.length}): ${unmatched.slice(0, 10).join(", ")}${unmatched.length > 10 ? "..." : ""}`
    );
  }

  console.log(
    `[pipeline] LiveBench: matched ${matched}/${lbEntries.length} models`
  );
}

/**
 * Propagate benchmarks and speed data from base models to their variants.
 * OpenRouter has variant IDs like "model:free", "model:thinking", "model:exacto"
 * that are the same model with different pricing/routing but should share scores.
 */
function propagateToVariants(models: Map<string, EnrichedModel>): void {
  let propagated = 0;

  for (const [id, model] of models) {
    if (!id.includes(":")) continue;

    const baseId = id.split(":")[0];
    const base = models.get(baseId);
    if (!base) continue;

    // Only propagate if the variant has no benchmarks of its own
    const hasBenchmarks = model.benchmarks && Object.keys(model.benchmarks).length > 0;
    if (hasBenchmarks) continue;

    // Copy benchmarks and speed from base
    model.benchmarks = { ...base.benchmarks };
    if (base.speed) model.speed = { ...base.speed };

    // Copy sourcesCovered (mark as inherited)
    for (const src of base.sourcesCovered) {
      if (!model.sourcesCovered.includes(src)) {
        model.sourcesCovered.push(src);
      }
    }

    propagated++;
  }

  if (propagated > 0) {
    console.log(`[pipeline] Propagated benchmarks to ${propagated} variant models`);
  }
}

/** Start the periodic refresh timer */
export function startRefreshTimer(): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    console.log("[pipeline] Periodic refresh triggered");
    refresh().catch((e) => console.error("[pipeline] Periodic refresh failed:", e));
  }, REFRESH_INTERVAL_MS);
  console.log(`[pipeline] Refresh timer started (every ${REFRESH_INTERVAL_MS / 1000 / 60 / 60}h)`);
}

export const pipeline = {
  getState,
  getNormParams,
  loadFromCache,
  refresh,
  startRefreshTimer,
};
