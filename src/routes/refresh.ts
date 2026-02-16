import { Hono } from "hono";
import { pipeline } from "../enrichment/pipeline.ts";

export const refreshRoute = new Hono();

let refreshing = false;

refreshRoute.post("/", async (c) => {
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
