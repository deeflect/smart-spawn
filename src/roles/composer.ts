/**
 * Role Composer v4 — pure assembly, no detection.
 * 
 * The agent tells us what blocks it wants. We assemble them.
 * If the agent doesn't specify anything, we return null (no role prompt).
 */

import {
  PERSONAS, TECH_BLOCKS, DOMAIN_BLOCKS, FORMAT_BLOCKS, GUARDRAILS,
} from "./blocks.ts";

export interface ComposeInput {
  task: string;
  persona?: string;
  stack?: string[];
  domain?: string;
  format?: string;
  guardrails?: string[];
}

export interface ComposeResult {
  hasRole: boolean;
  persona: string | null;
  personaTitle: string | null;
  stack: string[];
  domain: string | null;
  format: string | null;
  guardrails: string[];
  wordCount: number;
  fullPrompt: string;
  warnings?: string[];
}

/** Build warnings for any requested IDs that didn't resolve to valid blocks */
function buildWarnings(
  input: ComposeInput,
  resolved?: {
    persona: any;
    validStack: string[];
    domainBlock: any;
    formatBlock: any;
    validGuardrails: string[];
  }
): string[] | undefined {
  const warnings: string[] = [];

  if (input.persona && !resolved?.persona) {
    warnings.push(`Unknown persona: "${input.persona}"`);
  }
  if (input.stack?.length) {
    const invalid = input.stack.filter((s) => !resolved?.validStack?.includes(s));
    if (invalid.length > 0) {
      warnings.push(`Unknown stack blocks: ${invalid.map(s => `"${s}"`).join(", ")}`);
    }
  }
  if (input.domain && !resolved?.domainBlock) {
    warnings.push(`Unknown domain: "${input.domain}"`);
  }
  if (input.format && !resolved?.formatBlock) {
    warnings.push(`Unknown format: "${input.format}"`);
  }
  if (input.guardrails?.length) {
    const invalid = input.guardrails.filter((g) => !resolved?.validGuardrails?.includes(g));
    if (invalid.length > 0) {
      warnings.push(`Unknown guardrails: ${invalid.map(g => `"${g}"`).join(", ")}`);
    }
  }

  return warnings.length > 0 ? warnings : undefined;
}

export function composeFromExplicit(input: ComposeInput): ComposeResult {
  const { task, persona, stack, domain, format, guardrails } = input;

  // If agent specified nothing, return task as-is — no role wrapping
  const hasAnything = persona || (stack && stack.length > 0) || domain || format || (guardrails && guardrails.length > 0);

  if (!hasAnything) {
    return {
      hasRole: false,
      persona: null,
      personaTitle: null,
      stack: [],
      domain: null,
      format: null,
      guardrails: [],
      wordCount: task.split(/\s+/).length,
      fullPrompt: task,
    };
  }

  const sections: string[] = [];

  // 1. Persona
  const personaData = persona ? PERSONAS[persona] : null;
  if (personaData) {
    sections.push(`## Role: ${personaData.title}\n${personaData.core}`);
  }

  // 2. Stack — assemble instructions from specified tech blocks (cap at 10)
  const validStack: string[] = [];
  if (stack && stack.length > 0) {
    const techInstructions: string[] = [];
    const techNotes: string[] = [];

    for (const key of stack) {
      const block = TECH_BLOCKS[key];
      if (block) {
        validStack.push(key);
        techInstructions.push(...block.instructions);
        if (block.techNotes) techNotes.push(block.techNotes);
      }
    }

    if (techInstructions.length > 0) {
      sections.push(`### Stack\n${techInstructions.slice(0, 10).map(i => `- ${i}`).join("\n")}`);
    }
    if (techNotes.length > 0) {
      sections.push(`> ${techNotes.join(" ")}`);
    }
  }

  // 3. Domain
  const domainBlock = domain ? DOMAIN_BLOCKS[domain] : null;
  if (domainBlock) {
    sections.push(`### Domain\n${domainBlock.instructions.map(i => `- ${i}`).join("\n")}`);
  }

  // 4. Format
  const formatBlock = format ? FORMAT_BLOCKS[format] : null;
  if (formatBlock) {
    sections.push(`### Output\n${formatBlock.instructions.map(i => `- ${i}`).join("\n")}`);
  }

  // 5. Guardrails (cap at 6)
  const validGuardrails: string[] = [];
  if (guardrails && guardrails.length > 0) {
    const allRails: string[] = [];
    for (const key of guardrails) {
      const rules = GUARDRAILS[key];
      if (rules) {
        validGuardrails.push(key);
        allRails.push(...rules);
      }
    }
    if (allRails.length > 0) {
      sections.push(`### Rules\n${allRails.slice(0, 6).map(r => `- ${r}`).join("\n")}`);
    }
  }

  // 6. Style
  if (personaData) {
    sections.push(`Style: ${personaData.style}`);
  }

  // If nothing actually resolved (all IDs invalid), treat as no role
  if (sections.length === 0) {
    return {
      hasRole: false,
      persona: null,
      personaTitle: null,
      stack: [],
      domain: null,
      format: null,
      guardrails: [],
      wordCount: task.split(/\s+/).length,
      fullPrompt: task,
      warnings: buildWarnings(input),
    };
  }

  // Assemble
  const rolePrompt = sections.join("\n\n");
  const fullPrompt = `${rolePrompt}\n\n---\n\n## Task\n\n${task}`;

  return {
    hasRole: true,
    persona: persona ?? null,
    personaTitle: personaData?.title ?? null,
    stack: validStack,
    domain: domainBlock ? domain! : null,
    format: formatBlock ? format! : null,
    guardrails: validGuardrails,
    wordCount: rolePrompt.split(/\s+/).length,
    fullPrompt,
    warnings: buildWarnings(input, { persona: personaData, validStack, domainBlock, formatBlock, validGuardrails }),
  };
}
