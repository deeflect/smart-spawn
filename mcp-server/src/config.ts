import { homedir } from "node:os";
import { join } from "node:path";

export interface McpConfig {
  openRouterApiKey: string;
  smartSpawnApiUrl: string;
  homeDir: string;
  dbPath: string;
  artifactsDir: string;
  maxParallelRuns: number;
  maxParallelNodesPerRun: number;
  maxUsdPerRun: number;
  nodeTimeoutSeconds: number;
  runTimeoutSeconds: number;
  pollIntervalMs: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function resolveHomePath(raw: string | undefined): string {
  if (!raw || !raw.trim()) return join(process.cwd(), ".smart-spawn-mcp");
  if (raw.startsWith("~/")) return join(homedir(), raw.slice(2));
  return raw;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const openRouterApiKey = env["OPENROUTER_API_KEY"] ?? "";
  const homeDir = resolveHomePath(env["SMART_SPAWN_MCP_HOME"]);
  const dbPath = join(homeDir, "db.sqlite");
  const artifactsDir = join(homeDir, "artifacts");

  return {
    openRouterApiKey,
    smartSpawnApiUrl: env["SMART_SPAWN_API_URL"] ?? "https://ss.deeflect.com/api",
    homeDir,
    dbPath,
    artifactsDir,
    maxParallelRuns: parsePositiveInt(env["MAX_PARALLEL_RUNS"], 2),
    maxParallelNodesPerRun: parsePositiveInt(env["MAX_PARALLEL_NODES_PER_RUN"], 4),
    maxUsdPerRun: parsePositiveFloat(env["MAX_USD_PER_RUN"], 5),
    nodeTimeoutSeconds: parsePositiveInt(env["NODE_TIMEOUT_SECONDS"], 180),
    runTimeoutSeconds: parsePositiveInt(env["RUN_TIMEOUT_SECONDS"], 1800),
    pollIntervalMs: parsePositiveInt(env["POLL_INTERVAL_MS"], 1200),
  };
}
