import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ArtifactStorage } from "../src/storage.ts";
import { McpStore } from "../src/db.ts";
import { RuntimeQueue } from "../src/runtime/queue.ts";
import { registerToolHandlers } from "../src/tools.ts";
import type { McpConfig } from "../src/config.ts";

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

class MockSmartSpawnClient {
  async pick(params: { task: string; budget?: string; context?: string; exclude?: string[] }) {
    const budget = params.budget ?? "medium";
    if (budget === "low") {
      return { modelId: "openai/gpt-4o-mini", reason: "cheap pick" };
    }
    if ((params.exclude ?? []).includes("anthropic/claude-sonnet-4")) {
      return { modelId: "openai/gpt-4o", reason: "alternate pick" };
    }
    return { modelId: "anthropic/claude-sonnet-4", reason: "default pick" };
  }

  async recommend(params: { count?: number }) {
    const count = Math.max(1, Math.min(params.count ?? 3, 5));
    const models = [
      "openai/gpt-4o-mini",
      "anthropic/claude-sonnet-4",
      "google/gemini-2.5-pro",
      "openai/gpt-4o",
      "meta-llama/llama-3.3-70b-instruct",
    ];
    return models.slice(0, count).map((modelId, idx) => ({
      modelId,
      reason: `recommend-${idx + 1}`,
    }));
  }

  async decompose(params: { task: string }) {
    if (!params.task.toLowerCase().includes(" and ")) {
      return { decomposed: false, steps: [] };
    }
    return {
      decomposed: true,
      steps: [
        {
          id: "step-1",
          task: "Design API contracts",
          modelId: "anthropic/claude-sonnet-4",
          wave: 0,
          dependsOn: [],
          reason: "step-1",
        },
        {
          id: "step-2",
          task: "Implement API handlers",
          modelId: "openai/gpt-4o-mini",
          wave: 1,
          dependsOn: ["step-1"],
          reason: "step-2",
        },
      ],
    };
  }

  async swarm() {
    return {
      decomposed: true,
      tasks: [
        {
          id: "swarm-1",
          task: "Create backend service",
          modelId: "anthropic/claude-sonnet-4",
          wave: 0,
          dependsOn: [],
          reason: "backend",
        },
        {
          id: "swarm-2",
          task: "Create frontend service",
          modelId: "openai/gpt-4o-mini",
          wave: 0,
          dependsOn: [],
          reason: "frontend",
        },
        {
          id: "swarm-3",
          task: "Write integration tests",
          modelId: "openai/gpt-4o",
          wave: 1,
          dependsOn: ["swarm-1", "swarm-2"],
          reason: "tests",
        },
      ],
    };
  }

  async composeRole(task: string) {
    return task;
  }

  async health() {
    return { reachable: true, payload: { ok: true } };
  }
}

class MockOpenRouterClient {
  private calls = 0;

  async chatCompletion(input: { model: string; messages: Array<{ role: string; content: string }> }) {
    this.calls += 1;
    const prompt = input.messages.map((m) => m.content).join("\n");
    const isMerge = prompt.includes("You are merging outputs");

    await Bun.sleep(8);

    return {
      text: isMerge
        ? `Merged final answer from ${input.model}.`
        : `Node answer ${this.calls} from ${input.model}.`,
      promptTokens: 120 + this.calls,
      completionTokens: 80 + this.calls,
      totalTokens: 200 + this.calls * 2,
    };
  }
}

function parseToolPayload(result: any): any {
  const text = result?.content?.find((part: any) => part?.type === "text")?.text;
  expect(typeof text).toBe("string");
  return JSON.parse(text);
}

async function waitForRunCompletion(client: Client, runId: string, maxMs = 5000): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const statusResult = await client.callTool({
      name: "smartspawn_run_status",
      arguments: { run_id: runId },
    });
    const payload = parseToolPayload(statusResult);
    if (["completed", "failed", "canceled"].includes(payload.status)) {
      return payload;
    }
    await Bun.sleep(40);
  }
  throw new Error(`Run did not complete in ${maxMs}ms`);
}

