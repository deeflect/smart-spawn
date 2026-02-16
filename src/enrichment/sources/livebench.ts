import type { SourceResult } from "../../types.ts";

/**
 * LiveBench data source — fetches pre-aggregated leaderboard CSV from livebench.ai.
 *
 * The website serves static CSV files at livebench.ai/table_{date}.csv with
 * per-model, per-task scores (0-100) for ~70 current-gen models.
 * Categories JSON at livebench.ai/categories_{date}.json maps tasks → categories.
 *
 * 7 categories: Reasoning, Coding, Agentic Coding, Mathematics, Data Analysis, Language, IF
 * 23 tasks across those categories.
 *
 * To find the latest CSV date, we check the GitHub repo's public/ directory.
 */

const GITHUB_CONTENTS_API =
  "https://api.github.com/repos/LiveBench/livebench.github.io/contents/public";
const SITE_BASE = "https://livebench.ai";

export interface LiveBenchEntry {
  model: string;
  coding?: number; // Average of code_generation + code_completion (0-100)
  agenticCoding?: number; // Average of javascript + typescript + python (0-100)
  reasoning?: number; // Average of theory_of_mind + zebra_puzzle + spatial + logic_with_navigation
  mathematics?: number; // Average of AMPS_Hard + integrals_with_game + math_comp + olympiad
  dataAnalysis?: number; // Average of consecutive_events + tablejoin + tablereformat
  language?: number; // Average of connections + plot_unscrambling + typos
  instructionFollowing?: number; // Average of paraphrase + simplify + story_generation + summarize
  overall?: number; // Average across all categories
}

// Default category mapping (matches livebench.ai categories JSON)
const DEFAULT_CATEGORIES: Record<string, string[]> = {
  Reasoning: [
    "theory_of_mind",
    "zebra_puzzle",
    "spatial",
    "logic_with_navigation",
  ],
  Coding: ["code_generation", "code_completion"],
  "Agentic Coding": ["javascript", "typescript", "python"],
  Mathematics: ["AMPS_Hard", "integrals_with_game", "math_comp", "olympiad"],
  "Data Analysis": ["consecutive_events", "tablejoin", "tablereformat"],
  Language: ["connections", "plot_unscrambling", "typos"],
  IF: ["paraphrase", "simplify", "story_generation", "summarize"],
};

