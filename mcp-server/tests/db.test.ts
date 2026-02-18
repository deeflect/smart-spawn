import { expect, test } from "bun:test";
import { McpStore } from "../src/db.ts";

test("McpStore initializes core tables", () => {
  const store = new McpStore(":memory:");
  const run = store.createRun({
    task: "health",
    mode: "single",
    budget: "low",
  });

  expect(run.status).toBe("queued");
  expect(run.id.length).toBeGreaterThan(10);
  store.close();
});
