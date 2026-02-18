import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { rmSync } from "node:fs";
import { join } from "node:path";

function parseTextPayload(result: any): any {
  const part = result?.content?.find((x: any) => x?.type === "text");
  if (!part?.text) throw new Error("No text payload in tool response");
  return JSON.parse(part.text);
}

async function waitForCompletion(client: Client, runId: string, timeoutMs: number): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await client.callTool({
      name: "smartspawn_run_status",
      arguments: { run_id: runId },
    });
    const payload = parseTextPayload(status);
    const state = String(payload.status ?? "");
    const pct = Number(payload?.progress?.percent ?? 0);
    const done = Number(payload?.progress?.done_nodes ?? 0);
    const total = Number(payload?.progress?.total_nodes ?? 0);
    console.log(`[status] ${state} ${done}/${total} (${pct}%)`);
    if (["completed", "failed", "canceled"].includes(state)) return payload;
    await Bun.sleep(3500);
  }
  throw new Error(`Run timed out after ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  if (!process.env["OPENROUTER_API_KEY"]) {
    throw new Error("OPENROUTER_API_KEY is not set in environment");
  }

  const mcpHome = join(process.cwd(), ".smart-spawn-mcp-live");
  rmSync(mcpHome, { recursive: true, force: true });

  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", "src/index.ts"],
    cwd: process.cwd(),
    env: {
      OPENROUTER_API_KEY: process.env["OPENROUTER_API_KEY"]!,
      SMART_SPAWN_API_URL: process.env["SMART_SPAWN_API_URL"] ?? "https://ss.deeflect.com/api",
      SMART_SPAWN_MCP_HOME: process.env["SMART_SPAWN_MCP_HOME"] ?? mcpHome,
      MAX_PARALLEL_RUNS: process.env["MAX_PARALLEL_RUNS"] ?? "2",
      MAX_PARALLEL_NODES_PER_RUN: process.env["MAX_PARALLEL_NODES_PER_RUN"] ?? "4",
      MAX_USD_PER_RUN: process.env["MAX_USD_PER_RUN"] ?? "2",
      NODE_TIMEOUT_SECONDS: process.env["NODE_TIMEOUT_SECONDS"] ?? "180",
      RUN_TIMEOUT_SECONDS: process.env["RUN_TIMEOUT_SECONDS"] ?? "900",
    },
    stderr: "pipe",
  });

  const client = new Client({
    name: "smart-spawn-live-smoke",
    version: "1.0.0",
  });

  transport.stderr?.on("data", (chunk) => {
    const text = String(chunk ?? "").trim();
    if (text) console.log(`[server] ${text}`);
  });

  await client.connect(transport);

  try {
    const tools = await client.listTools();
    console.log(`[tools] ${tools.tools.length} tools available`);

    const create = await client.callTool({
      name: "smartspawn_run_create",
      arguments: {
        task: "Build a tiny Node.js hello-world API, add 3 curl tests, and provide final implementation summary.",
        mode: "swarm",
        budget: "low",
        context: "nodejs,typescript,api,testing",
        merge: { style: "concise" },
      },
    });
    const created = parseTextPayload(create);
    const runId = String(created.run_id ?? "");
    if (!runId) throw new Error("run_create did not return run_id");
    console.log(`[run] created ${runId}`);

    const finalStatus = await waitForCompletion(client, runId, 6 * 60 * 1000);
    console.log(`[run] final status: ${finalStatus.status}`);
    if (finalStatus.status !== "completed") {
      throw new Error(`Run ended in non-completed state: ${finalStatus.status}`);
    }

    const resultRes = await client.callTool({
      name: "smartspawn_run_result",
      arguments: { run_id: runId, include_raw: true },
    });
    const result = parseTextPayload(resultRes);

    console.log(`[result] artifacts=${Array.isArray(result.artifacts) ? result.artifacts.length : 0}`);
    console.log(
      `[cost] prompt=${result?.cost?.prompt_tokens ?? 0}, completion=${result?.cost?.completion_tokens ?? 0}, usd_estimate=${result?.cost?.usd_estimate ?? 0}`
    );
    const merged = String(result?.merged_output ?? "");
    console.log(`[merged-preview]\n${merged.slice(0, 900)}${merged.length > 900 ? "\n...[truncated]" : ""}`);

    const mergedArtifact = await client.callTool({
      name: "smartspawn_artifact_get",
      arguments: { run_id: runId, node_id: "merged" },
    });
    const mergedArtifactPayload = parseTextPayload(mergedArtifact);
    console.log(`[artifact] merged bytes=${mergedArtifactPayload?.metadata?.bytes ?? 0} path=${mergedArtifactPayload?.metadata?.path ?? "n/a"}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