export async function pullLiveBench(): Promise<SourceResult<LiveBenchEntry>> {
  try {
    // Find the latest CSV date from GitHub
    const latestDate = await findLatestDate();
    if (!latestDate) {
      throw new Error("Could not find any LiveBench CSV files");
    }

    console.log(`[livebench] Latest data: ${latestDate}`);

    // Fetch CSV and categories in parallel
    const [csvText, categories] = await Promise.all([
      fetchText(`${SITE_BASE}/table_${latestDate}.csv`),
      fetchCategories(latestDate),
    ]);

    const entries = parseCSV(csvText, categories);

    console.log(`[livebench] Parsed ${entries.length} models from CSV`);

    return {
      source: "livebench",
      data: entries,
      pulledAt: new Date().toISOString(),
      count: entries.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[livebench] Failed to pull: ${msg}`);
    return {
      source: "livebench",
      data: [],
      pulledAt: new Date().toISOString(),
      count: 0,
      error: msg,
    };
  }
}

/** Find the latest table_*.csv date from GitHub repo contents */
async function findLatestDate(): Promise<string | null> {
  try {
    const res = await fetch(GITHUB_CONTENTS_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });

    if (!res.ok) {
      console.warn(
        `[livebench] GitHub contents API returned ${res.status}, trying known dates`
      );
      return tryKnownDates();
    }

    const files = (await res.json()) as Array<{ name: string }>;
    const dates: string[] = [];

    for (const f of files) {
      const match = f.name.match(/^table_(\d{4}_\d{2}_\d{2})\.csv$/);
      if (match) dates.push(match[1]);
    }

    if (dates.length === 0) return tryKnownDates();

    // Sort descending, return latest
    dates.sort().reverse();
    return dates[0];
  } catch {
    return tryKnownDates();
  }
}

/** Try known dates as fallback if GitHub API fails */
async function tryKnownDates(): Promise<string | null> {
  // Try recent dates, newest first
  const candidates = generateRecentDates();

  for (const date of candidates) {
    try {
      const res = await fetch(`${SITE_BASE}/table_${date}.csv`, {
        method: "HEAD",
      });
      if (res.ok) return date;
    } catch {
      continue;
    }
  }

  return null;
}

/** Generate candidate dates for the last 6 months */
function generateRecentDates(): string[] {
  const dates: string[] = [];
  const now = new Date();

  for (let i = 0; i < 180; i += 7) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    dates.push(`${y}_${m}_${day}`);
  }

  return dates;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function fetchCategories(
  date: string
): Promise<Record<string, string[]>> {
  try {
    const res = await fetch(`${SITE_BASE}/categories_${date}.json`);
    if (!res.ok) return DEFAULT_CATEGORIES;
    return (await res.json()) as Record<string, string[]>;
  } catch {
    return DEFAULT_CATEGORIES;
  }
}

function parseCSV(
  csv: string,
  categories: Record<string, string[]>
): LiveBenchEntry[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  // Parse header
  const headers = parseCSVLine(lines[0]);
  const modelIdx = headers.indexOf("model");
  if (modelIdx === -1) return [];

  // Build task → column index mapping
  const taskIndices = new Map<string, number>();
  for (const [_cat, tasks] of Object.entries(categories)) {
    for (const task of tasks) {
      const idx = headers.indexOf(task);
      if (idx !== -1) taskIndices.set(task, idx);
    }
  }

  // Build reverse mapping: task → category name
  const taskToCategory = new Map<string, string>();
  for (const [cat, tasks] of Object.entries(categories)) {
    for (const task of tasks) {
      taskToCategory.set(task, cat);
    }
  }

  const entries: LiveBenchEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length <= modelIdx) continue;

    const model = fields[modelIdx].trim();
    if (!model) continue;

    // Collect scores per category
    const catScores = new Map<string, number[]>();

    for (const [task, idx] of taskIndices) {
      if (idx >= fields.length) continue;
      const val = parseFloat(fields[idx]);
      if (isNaN(val)) continue;

      const cat = taskToCategory.get(task);
      if (!cat) continue;

      let scores = catScores.get(cat);
      if (!scores) {
        scores = [];
        catScores.set(cat, scores);
      }
      scores.push(val);
    }

    // Average per category
    const coding = avgOrUndef(catScores.get("Coding"));
    const agenticCoding = avgOrUndef(catScores.get("Agentic Coding"));
    const reasoning = avgOrUndef(catScores.get("Reasoning"));
    const mathematics = avgOrUndef(catScores.get("Mathematics"));
    const dataAnalysis = avgOrUndef(catScores.get("Data Analysis"));
    const language = avgOrUndef(catScores.get("Language"));
    const instructionFollowing = avgOrUndef(catScores.get("IF"));

    const allCats = [
      coding,
      agenticCoding,
      reasoning,
      mathematics,
      dataAnalysis,
      language,
      instructionFollowing,
    ].filter((s): s is number => s !== undefined);
    const overall = allCats.length > 0 ? mean(allCats) : undefined;

    entries.push({
      model,
      coding: round1(coding),
      agenticCoding: round1(agenticCoding),
      reasoning: round1(reasoning),
      mathematics: round1(mathematics),
      dataAnalysis: round1(dataAnalysis),
      language: round1(language),
      instructionFollowing: round1(instructionFollowing),
      overall: round1(overall),
    });
  }

  entries.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  return entries;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function mean(arr: number[]): number {
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function avgOrUndef(arr: number[] | undefined): number | undefined {
  if (!arr || arr.length === 0) return undefined;
  return mean(arr);
}

function round1(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  return Math.round(v * 10) / 10;
}
