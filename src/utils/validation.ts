import type { Category, Budget, Tier } from "../types.ts";
import { KNOWN_CATEGORIES } from "../scoring-utils.ts";

const MAX_QUERY_LENGTH = 500;
const MAX_ID_LENGTH = 200;
const MODEL_ID_REGEX = /^[a-zA-Z0-9._:-]+(\/[a-zA-Z0-9._:-]+)?$/;

export function sanitizeText(raw: string | undefined, maxLen = MAX_QUERY_LENGTH): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return null;
  // Strip control characters
  if (/\p{Cc}/u.test(trimmed)) return null;
  return trimmed;
}

export function sanitizeModelId(raw: string | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(/^openrouter\//, "");
  if (!trimmed || trimmed.length > MAX_ID_LENGTH) return null;
  if (!MODEL_ID_REGEX.test(trimmed)) return null;
  return trimmed;
}

export function sanitizeModelIdList(raw: string | undefined, max = 10): string[] | null {
  if (!raw) return [];
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length > max) return null;
  const cleaned: string[] = [];
  for (const part of parts) {
    const id = sanitizeModelId(part);
    if (!id) return null;
    cleaned.push(id);
  }
  return cleaned;
}

export function sanitizeCategory(raw: string | undefined): Category | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return (KNOWN_CATEGORIES.includes(trimmed as Category) ? (trimmed as Category) : null);
}

export function sanitizeTier(raw: string | undefined): Tier | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "premium" || trimmed === "standard" || trimmed === "budget") return trimmed;
  return null;
}

export function sanitizeBudget(raw: string | undefined): Budget | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "low" || trimmed === "medium" || trimmed === "high" || trimmed === "any") return trimmed;
  return null;
}

export function sanitizeCapabilityList(raw: string | undefined): string[] | null {
  if (!raw) return [];
  const allowed = new Set(["vision", "functionCalling", "json", "reasoning"]);
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const cleaned: string[] = [];
  for (const part of parts) {
    if (!allowed.has(part)) return null;
    cleaned.push(part);
  }
  return cleaned;
}

export function sanitizeSort(raw: string | undefined): string {
  if (!raw) return "score";
  const trimmed = raw.trim();
  if (trimmed === "score" || trimmed === "cost" || trimmed === "efficiency") return trimmed;
  if (KNOWN_CATEGORIES.includes(trimmed as Category)) return trimmed;
  return "score";
}
