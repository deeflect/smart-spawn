import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpConfig } from "../src/config.ts";
import { McpStore } from "../src/db.ts";
import { RuntimeQueue } from "../src/runtime/queue.ts";
import { ArtifactStorage } from "../src/storage.ts";
import type { RunRecord } from "../src/types.ts";

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

class MockSmartSpawnClient {
  async pick() {
    return { modelId: "openai/gpt-4o-mini", reason: "mock pick" };
  }

  async composeRole(task: string) {
    return task;
  }

  async health() {
    return { reachable: true, payload: { ok: true } };
  }
}

class SlowOpenRouterClient {
  async chatCompletion() {
    await Bun.sleep(1500);
    return {
      text: "late output",
      promptTokens: 100,
      completionTokens: 100,
      totalTokens: 200,
    };
  }
}

function buildTestConfig(homeDir: string): McpConfig {
  return {
    openRouterApiKey: "test-key",
    smartSpawnApiUrl: "http://localhost/mock",
    homeDir,
    dbPath: join(homeDir, "db.sqlite"),
    artifactsDir: join(homeDir, "artifacts"),
    maxParallelRuns: 1,
    maxParallelNodesPerRun: 1,
    maxUsdPerRun: 50,
    nodeTimeoutSeconds: 1,
    runTimeoutSeconds: 30,
    pollIntervalMs: 20,
  };
}

async function waitForTerminal(runtime: RuntimeQueue, runId: string, maxMs = 12000): Promise<RunRecord> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const run = runtime.getRun(runId);
    if (!run) throw new Error(`run not found: ${runId}`);
    if (["completed", "failed", "canceled"].includes(run.status)) return run;
    await Bun.sleep(50);
  }
  throw new Error(`Run did not reach terminal state in ${maxMs}ms`);
}

test("run fails when a node exceeds node timeout", async () => {
  const homeDir = mkdtempSync(join(tmpdir(), "smart-spawn-timeout-test-"));
  cleanupDirs.push(homeDir);

  const config = buildTestConfig(homeDir);
  const store = new McpStore(config.dbPath);
  const storage = new ArtifactStorage(config.homeDir, config.artifactsDir);
  const runtime = new RuntimeQueue(
    config,
    store,
    storage,
    new MockSmartSpawnClient() as any,
    new SlowOpenRouterClient() as any
  );

  await runtime.start();
  try {
    const run = await runtime.createRun({
      task: "Return a short answer",
      mode: "single",
      budget: "low",
    });

    const finalRun = await waitForTerminal(runtime, run.id);
    expect(finalRun.status).toBe("failed");

    const events = store.listRecentEvents(run.id, 30);
    expect(events.some((event) => event.message.includes("timed out after 1s"))).toBe(true);
  } finally {
    runtime.stop();
    store.close();
  }
});
