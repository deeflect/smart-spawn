import type { ArtificialAnalysisModel, SourceResult } from "../../types.ts";

const AA_API = "https://artificialanalysis.ai/api/v2/data/llms/models";

export async function pullArtificialAnalysis(): Promise<
  SourceResult<ArtificialAnalysisModel>
> {
  const apiKey = process.env["ARTIFICIAL_ANALYSIS_API_KEY"];

  if (!apiKey) {
    console.warn(
      "[artificial-analysis] No API key set (ARTIFICIAL_ANALYSIS_API_KEY). Skipping."
    );
    return {
      source: "artificial-analysis",
      data: [],
      pulledAt: new Date().toISOString(),
      count: 0,
      error: "No API key configured",
    };
  }

  try {
    const res = await fetch(AA_API, {
      headers: { "x-api-key": apiKey },
    });

    if (!res.ok) {
      throw new Error(`Artificial Analysis API returned ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as ArtificialAnalysisModel[] | { data: ArtificialAnalysisModel[] };
    const models = Array.isArray(json) ? json : (json.data ?? []);

    return {
      source: "artificial-analysis",
      data: models,
      pulledAt: new Date().toISOString(),
      count: models.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[artificial-analysis] Failed to pull: ${msg}`);
    return {
      source: "artificial-analysis",
      data: [],
      pulledAt: new Date().toISOString(),
      count: 0,
      error: msg,
    };
  }
}
