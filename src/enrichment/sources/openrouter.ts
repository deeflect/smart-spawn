import type { OpenRouterModel, SourceResult } from "../../types.ts";

const OPENROUTER_API = "https://openrouter.ai/api/v1/models";

export async function pullOpenRouter(): Promise<
  SourceResult<OpenRouterModel>
> {
  try {
    const res = await fetch(OPENROUTER_API);
    if (!res.ok) {
      throw new Error(`OpenRouter API returned ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as { data: OpenRouterModel[] };
    const models = json.data ?? [];

    return {
      source: "openrouter",
      data: models,
      pulledAt: new Date().toISOString(),
      count: models.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[openrouter] Failed to pull: ${msg}`);
    return {
      source: "openrouter",
      data: [],
      pulledAt: new Date().toISOString(),
      count: 0,
      error: msg,
    };
  }
}

/** Parse OpenRouter pricing string (per-token USD) to per-1M-token USD */
export function parsePricing(perToken: string, modelId?: string): number {
  const val = parseFloat(perToken);
  if (isNaN(val)) {
    if (modelId) console.warn(`[openrouter] Unparseable pricing "${perToken}" for ${modelId}, defaulting to 0`);
    return 0;
  }
  return val * 1_000_000;
}

/** Extract capabilities from OpenRouter model data */
export function extractCapabilities(model: OpenRouterModel) {
  const params = model.supported_parameters ?? [];
  const inputMods = model.architecture?.input_modalities ?? [];

  return {
    vision: inputMods.includes("image"),
    functionCalling: params.includes("tools"),
    streaming: true, // safe assumption for all OpenRouter models
    json:
      params.includes("structured_outputs") ||
      params.includes("response_format"),
    reasoning:
      params.includes("reasoning") || params.includes("include_reasoning"),
  };
}
