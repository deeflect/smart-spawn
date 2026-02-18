import { expect, test } from "bun:test";
import { listToolNames } from "../src/tools.ts";

test("registers required tool names", () => {
  const names = listToolNames();
  expect(names).toContain("smartspawn_run_create");
  expect(names).toContain("smartspawn_run_status");
  expect(names).toContain("smartspawn_run_result");
  expect(names).toContain("smartspawn_run_cancel");
  expect(names).toContain("smartspawn_run_list");
  expect(names).toContain("smartspawn_artifact_get");
  expect(names).toContain("smartspawn_health");
});
