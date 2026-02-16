// === Core Data Model ===

export type Category =
  | "coding"
  | "reasoning"
  | "creative"
  | "fast-cheap"
  | "vision"
  | "research"
  | "general";

export type Tier = "premium" | "standard" | "budget";

export type Budget = "low" | "medium" | "high" | "any";

export interface EnrichedModel {
  id: string; // OpenRouter canonical ID: "anthropic/claude-opus-4-6"
  name: string;
  provider: string;

  contextLength: number;
  pricing: {
    prompt: number; // per 1M tokens, USD
    completion: number;
  };
  capabilities: {
    vision: boolean;
    functionCalling: boolean;
    streaming: boolean;
    json: boolean;
    reasoning: boolean;
  };

  categories: Category[];
  scores: Partial<Record<Category, number>>; // 0-100
  costEfficiency: Partial<Record<Category, number>>; // quality/cost ratio
  tier: Tier;

  benchmarks?: {
    arena?: number;
    intelligenceIndex?: number;
    codingIndex?: number;
    mathIndex?: number;
    mmluPro?: number;
    gpqa?: number;
    liveCodeBench?: number;
    math500?: number;
    ifEval?: number;
    bbh?: number;
    liveBenchCoding?: number; // LiveBench coding score (contamination-free)
    liveBenchAgenticCoding?: number; // LiveBench agentic coding (JS/TS/Python)
    liveBenchReasoning?: number; // LiveBench reasoning score
    liveBenchMath?: number; // LiveBench mathematics score
    liveBenchLanguage?: number; // LiveBench language score
    liveBenchIF?: number; // LiveBench instruction following score
  };

  speed?: {
    outputTokensPerSecond?: number;
    timeToFirstToken?: number;
  };

  tags: string[];
  lastUpdated: string;
  sourcesCovered: string[];
}

// === Source-specific raw types ===

export interface OpenRouterModel {
  id: string;
  canonical_slug: string;
  hugging_face_id: string | null;
  name: string;
  created: number;
  description: string;
  context_length: number;
  architecture: {
    modality: string;
    input_modalities: string[];
    output_modalities: string[];
    tokenizer: string;
    instruct_type: string | null;
  };
  pricing: {
    prompt: string;
    completion: string;
    image?: string;
    request?: string;
    input_cache_read?: string;
    input_cache_write?: string;
    web_search?: string;
    internal_reasoning?: string;
  };
  top_provider: {
    context_length: number;
    max_completion_tokens: number | null;
    is_moderated: boolean;
  };
  per_request_limits: Record<string, string> | null;
  supported_parameters: string[];
  default_parameters?: Record<string, unknown>;
  expiration_date?: string | null;
}

export interface ArtificialAnalysisModel {
  id: string;
  name: string;
  slug: string;
  model_creator: {
    id: string;
    name: string;
    slug: string;
  };
  evaluations: {
    artificial_analysis_intelligence_index?: number;
    artificial_analysis_coding_index?: number;
    artificial_analysis_math_index?: number;
    mmlu_pro?: number;
    gpqa?: number;
    hle?: number;
    livecodebench?: number;
    scicode?: number;
    math_500?: number;
    aime?: number;
  };
  pricing?: {
    price_1m_blended_3_to_1?: number;
    price_1m_input_tokens?: number;
    price_1m_output_tokens?: number;
  };
  median_output_tokens_per_second?: number;
  median_time_to_first_token_seconds?: number;
}

export interface HFLeaderboardEntry {
  Model: string; // HuggingFace model ID
  Average: number;
  IFEval?: number;
  BBH?: number;
  "MATH Lvl 5"?: number;
  GPQA?: number;
  MUSR?: number;
  "MMLU-PRO"?: number;
  "#Params (B)"?: number;
  Type?: string;
}

export interface LMArenaEntry {
  rank: number;
  rankStyleCtrl: number;
  model: string; // Display name like "Gemini-2.5-Pro"
  arenaScore: number; // ELO rating, typically 1200-1500
  confidenceInterval: string; // "+5/-5"
  votes: number;
  organization: string;
  license: string;
}

// === Enrichment Pipeline Types ===

export interface SourceResult<T> {
  source: string;
  data: T[];
  pulledAt: string;
  count: number;
  error?: string;
}

export interface SourceStatus {
  status: "ok" | "error" | "stale";
  lastPull: string | null;
  count: number;
  error?: string;
}

export interface PipelineState {
  models: EnrichedModel[];
  lastRefresh: string;
  sources: Record<string, SourceStatus>;
  version: string;
}

// === API Response Types ===

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export interface RecommendationResult {
  model: EnrichedModel;
  reason: string;
  confidence: number;
}

// === Alias Map Types ===

export interface AliasEntry {
  openrouterId: string;
  names: string[]; // all known names across sources
}

// === Budget thresholds (per 1M prompt tokens, USD) ===

export const BUDGET_THRESHOLDS: Record<Budget, { min: number; max: number }> = {
  low: { min: 0, max: 1 },       // $0-1/M — cheapest usable models
  medium: { min: 0, max: 5 },     // $0-5/M — mid-range, best value
  high: { min: 2, max: 20 },      // $2-20/M — premium models only
  any: { min: 0, max: Infinity },  // no constraints
};

export const TIER_BASELINES: Record<Tier, number> = {
  premium: 70,
  standard: 50,
  budget: 30,
};
