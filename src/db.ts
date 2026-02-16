import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const DB_PATH = join(import.meta.dir, "../data/smart-spawn.db");

// Ensure data directory exists
const dir = dirname(DB_PATH);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// WAL mode for crash safety + better concurrent read performance
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA synchronous = NORMAL");

db.run(`
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

// --- Spawn log table (for cost dashboard) ---
db.run(`
  CREATE TABLE IF NOT EXISTS spawn_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT NOT NULL,
    category TEXT NOT NULL,
    budget TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'single',
    role TEXT NOT NULL DEFAULT 'primary',
    source TEXT NOT NULL DEFAULT 'api',
    prompt_price REAL NOT NULL DEFAULT 0,
    completion_price REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// --- Personal scores table (learning loop) ---
db.run(`
  CREATE TABLE IF NOT EXISTS personal_scores (
    model TEXT NOT NULL,
    category TEXT NOT NULL,
    successes INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    score REAL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (model, category)
  )
`);

// --- Context scores table (context-aware learning loop) ---
db.run(`
  CREATE TABLE IF NOT EXISTS context_scores (
    model TEXT NOT NULL,
    category TEXT NOT NULL,
    context_tag TEXT NOT NULL,
    successes INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    score REAL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (model, category, context_tag)
  )
`);

// --- Community scores tables ---
db.run(`
  CREATE TABLE IF NOT EXISTS community_scores (
    model TEXT NOT NULL,
    category TEXT NOT NULL,
    total_ratings INTEGER NOT NULL DEFAULT 0,
    sum_ratings INTEGER NOT NULL DEFAULT 0,
    avg_rating REAL NOT NULL DEFAULT 0,
    contributors INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (model, category)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS community_rate_limits (
    instance_id TEXT NOT NULL,
    window_start TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (instance_id, window_start)
  )
`);

// --- Migrations ---
try {
  db.run(`ALTER TABLE spawn_log ADD COLUMN role TEXT NOT NULL DEFAULT 'primary'`);
} catch { /* already exists */ }
try {
  db.run(`ALTER TABLE spawn_log ADD COLUMN outcome TEXT`);
} catch { /* already exists */ }
try {
  db.run(`ALTER TABLE spawn_log ADD COLUMN context TEXT`);
} catch { /* already exists */ }

const getStmt = db.prepare<{ key: string; value: string; updated_at: string }, [string]>(
  "SELECT key, value, updated_at FROM kv WHERE key = ?"
);
const setStmt = db.prepare(
  "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)"
);

export function dbGet<T>(key: string): { data: T; updatedAt: string } | null {
  const row = getStmt.get(key);
  if (!row) return null;
  return { data: JSON.parse(row.value) as T, updatedAt: row.updated_at };
}

export function dbSet(key: string, value: unknown): void {
  setStmt.run(key, JSON.stringify(value), new Date().toISOString());
}

// --- Spawn logging ---

export type SpawnRole =
  | "primary"          // single mode pick
  | "cascade_cheap"    // cascade: first cheap attempt
  | "cascade_premium"  // cascade: premium escalation option
  | "collective_worker"; // collective: one of N parallel workers

export interface SpawnLogEntry {
  model: string;
  category: string;
  budget: string;
  mode: string;
  role: SpawnRole;
  source: string;
  promptPrice: number;
  completionPrice: number;
  context?: string;
}

const insertSpawnStmt = db.prepare(
  `INSERT INTO spawn_log (model, category, budget, mode, role, source, prompt_price, completion_price, context)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

export function dbLogSpawn(entry: SpawnLogEntry): void {
  insertSpawnStmt.run(
    entry.model, entry.category, entry.budget, entry.mode,
    entry.role, entry.source, entry.promptPrice, entry.completionPrice,
    entry.context ?? null
  );
}

// --- Stats ---

export interface SpawnStats {
  totalSpawns: number;
  byModel: Record<string, number>;
  byCategory: Record<string, number>;
  byMode: Record<string, number>;
  totalEstimatedCost: number;
  opusCostEstimate: number;
  savings: number;
  since: string;
  daily: DailyStats[];
  cascade: CascadeStats;
  categoryAvgCost: Record<string, number>;
  topModels: Array<{ model: string; count: number; avgCost: number }>;
}

interface DailyStats {
  date: string;
  spawns: number;
  estimatedCost: number;
}

interface CascadeStats {
  total: number;
  cheapOnly: number;
  withPremium: number;
  escalationRate: number;
  avgSavingsPerCascade: number;
}

// Assume 2K prompt + 2K completion tokens per spawn
const EST_TOKENS = 2000;
const OPUS_PROMPT = 15;  // $/1M
const OPUS_COMPLETION = 75;

function estimateCost(promptPrice: number, completionPrice: number): number {
  return (promptPrice * EST_TOKENS + completionPrice * EST_TOKENS) / 1_000_000;
}

export function dbGetSpawnStats(sinceDays = 7): SpawnStats {
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();

  const rows = db.prepare<
    { model: string; category: string; mode: string; role: string; prompt_price: number; completion_price: number; created_at: string },
    [string]
  >(
    `SELECT model, category, mode, role, prompt_price, completion_price, created_at
     FROM spawn_log WHERE created_at >= ? ORDER BY created_at`
  ).all(since);

  const byModel: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  const dailyMap: Record<string, { spawns: number; cost: number }> = {};
  const categoryCosts: Record<string, { total: number; count: number }> = {};
  const modelCosts: Record<string, { count: number; totalCost: number }> = {};
  let totalEstimatedCost = 0;

  // Cascade tracking
  let cascadeTotal = 0;
  let cascadePremiums = 0;

  for (const r of rows) {
    byModel[r.model] = (byModel[r.model] ?? 0) + 1;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    byMode[r.mode] = (byMode[r.mode] ?? 0) + 1;

    const cost = estimateCost(r.prompt_price, r.completion_price);
    totalEstimatedCost += cost;

    // Daily
    const day = r.created_at.slice(0, 10);
    const d = dailyMap[day] ??= { spawns: 0, cost: 0 };
    d.spawns++;
    d.cost += cost;

    // Category avg cost
    const cc = categoryCosts[r.category] ??= { total: 0, count: 0 };
    cc.total += cost;
    cc.count++;

    // Model costs
    const mc = modelCosts[r.model] ??= { count: 0, totalCost: 0 };
    mc.count++;
    mc.totalCost += cost;

    // Cascade tracking
    if (r.role === "cascade_cheap") cascadeTotal++;
    if (r.role === "cascade_premium") cascadePremiums++;
  }

  const opusCostEstimate = rows.length * estimateCost(OPUS_PROMPT, OPUS_COMPLETION);

  // Daily breakdown
  const daily = Object.entries(dailyMap)
    .map(([date, d]) => ({
      date,
      spawns: d.spawns,
      estimatedCost: Math.round(d.cost * 1000) / 1000,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Cascade stats
  const cascadeCheapOnly = cascadeTotal - cascadePremiums;
  const avgCheapCost = cascadeTotal > 0
    ? totalEstimatedCost / rows.length  // rough avg
    : 0;
  const avgPremiumCost = estimateCost(OPUS_PROMPT, OPUS_COMPLETION);
  const cascade: CascadeStats = {
    total: cascadeTotal,
    cheapOnly: cascadeCheapOnly,
    withPremium: cascadePremiums,
    escalationRate: cascadeTotal > 0
      ? Math.round((cascadePremiums / cascadeTotal) * 100) / 100
      : 0,
    avgSavingsPerCascade: cascadeTotal > 0
      ? Math.round((avgPremiumCost - avgCheapCost) * cascadeCheapOnly * 1000) / 1000
      : 0,
  };

  // Category average costs
  const categoryAvgCost: Record<string, number> = {};
  for (const [cat, cc] of Object.entries(categoryCosts)) {
    categoryAvgCost[cat] = Math.round((cc.total / cc.count) * 10000) / 10000;
  }

  // Top models by usage
  const topModels = Object.entries(modelCosts)
    .map(([model, mc]) => ({
      model,
      count: mc.count,
      avgCost: Math.round((mc.totalCost / mc.count) * 10000) / 10000,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const rounded = (n: number) => Math.round(n * 1000) / 1000;

  return {
    totalSpawns: rows.length,
    byModel,
    byCategory,
    byMode,
    totalEstimatedCost: rounded(totalEstimatedCost),
    opusCostEstimate: rounded(opusCostEstimate),
    savings: rounded(opusCostEstimate - totalEstimatedCost),
    since,
    daily,
    cascade,
    categoryAvgCost,
    topModels,
  };
}

// --- Learning Loop: Outcome Reporting ---

export type Outcome = "success" | "failure";

/**
 * Report an outcome for a model+category.
 * Updates personal_scores rolling average.
 * Rating 1-5: 1-2 = failure, 3-5 = success.
 */
export function dbReportOutcome(
  model: string,
  category: string,
  rating: number
): void {
  const outcome: Outcome = rating >= 3 ? "success" : "failure";

  // Update personal_scores with running tally
  const existing = db.prepare<
    { successes: number; failures: number; total: number },
    [string, string]
  >(
    `SELECT successes, failures, total FROM personal_scores WHERE model = ? AND category = ?`
  ).get(model, category);

  const successes = (existing?.successes ?? 0) + (outcome === "success" ? 1 : 0);
  const failures = (existing?.failures ?? 0) + (outcome === "failure" ? 1 : 0);
  const total = successes + failures;
  const score = total > 0 ? successes / total : null;

  db.prepare(
    `INSERT OR REPLACE INTO personal_scores (model, category, successes, failures, total, score, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(model, category, successes, failures, total, score);
}

// --- Learning Loop: Personal Scores ---

export interface PersonalScore {
  model: string;
  category: string;
  successRate: number; // 0-1
  total: number;
}

/**
 * Get personal scores for a category (or all categories).
 * Only returns models with at least minSamples feedback entries.
 */
export function dbGetPersonalScores(
  category?: string,
  minSamples = 3
): PersonalScore[] {
  const query = category
    ? `SELECT model, category, score, total FROM personal_scores WHERE category = ? AND total >= ?`
    : `SELECT model, category, score, total FROM personal_scores WHERE total >= ?`;

  const args = category ? [category, minSamples] : [minSamples];

  const rows = db.prepare<
    { model: string; category: string; score: number; total: number },
    any[]
  >(query).all(...args);

  return rows.map((r) => ({
    model: r.model,
    category: r.category,
    successRate: r.score,
    total: r.total,
  }));
}

/**
 * Get personal score for a specific model+category.
 * Returns null if insufficient data (< minSamples).
 */
export function dbGetPersonalScore(
  model: string,
  category: string,
  minSamples = 3
): number | null {
  const row = db.prepare<
    { score: number; total: number },
    [string, string]
  >(
    `SELECT score, total FROM personal_scores WHERE model = ? AND category = ?`
  ).get(model, category);

  if (!row || row.total < minSamples) return null;
  return row.score;
}

// --- Context-Aware Scores ---

/**
 * Report an outcome for a model+category scoped by context tags.
 * Creates/updates one row per (model, category, context_tag).
 */
export function dbReportContextOutcome(
  model: string,
  category: string,
  contextTags: string[],
  rating: number
): void {
  const outcome = rating >= 3 ? "success" : "failure";

  for (const tag of contextTags) {
    const existing = db.prepare<
      { successes: number; failures: number; total: number },
      [string, string, string]
    >(
      `SELECT successes, failures, total FROM context_scores WHERE model = ? AND category = ? AND context_tag = ?`
    ).get(model, category, tag);

    const successes = (existing?.successes ?? 0) + (outcome === "success" ? 1 : 0);
    const failures = (existing?.failures ?? 0) + (outcome === "failure" ? 1 : 0);
    const total = successes + failures;
    const score = total > 0 ? successes / total : null;

    db.prepare(
      `INSERT OR REPLACE INTO context_scores (model, category, context_tag, successes, failures, total, score, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(model, category, tag, successes, failures, total, score);
  }
}

/**
 * Get context-aware score for a model+category given context tags.
 * Returns average score across matching tags, or null if insufficient data.
 */
export function dbGetContextScore(
  model: string,
  category: string,
  contextTags: string[],
  minSamples = 3
): number | null {
  if (!contextTags.length) return null;

  const placeholders = contextTags.map(() => "?").join(",");
  const rows = db.prepare<
    { score: number; total: number },
    any[]
  >(
    `SELECT score, total FROM context_scores
     WHERE model = ? AND category = ? AND context_tag IN (${placeholders}) AND total >= ?`
  ).all(model, category, ...contextTags, minSamples);

  if (rows.length === 0) return null;

  const validScores = rows.filter((r) => r.score != null);
  if (validScores.length === 0) return null;
  return validScores.reduce((sum, r) => sum + r.score, 0) / validScores.length;
}

// --- Batch Queries (avoid N+1 in sort comparators) ---

/**
 * Get all personal scores for a category as a Map.
 * Avoids N+1 queries when sorting large model lists.
 */
export function dbGetPersonalScoreBatch(
  category: string,
  minSamples = 3
): Map<string, number> {
  const rows = db.prepare<
    { model: string; score: number; total: number },
    [string, number]
  >(
    `SELECT model, score, total FROM personal_scores WHERE category = ? AND total >= ?`
  ).all(category, minSamples);

  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.score != null) map.set(r.model, r.score);
  }
  return map;
}

/**
 * Get all context scores for a category + tags as a Map.
 */
export function dbGetContextScoreBatch(
  category: string,
  contextTags: string[],
  minSamples = 3
): Map<string, number> {
  if (!contextTags.length) return new Map();

  const placeholders = contextTags.map(() => "?").join(",");
  const rows = db.prepare<
    { model: string; score: number },
    any[]
  >(
    `SELECT model, AVG(score) as score FROM context_scores
     WHERE category = ? AND context_tag IN (${placeholders}) AND total >= ?
     AND score IS NOT NULL
     GROUP BY model`
  ).all(category, ...contextTags, minSamples);

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.model, r.score);
  }
  return map;
}

/**
 * Get all community scores for a category as a Map.
 */
export function dbGetCommunityScoreBatch(
  category: string,
  minRatings = 10
): Map<string, number> {
  const rows = db.prepare<
    { model: string; avg_rating: number; total_ratings: number },
    [string, number]
  >(
    `SELECT model, avg_rating, total_ratings FROM community_scores WHERE category = ? AND total_ratings >= ?`
  ).all(category, minRatings);

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.model, r.avg_rating / 5); // normalize to 0-1
  }
  return map;
}

// --- Community Rankings ---

export interface CommunityScore {
  model: string;
  category: string;
  totalRatings: number;
  avgRating: number;
  contributors: number;
}

/**
 * Report a community outcome for a model+category.
 * Rate-limited to 100 reports per hour per instance.
 */
export function dbReportCommunityOutcome(
  model: string,
  category: string,
  rating: number,
  instanceId: string
): { recorded: boolean; error?: string } {
  // Rate limiting: 100 per hour per instance
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);
  const windowKey = windowStart.toISOString();

  const rateRow = db.prepare<
    { count: number },
    [string, string]
  >(
    `SELECT count FROM community_rate_limits WHERE instance_id = ? AND window_start = ?`
  ).get(instanceId, windowKey);

  if (rateRow && rateRow.count >= 100) {
    return { recorded: false, error: "Rate limit exceeded (100/hr)" };
  }

  // Update rate limit counter
  db.prepare(
    `INSERT INTO community_rate_limits (instance_id, window_start, count)
     VALUES (?, ?, 1)
     ON CONFLICT(instance_id, window_start) DO UPDATE SET count = count + 1`
  ).run(instanceId, windowKey);

  // Upsert community score
  const existing = db.prepare<
    { total_ratings: number; sum_ratings: number; contributors: number },
    [string, string]
  >(
    `SELECT total_ratings, sum_ratings, contributors FROM community_scores WHERE model = ? AND category = ?`
  ).get(model, category);

  const totalRatings = (existing?.total_ratings ?? 0) + 1;
  const sumRatings = (existing?.sum_ratings ?? 0) + rating;
  const avgRating = sumRatings / totalRatings;
  // Approximate contributor count: increment only on first insert for this (model, category)
  const contributors = existing ? existing.contributors : 1;

  db.prepare(
    `INSERT OR REPLACE INTO community_scores (model, category, total_ratings, sum_ratings, avg_rating, contributors, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(model, category, totalRatings, sumRatings, avgRating, contributors);

  return { recorded: true };
}

/**
 * Get community scores, optionally filtered by category.
 */
export function dbGetCommunityScores(
  category?: string,
  minRatings = 10
): CommunityScore[] {
  const query = category
    ? `SELECT model, category, total_ratings, avg_rating, contributors FROM community_scores WHERE category = ? AND total_ratings >= ? ORDER BY avg_rating DESC`
    : `SELECT model, category, total_ratings, avg_rating, contributors FROM community_scores WHERE total_ratings >= ? ORDER BY avg_rating DESC`;

  const args = category ? [category, minRatings] : [minRatings];

  const rows = db.prepare<
    { model: string; category: string; total_ratings: number; avg_rating: number; contributors: number },
    any[]
  >(query).all(...args);

  return rows.map((r) => ({
    model: r.model,
    category: r.category,
    totalRatings: r.total_ratings,
    avgRating: Math.round(r.avg_rating * 100) / 100,
    contributors: r.contributors,
  }));
}

/**
 * Get community score for a specific model+category.
 * Returns normalized 0-1 score (avg_rating / 5), or null if insufficient data.
 */
export function dbGetCommunityScore(
  model: string,
  category: string,
  minRatings = 10
): number | null {
  const row = db.prepare<
    { avg_rating: number; total_ratings: number },
    [string, string]
  >(
    `SELECT avg_rating, total_ratings FROM community_scores WHERE model = ? AND category = ?`
  ).get(model, category);

  if (!row || row.total_ratings < minRatings) return null;
  return row.avg_rating / 5; // normalize to 0-1
}
