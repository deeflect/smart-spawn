import { Hono } from "hono";
import type { Budget } from "../types.ts";
import { parseContextTags } from "../context-signals.ts";
import { splitTask } from "../task-splitter.ts";
import { pickBestModel } from "../model-selection.ts";

export const decomposeRoute = new Hono();

decomposeRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.task) {
    return c.json(
      { error: { code: "MISSING_PARAM", message: "task field is required in request body" } },
      400
    );
  }

  const task: string = body.task;
  const budget: Budget = body.budget ?? "medium";
  const context: string | undefined = body.context;
  const contextTags = parseContextTags(context);

  const { subtasks } = splitTask(task, budget);

  // If no split detected, signal fallback to single mode
  if (subtasks.length === 0) {
    return c.json({ decomposed: false, reason: "Task does not appear to have multiple steps" });
  }

  // Pick a model for each subtask
  const steps = subtasks.map((st) => {
    const pick = pickBestModel(st.category, st.budget, contextTags);
    return {
      step: st.step,
      task: st.task,
      category: st.category,
      budget: st.budget,
      model: pick
        ? { id: pick.id, name: pick.name, provider: pick.provider, score: pick.score, pricing: pick.pricing }
        : null,
      reason: pick?.reason ?? `No model found for ${st.category} at ${st.budget} budget`,
    };
  });

  return c.json({
    decomposed: true,
    totalSteps: steps.length,
    steps,
    originalTask: task,
    context: context ?? null,
  });
});
