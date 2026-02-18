import { expect, test } from "bun:test";
import { buildOpenRouterHeaders } from "../src/openrouter-client.ts";

test("buildOpenRouterHeaders includes bearer token", () => {
  const headers = buildOpenRouterHeaders("test-key");
  expect(headers.Authorization).toBe("Bearer test-key");
});
