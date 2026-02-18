import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";
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
import { compareRoute } from "./routes/compare.ts";
import { pipeline } from "./enrichment/pipeline.ts";
import { rateLimit } from "./middleware/rate-limit.ts";
import { responseCache } from "./middleware/response-cache.ts";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", bodyLimit({ maxSize: 1024 * 1024 }));
app.use("*", async (c, next) => {
  const origin = c.req.header("origin") ?? "";
  if (origin) {
    console.log(`[cors] origin=${origin}`);
  }
  await next();
});
app.use("*", cors());
app.use("*", rateLimit({ windowMs: 60 * 1000, max: 200 }));
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");

  const url = new URL(c.req.url);
  const path = url.pathname;
  const isGet = c.req.method === "GET";
  const cleanPath = path.replace(/^\/api/, "");
  if (cleanPath.startsWith("/refresh") || cleanPath.startsWith("/spawn-log")) {
    c.header("Cache-Control", "no-store");
  } else if (isGet && ["/models", "/pick", "/recommend", "/compare", "/status"].includes(cleanPath)) {
    c.header("Cache-Control", "public, max-age=300");
  }
});
app.use(
  "*",
  responseCache({
    ttlMs: 60 * 1000,
    paths: ["/models", "/pick", "/recommend", "/compare", "/status"],
  })
);

// API routes under /api
const api = new Hono();
api.route("/models", modelsRoute);
api.route("/recommend", recommendRoute);
api.route("/pick", pickRoute);
api.route("/status", statusRoute);
api.route("/compare", compareRoute);
api.route("/refresh", refreshRoute);
api.route("/spawn-log", spawnLogRoute);
api.route("/decompose", decomposeRoute);
api.route("/swarm", swarmRoute);
api.route("/community", communityRoute);
api.route("/roles", rolesRoute);

api.get("/", (c) =>
  c.json({
    data: {
      name: "Model Intelligence API",
      version: "1.0.0",
      endpoints: [
        "/api/models",
        "/api/recommend",
        "/api/pick",
        "/api/compare",
        "/api/decompose",
        "/api/swarm",
        "/api/community",
        "/api/roles/blocks",
        "/api/roles/compose",
        "/api/status",
        "/api/refresh",
        "/api/spawn-log",
      ],
    },
  })
);

app.route("/api", api);

// Legacy: also mount at root for backwards compat
app.route("/models", modelsRoute);
app.route("/recommend", recommendRoute);
app.route("/pick", pickRoute);
app.route("/status", statusRoute);
app.route("/compare", compareRoute);
app.route("/refresh", refreshRoute);
app.route("/spawn-log", spawnLogRoute);
app.route("/decompose", decomposeRoute);
app.route("/swarm", swarmRoute);
app.route("/community", communityRoute);
app.route("/roles", rolesRoute);

// Root — landing page will go here eventually
app.get("/", (c) =>
  c.json({
    data: {
      name: "Smart Spawn",
      version: "1.0.0",
      api: "/api",
      docs: "https://github.com/deeflect/smart-spawn",
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
