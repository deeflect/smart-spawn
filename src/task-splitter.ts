import type { Budget, Category } from "./types.ts";
import { classifyTask } from "./scoring-utils.ts";

// --- Types ---

export type SplitMethod = "numbered" | "bullets" | "conjunctions" | "semicolons" | "paragraphs" | "none";

export interface Subtask {
  step: number;
  task: string;
  category: Category;
  budget: Budget;
}

export interface SplitResult {
  subtasks: Subtask[];
  method: SplitMethod;
}

// --- Budget adjustment based on subtask keywords ---

const DOWNGRADE_KEYWORDS = ["simple", "quick", "boilerplate", "trivial", "basic", "straightforward", "easy"];
const UPGRADE_KEYWORDS = ["critical", "complex", "architecture", "security", "performance", "optimize", "core"];

export function adjustBudget(subtask: string, defaultBudget: Budget): Budget {
  const lower = subtask.toLowerCase();
  const budgetOrder: Budget[] = ["low", "medium", "high"];

  const hasDowngrade = DOWNGRADE_KEYWORDS.some((kw) => lower.includes(kw));
  const hasUpgrade = UPGRADE_KEYWORDS.some((kw) => lower.includes(kw));

  if (hasDowngrade && !hasUpgrade) {
    const idx = budgetOrder.indexOf(defaultBudget);
    return idx > 0 ? budgetOrder[idx - 1] : defaultBudget;
  }
  if (hasUpgrade && !hasDowngrade) {
    const idx = budgetOrder.indexOf(defaultBudget);
    return idx < budgetOrder.length - 1 ? budgetOrder[idx + 1] : defaultBudget;
  }

  return defaultBudget;
}

// --- Subtask text cleaning ---

export function cleanSubtaskText(text: string): string {
  // Remove trailing conjunctions left over from splitting
  return text.replace(/\s+(?:and|or|but)\s*$/i, "").trim();
}

// --- Build subtask objects ---

export function buildSubtasks(parts: string[], defaultBudget: Budget): Subtask[] {
  return parts.map((raw, i) => {
    const task = cleanSubtaskText(raw);
    return {
      step: i + 1,
      task,
      category: classifyTask(task),
      budget: adjustBudget(task, defaultBudget),
    };
  });
}

// --- Heuristic task splitting ---

export function splitTask(text: string, defaultBudget: Budget): SplitResult {
  const trimmed = text.trim();

  // Priority 1: Numbered lists (e.g. "1. Do X\n2. Do Y")
  const numberedPattern = /^\s*\d+[\.\)]\s+/m;
  if (numberedPattern.test(trimmed)) {
    const parts = trimmed
      .split(/^\s*\d+[\.\)]\s+/m)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) return { subtasks: buildSubtasks(parts, defaultBudget), method: "numbered" };
  }

  // Priority 2: Bullet lists (-, *, bullet)
  const bulletPattern = /^\s*[-*\u2022]\s+/m;
  if (bulletPattern.test(trimmed)) {
    const parts = trimmed
      .split(/^\s*[-*\u2022]\s+/m)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) return { subtasks: buildSubtasks(parts, defaultBudget), method: "bullets" };
  }

  // Priority 3: Sequential conjunctions ("then", "next", "finally", "after that")
  const conjunctionPattern = /\b(?:then|next|finally|after that|afterwards|lastly|first|second|third)\b/i;
  if (conjunctionPattern.test(trimmed)) {
    const parts = trimmed
      .split(/\b(?:,?\s*then\s+|,?\s*next\s+|,?\s*finally\s+|,?\s*after that\s+|,?\s*afterwards\s+|,?\s*lastly\s+)\b/i)
      .map((s) => s.replace(/^\s*(?:first|second|third)\s*,?\s*/i, "").trim())
      .filter((s) => s.length > 0);
    if (parts.length >= 2) return { subtasks: buildSubtasks(parts, defaultBudget), method: "conjunctions" };
  }

  // Priority 4: Semicolons
  if (trimmed.includes(";")) {
    const parts = trimmed.split(";").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { subtasks: buildSubtasks(parts, defaultBudget), method: "semicolons" };
  }

  // Priority 5: Paragraph breaks (double newline)
  if (/\n\s*\n/.test(trimmed)) {
    const parts = trimmed.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { subtasks: buildSubtasks(parts, defaultBudget), method: "paragraphs" };
  }

  // Fallback: no split
  return { subtasks: [], method: "none" };
}
