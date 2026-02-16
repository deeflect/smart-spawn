import type { Category, EnrichedModel, Tier } from "../types.ts";

/** Classify tier based on provider and pricing */
export function classifyTier(
  provider: string,
  promptPricePerMillion: number
): Tier {
  // Premium providers at premium prices
  const premiumProviders = ["anthropic", "openai", "google", "x-ai"];
  if (premiumProviders.includes(provider) && promptPricePerMillion >= 2) {
    return "premium";
  }

  // Budget: very cheap models
  if (promptPricePerMillion < 0.5) {
    return "budget";
  }

  // Standard: everything else
  if (promptPricePerMillion < 5) {
    return "standard";
  }

  return "premium";
}

/** Derive categories from capabilities, pricing, and benchmarks */
export function deriveCategories(model: EnrichedModel): Category[] {
  const cats: Set<Category> = new Set();

  // Always add general
  cats.add("general");

  // Vision
  if (model.capabilities.vision) {
    cats.add("vision");
  }

  // Fast-cheap: low pricing
  if (model.pricing.prompt < 1) {
    cats.add("fast-cheap");
  }

  // Research: long context
  if (model.contextLength >= 100_000) {
    cats.add("research");
  }

  // Coding: from benchmarks or known providers
  if (
    model.benchmarks?.codingIndex &&
    model.benchmarks.codingIndex >= 50
  ) {
    cats.add("coding");
  }

  // Reasoning: from benchmarks or reasoning capability
  if (model.capabilities.reasoning) {
    cats.add("reasoning");
  }
  if (
    model.benchmarks?.intelligenceIndex &&
    model.benchmarks.intelligenceIndex >= 60
  ) {
    cats.add("reasoning");
  }

  // Creative: premium general-purpose models tend to be good at creative tasks
  if (model.tier === "premium" && !model.capabilities.reasoning) {
    cats.add("creative");
  }

  return Array.from(cats);
}

/** Derive tags from model properties */
export function deriveTags(model: EnrichedModel): string[] {
  const tags: string[] = [];

  if (model.contextLength >= 100_000) tags.push("long-context");
  if (model.capabilities.vision) tags.push("multimodal");
  if (model.capabilities.reasoning) tags.push("reasoning");
  if (model.capabilities.functionCalling) tags.push("tool-use");
  if (model.capabilities.json) tags.push("structured-output");
  if (model.pricing.prompt < 0.5) tags.push("cheap");

  // Speed tags from Artificial Analysis data
  if (model.speed?.outputTokensPerSecond) {
    if (model.speed.outputTokensPerSecond >= 100) tags.push("fast");
    if (model.speed.outputTokensPerSecond < 30) tags.push("slow");
  }

  return tags;
}
