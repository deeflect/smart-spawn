import type { HFLeaderboardEntry, SourceResult } from "../../types.ts";

const HF_API_BASE =
  "https://datasets-server.huggingface.co/rows?dataset=open-llm-leaderboard/contents&config=default&split=train";
const PAGE_SIZE = 100;
const TOTAL_ROWS = 4600; // ~4576, overshoot slightly

export async function pullHFLeaderboard(): Promise<
  SourceResult<HFLeaderboardEntry>
> {
  try {
    const allModels: HFLeaderboardEntry[] = [];

    // Paginate through all rows
    for (let offset = 0; offset < TOTAL_ROWS; offset += PAGE_SIZE) {
      const url = `${HF_API_BASE}&offset=${offset}&length=${PAGE_SIZE}`;
      const res = await fetch(url);

      if (!res.ok) {
        // If we get an error after fetching some rows, warn and stop pagination
        if (allModels.length > 0) {
          console.warn(`[hf-leaderboard] Pagination stopped at offset ${offset} (${res.status}): got ${allModels.length} rows so far, expected ~${TOTAL_ROWS}`);
          break;
        }
        throw new Error(`HF datasets API returned ${res.status}: ${res.statusText}`);
      }

      const json = (await res.json()) as {
        rows: Array<{ row: Record<string, unknown> }>;
        num_rows_total: number;
      };

      const rows = json.rows ?? [];
      if (rows.length === 0) break;

      for (const r of rows) {
        const avg = Number(r.row["Average ⬆️"] ?? r.row["Average"] ?? 0);
        const hasAnyBenchmark =
          avg > 0 ||
          r.row["IFEval"] !== undefined ||
          r.row["BBH"] !== undefined ||
          r.row["MMLU-PRO"] !== undefined;
        if (!hasAnyBenchmark) continue;

        allModels.push({
          Model: String(r.row["fullname"] ?? r.row["Model"] ?? ""),
          Average: avg,
          IFEval: numberOrUndefined(r.row["IFEval"]),
          BBH: numberOrUndefined(r.row["BBH"]),
          "MATH Lvl 5": numberOrUndefined(r.row["MATH Lvl 5"]),
          GPQA: numberOrUndefined(r.row["GPQA"]),
          MUSR: numberOrUndefined(r.row["MUSR"]),
          "MMLU-PRO": numberOrUndefined(r.row["MMLU-PRO"]),
          "#Params (B)": numberOrUndefined(r.row["#Params (B)"]),
          Type: r.row["Type"] as string | undefined,
        });
      }
    }

    console.log(`[hf-leaderboard] Pulled ${allModels.length} entries`);

    return {
      source: "hf-leaderboard",
      data: allModels,
      pulledAt: new Date().toISOString(),
      count: allModels.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[hf-leaderboard] Failed to pull: ${msg}`);
    return {
      source: "hf-leaderboard",
      data: [],
      pulledAt: new Date().toISOString(),
      count: 0,
      error: msg,
    };
  }
}

function numberOrUndefined(val: unknown): number | undefined {
  if (val === null || val === undefined) return undefined;
  const n = Number(val);
  return isNaN(n) ? undefined : n;
}
