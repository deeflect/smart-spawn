import { expect, test } from "bun:test";
import { shouldStopForBudget } from "../src/runtime/executor.ts";

test("stops run when estimated cost exceeds max", () => {
  expect(shouldStopForBudget({ spentUsd: 5.1, maxUsd: 5 })).toBe(true);
  expect(shouldStopForBudget({ spentUsd: 4.9, maxUsd: 5 })).toBe(false);
});
