import { Hono } from "hono";
import { pipeline } from "../enrichment/pipeline.ts";
import { rateLimit } from "../middleware/rate-limit.ts";

export const refreshRoute = new Hono();

let refreshing = false;

refreshRoute.use("*", rateLimit({ windowMs: 60 * 60 * 1000, max: 2 }));

refreshRoute.post("/", async (c) => {
  const apiKey = process.env["REFRESH_API_KEY"];
  if (apiKey) {
    const auth = c.req.header("authorization") ?? "";
    const expected = `Bearer ${apiKey}`;
    if (auth !== expected) {
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid or missing refresh API key" } },
        401
      );
    }
  }
  if (refreshing) {
    return c.json({
      data: { started: false, message: "Refresh already in progress" },
    });
  }

  refreshing = true;

  // Run refresh in background, respond immediately
  pipeline
    .refresh()
    .catch((e) => console.error("[refresh] Failed:", e))
    .finally(() => {
      refreshing = false;
    });

  return c.json({
    data: { started: true, estimatedSeconds: 30 },
  });
});
