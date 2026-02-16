import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { modelsRoute } from "./routes/models.ts";
import { recommendRoute } from "./routes/recommend.ts";
import { pickRoute } from "./routes/pick.ts";
import { statusRoute } from "./routes/status.ts";
import { refreshRoute } from "./routes/refresh.ts";
import { spawnLogRoute } from "./routes/spawn-log.ts";
import { decomposeRoute } from "./routes/decompose.ts";
import { swarmRoute } from "./routes/swarm.ts";
import { communityRoute } from "./routes/community.ts";
import { rolesRoute } from "./routes/roles.ts";
import { pipeline } from "./enrichment/pipeline.ts";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// Routes
app.route("/models", modelsRoute);
app.route("/recommend", recommendRoute);
app.route("/pick", pickRoute);
app.route("/status", statusRoute);
app.route("/refresh", refreshRoute);
app.route("/spawn-log", spawnLogRoute);
app.route("/decompose", decomposeRoute);
app.route("/swarm", swarmRoute);
app.route("/community", communityRoute);
app.route("/roles", rolesRoute);

// Root
app.get("/", (c) =>
  c.json({
    data: {
      name: "Model Intelligence API",
      version: "1.0.0",
      endpoints: ["/models", "/recommend", "/pick", "/decompose", "/swarm", "/community", "/status", "/refresh", "/spawn-log"],
    },
  })
);

// Startup: load cache, then refresh in background
const port = parseInt(process.env["PORT"] ?? "3000", 10);

console.log(`Loading cached data...`);
await pipeline.loadFromCache();

console.log(`Starting server on port ${port}`);
const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  fetch: (req: Request, server: any) => app.fetch(req),
});
console.log(`Server listening on http://0.0.0.0:${server.port}`);

// Background refresh on startup, then start 6h timer
console.log(`Starting background refresh...`);
pipeline.refresh().then(() => {
  console.log(
    `Background refresh complete. ${pipeline.getState().models.length} models loaded.`
  );
  pipeline.startRefreshTimer();
});
