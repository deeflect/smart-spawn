import type { LMArenaEntry, SourceResult } from "../../types.ts";

const RELEASES_API =
  "https://api.github.com/repos/fboulnois/llm-leaderboard-csv/releases/latest";

/**
 * Pull LMArena (Chatbot Arena) ELO scores from daily CSV releases.
 * Source: fboulnois/llm-leaderboard-csv — auto-converts HF pickle → CSV daily.
 * Fetches both text and vision leaderboards and merges them.
 */
export async function pullLMArena(): Promise<SourceResult<LMArenaEntry>> {
  try {
    // Get latest release tag
    const releaseRes = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });

    if (!releaseRes.ok) {
      throw new Error(
        `GitHub releases API returned ${releaseRes.status}: ${releaseRes.statusText}`
      );
    }

    const release = (await releaseRes.json()) as { tag_name: string };
    const version = release.tag_name;
    console.log(`[lmarena] Latest release: ${version}`);

    // Fetch text and vision CSVs in parallel
    const [textEntries, visionEntries] = await Promise.all([
      fetchCSV(version, "text"),
      fetchCSV(version, "vision"),
    ]);

    // Merge: text entries take priority, vision adds models not in text
    const byName = new Map<string, LMArenaEntry>();
    for (const entry of textEntries) {
      byName.set(entry.model.toLowerCase(), entry);
    }
    for (const entry of visionEntries) {
      const key = entry.model.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, entry);
      }
    }

    const merged = Array.from(byName.values());
    console.log(
      `[lmarena] Pulled ${textEntries.length} text + ${visionEntries.length} vision = ${merged.length} unique models`
    );

    return {
      source: "lmarena",
      data: merged,
      pulledAt: new Date().toISOString(),
      count: merged.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[lmarena] Failed to pull: ${msg}`);
    return {
      source: "lmarena",
      data: [],
      pulledAt: new Date().toISOString(),
      count: 0,
      error: msg,
    };
  }
}

async function fetchCSV(
  version: string,
  category: "text" | "vision"
): Promise<LMArenaEntry[]> {
  const url = `https://github.com/fboulnois/llm-leaderboard-csv/releases/download/${version}/lmarena_${category}.csv`;
  const res = await fetch(url);

  if (!res.ok) {
    console.warn(
      `[lmarena] Failed to fetch ${category} CSV: ${res.status} ${res.statusText}`
    );
    return [];
  }

  const text = await res.text();
  return parseCSV(text);
}

function parseCSV(csv: string): LMArenaEntry[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  // Skip header row
  const entries: LMArenaEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 8) continue;

    const arenaScore = parseInt(fields[3], 10);
    if (isNaN(arenaScore)) continue;

    entries.push({
      rank: parseInt(fields[0], 10) || 0,
      rankStyleCtrl: parseInt(fields[1], 10) || 0,
      model: fields[2],
      arenaScore,
      confidenceInterval: fields[4],
      votes: parseInt(fields[5], 10) || 0,
      organization: fields[6],
      license: fields[7],
    });
  }

  return entries;
}

/** Parse a CSV line handling quoted fields (model names can contain commas in parens) */
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