function buildTestConfig(homeDir: string): McpConfig {
  return {
    openRouterApiKey: "test-key",
    smartSpawnApiUrl: "http://localhost/mock",
    homeDir,
    dbPath: join(homeDir, "db.sqlite"),
    artifactsDir: join(homeDir, "artifacts"),
    maxParallelRuns: 2,
    maxParallelNodesPerRun: 4,
    maxUsdPerRun: 50,
    nodeTimeoutSeconds: 30,
    runTimeoutSeconds: 120,
    pollIntervalMs: 20,
  };
}

async function withMcpHarness<T>(fn: (ctx: { client: Client; runtime: RuntimeQueue }) => Promise<T>): Promise<T> {
  const homeDir = mkdtempSync(join(tmpdir(), "smart-spawn-mcp-test-"));
  cleanupDirs.push(homeDir);

  const config = buildTestConfig(homeDir);
  const store = new McpStore(config.dbPath);
  const storage = new ArtifactStorage(config.homeDir, config.artifactsDir);
  const runtime = new RuntimeQueue(
    config,
    store,
    storage,
    new MockSmartSpawnClient() as any,
    new MockOpenRouterClient() as any
  );
  await runtime.start();

  const server = new Server(
    { name: "smart-spawn-mcp-test", version: "0.0.0-test" },
    { capabilities: { tools: {} } }
  );
  registerToolHandlers(server, runtime);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "smart-spawn-test-client", version: "1.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    return await fn({ client, runtime });
  } finally {
    runtime.stop();
    await client.close();
    await server.close();
    store.close();
  }
}

test("MCP single run lifecycle returns merged output and artifacts", async () => {
  await withMcpHarness(async ({ client }) => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);
    expect(toolNames).toContain("smartspawn_run_create");
    expect(toolNames).toContain("smartspawn_run_result");

    const createResult = await client.callTool({
      name: "smartspawn_run_create",
      arguments: {
        task: "Build a small hello world API",
        mode: "single",
        budget: "low",
      },
    });
    const created = parseToolPayload(createResult);
    const runId = String(created.run_id);
    expect(runId.length).toBeGreaterThan(10);

    const finalStatus = await waitForRunCompletion(client, runId);
    expect(finalStatus.status).toBe("completed");

    const result = await client.callTool({
      name: "smartspawn_run_result",
      arguments: { run_id: runId },
    });
    const payload = parseToolPayload(result);

    expect(payload.status).toBe("completed");
    expect(typeof payload.merged_output).toBe("string");
    expect(payload.merged_output).toContain("Merged Output");
    expect(Array.isArray(payload.artifacts)).toBe(true);
    expect(payload.artifacts.length).toBeGreaterThan(0);

    const mergedArtifact = await client.callTool({
      name: "smartspawn_artifact_get",
      arguments: { run_id: runId, node_id: "merged" },
    });
    const mergedPayload = parseToolPayload(mergedArtifact);
    expect(mergedPayload.artifact_type).toBe("merged");
    expect(mergedPayload.content).toContain("Merged Output");
  });
});

test("MCP swarm mode runs parallel tasks and returns merged answer", async () => {
  await withMcpHarness(async ({ client }) => {
    const createResult = await client.callTool({
      name: "smartspawn_run_create",
      arguments: {
        task: "Build backend and frontend and tests",
        mode: "swarm",
        budget: "medium",
      },
    });
    const created = parseToolPayload(createResult);
    const runId = String(created.run_id);

    const finalStatus = await waitForRunCompletion(client, runId);
    expect(finalStatus.status).toBe("completed");
    expect(finalStatus.progress.total_nodes).toBeGreaterThanOrEqual(4);

    const result = await client.callTool({
      name: "smartspawn_run_result",
      arguments: { run_id: runId, include_raw: true },
    });
    const payload = parseToolPayload(result);

    expect(payload.status).toBe("completed");
    expect(payload.merged_output).toContain("Merged final answer");
    expect(Array.isArray(payload.raw_outputs)).toBe(true);
    expect(payload.raw_outputs.length).toBeGreaterThanOrEqual(3);
    expect(payload.cost.prompt_tokens).toBeGreaterThan(0);

    const healthResult = await client.callTool({
      name: "smartspawn_health",
      arguments: {},
    });
    const health = parseToolPayload(healthResult);
    expect(health.openrouter_configured).toBe(true);
    expect(health.smart_spawn_api_reachable).toBe(true);
    expect(health.db_writable).toBe(true);
    expect(health.artifact_storage_writable).toBe(true);
    expect(health.worker_alive).toBe(true);
  });
});
