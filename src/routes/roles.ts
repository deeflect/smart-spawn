import { Hono } from "hono";
import { composeFromExplicit } from "../roles/composer.ts";
import { PERSONAS, TECH_BLOCKS, DOMAIN_BLOCKS, FORMAT_BLOCKS, GUARDRAILS } from "../roles/blocks.ts";

export const rolesRoute = new Hono();

// GET /roles/blocks — list all available block IDs for SKILL.md reference
rolesRoute.get("/blocks", (c) => {
  return c.json({
    personas: Object.entries(PERSONAS).map(([key, p]) => ({ id: key, title: p.title, core: p.core })),
    stack: Object.entries(TECH_BLOCKS).map(([key, b]) => ({ id: key, instructions: b.instructions.length })),
    domains: Object.entries(DOMAIN_BLOCKS).map(([key, b]) => ({ id: key, instructions: b.instructions.length })),
    formats: Object.entries(FORMAT_BLOCKS).map(([key, b]) => ({ id: key, instructions: b.instructions.length })),
    guardrails: Object.keys(GUARDRAILS),
    counts: {
      personas: Object.keys(PERSONAS).length,
      stack: Object.keys(TECH_BLOCKS).length,
      domains: Object.keys(DOMAIN_BLOCKS).length,
      formats: Object.keys(FORMAT_BLOCKS).length,
      guardrails: Object.keys(GUARDRAILS).length,
    },
  });
});

// POST /roles/compose — agent specifies blocks, API assembles the prompt
rolesRoute.post("/compose", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.task) {
    return c.json({ error: { code: "MISSING_PARAM", message: "task required" } }, 400);
  }

  // Validate types
  if (typeof body.task !== "string" || !body.task.trim()) {
    return c.json({ error: { code: "INVALID_PARAM", message: "task must be a non-empty string" } }, 400);
  }
  if (body.persona !== undefined && typeof body.persona !== "string") {
    return c.json({ error: { code: "INVALID_PARAM", message: "persona must be a string" } }, 400);
  }
  if (body.stack !== undefined && (!Array.isArray(body.stack) || !body.stack.every((s: unknown) => typeof s === "string"))) {
    return c.json({ error: { code: "INVALID_PARAM", message: "stack must be an array of strings" } }, 400);
  }
  if (body.domain !== undefined && typeof body.domain !== "string") {
    return c.json({ error: { code: "INVALID_PARAM", message: "domain must be a string" } }, 400);
  }
  if (body.format !== undefined && typeof body.format !== "string") {
    return c.json({ error: { code: "INVALID_PARAM", message: "format must be a string" } }, 400);
  }
  if (body.guardrails !== undefined && (!Array.isArray(body.guardrails) || !body.guardrails.every((g: unknown) => typeof g === "string"))) {
    return c.json({ error: { code: "INVALID_PARAM", message: "guardrails must be an array of strings" } }, 400);
  }

  // Agent provides explicit block selections — no guessing
  const result = composeFromExplicit({
    task: body.task,
    persona: body.persona,       // e.g. "frontend-engineer"
    stack: body.stack,            // e.g. ["react", "nextjs", "supabase"]
    domain: body.domain,          // e.g. "saas"
    format: body.format,          // e.g. "full-implementation"
    guardrails: body.guardrails,  // e.g. ["code", "security"]
  });

  return c.json(result);
});
