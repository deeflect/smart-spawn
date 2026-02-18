import { expect, test } from "bun:test";
import { buildSinglePlan } from "../src/runtime/planner.ts";

test("buildSinglePlan creates exactly one node in fallback mode", async () => {
  const plan = await buildSinglePlan(
    { task: "Write a test", mode: "single", budget: "medium" },
    undefined
  );
  expect(plan.nodes.length).toBe(1);
  expect(plan.nodes[0]?.kind).toBe("task");
});
