import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { RuntimeQueue } from "./runtime/queue.ts";
import type { RunCreateInput, RunStatus } from "./types.ts";

const TOOL_DEFS = [
  {
    name: "smartspawn_run_create",
    description: "Create an async Smart Spawn run. This orchestrates sub-agents and returns a run_id immediately.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        mode: { type: "string", enum: ["single", "collective", "cascade", "plan", "swarm"] },
        budget: { type: "string", enum: ["low", "medium", "high", "any"] },
        context: { type: "string" },
        collectiveCount: { type: "number" },
        role: {
          type: "object",
          properties: {
            persona: { type: "string" },
            stack: { type: "array", items: { type: "string" } },
            domain: { type: "string" },
            format: { type: "string" },
            guardrails: { type: "array", items: { type: "string" } },
          },
          additionalProperties: false,
        },
        merge: {
          type: "object",
          properties: {
            style: { type: "string", enum: ["concise", "detailed", "decision"] },
            model: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      required: ["task", "mode"],
      additionalProperties: false,
    },
  },
  {
    name: "smartspawn_run_status",
    description: "Get status/progress for an async run.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
      },
      required: ["run_id"],
      additionalProperties: false,
    },
  },
  {
    name: "smartspawn_run_result",
    description: "Get merged result for a run (raw outputs optional).",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        include_raw: { type: "boolean" },
      },
      required: ["run_id"],
      additionalProperties: false,
    },
  },
  {
    name: "smartspawn_run_cancel",
    description: "Cancel a queued/running run.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
      },
      required: ["run_id"],
      additionalProperties: false,
    },
  },
  {
    name: "smartspawn_run_list",
    description: "List recent runs.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["queued", "running", "completed", "failed", "canceled"] },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "smartspawn_artifact_get",
    description: "Read a stored artifact by run and node id (use node_id='merged' for final answer).",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        node_id: { type: "string" },
      },
      required: ["run_id", "node_id"],
      additionalProperties: false,
    },
  },
  {
    name: "smartspawn_health",
    description: "Health checks for OpenRouter config, Smart Spawn API, DB, storage, and worker.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

function asToolContent(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function toErrorContent(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function listToolNames(): string[] {
  return TOOL_DEFS.map((tool) => tool.name);
}

export function registerToolHandlers(server: any, runtime: RuntimeQueue): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const name = request?.params?.name as string | undefined;
    const args = (request?.params?.arguments ?? {}) as Record<string, unknown>;

    try {
      if (name === "smartspawn_run_create") {
        const task = String(args.task ?? "").trim();
        const mode = String(args.mode ?? "").trim();
        if (!task) return toErrorContent("task is required");
        if (!["single", "collective", "cascade", "plan", "swarm"].includes(mode)) {
          return toErrorContent("mode must be one of single|collective|cascade|plan|swarm");
        }
        const runInput: RunCreateInput = {
          task,
          mode: mode as RunCreateInput["mode"],
          budget: args.budget as RunCreateInput["budget"],
          context: typeof args.context === "string" ? args.context : undefined,
          collectiveCount: typeof args.collectiveCount === "number" ? args.collectiveCount : undefined,
          role: typeof args.role === "object" && args.role ? (args.role as RunCreateInput["role"]) : undefined,
          merge: typeof args.merge === "object" && args.merge ? (args.merge as RunCreateInput["merge"]) : undefined,
        };
        const run = await runtime.createRun(runInput);
        return asToolContent({
          run_id: run.id,
          status: run.status,
          created_at: run.createdAt,
        });
      }

      if (name === "smartspawn_run_status") {
        const runId = String(args.run_id ?? "");
        if (!runId) return toErrorContent("run_id is required");
        const run = runtime.getRun(runId);
        if (!run) return toErrorContent(`run not found: ${runId}`);
        const progress = runtime.getProgress(runId);
        return asToolContent({
          run_id: runId,
          status: run.status,
          progress: {
            total_nodes: progress.totalNodes,
            done_nodes: progress.doneNodes,
            running_nodes: progress.runningNodes,
            failed_nodes: progress.failedNodes,
            percent: progress.percent,
          },
          last_event: runtime.getLastEvent(runId),
          updated_at: run.updatedAt,
        });
      }

      if (name === "smartspawn_run_result") {
        const runId = String(args.run_id ?? "");
        if (!runId) return toErrorContent("run_id is required");
        const includeRaw = Boolean(args.include_raw ?? false);
        const result = await runtime.getResult(runId, includeRaw);
        if (!result) return toErrorContent(`run not found: ${runId}`);
        return asToolContent({
          status: result.status,
          merged_output: result.mergedOutput,
          summary: result.summary,
          artifacts: result.artifacts.map((a) => ({
            node_id: a.nodeId,
            path: a.path,
            model: a.model,
            status: a.status,
            type: a.type,
          })),
          cost: {
            prompt_tokens: result.cost.promptTokens,
            completion_tokens: result.cost.completionTokens,
            usd_estimate: result.cost.usdEstimate,
          },
          ...(includeRaw ? { raw_outputs: result.rawOutputs } : {}),
        });
      }

      if (name === "smartspawn_run_cancel") {
        const runId = String(args.run_id ?? "");
        if (!runId) return toErrorContent("run_id is required");
        const canceled = runtime.cancelRun(runId);
        if (!canceled) return toErrorContent(`run not found: ${runId}`);
        return asToolContent({
          run_id: runId,
          status: canceled.status,
        });
      }

      if (name === "smartspawn_run_list") {
        const status = (args.status ? String(args.status) : undefined) as RunStatus | undefined;
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const runs = runtime.listRuns(status, limit);
        return asToolContent({
          runs: runs.map((run) => ({
            run_id: run.id,
            task: run.task,
            status: run.status,
            created_at: run.createdAt,
            updated_at: run.updatedAt,
          })),
        });
      }

      if (name === "smartspawn_artifact_get") {
        const runId = String(args.run_id ?? "");
        const nodeId = String(args.node_id ?? "");
        if (!runId || !nodeId) return toErrorContent("run_id and node_id are required");
        const artifact = await runtime.getArtifact(runId, nodeId);
        if (!artifact) return toErrorContent(`artifact not found for run=${runId} node=${nodeId}`);
        return asToolContent({
          artifact_type: artifact.type,
          content: artifact.content,
          metadata: {
            bytes: artifact.metadata.bytes,
            sha256: artifact.metadata.sha256,
            created_at: artifact.metadata.createdAt,
            path: artifact.metadata.path,
          },
        });
      }

      if (name === "smartspawn_health") {
        const health = await runtime.health();
        return asToolContent({
          openrouter_configured: health.openrouterConfigured,
          smart_spawn_api_reachable: health.smartSpawnApiReachable,
          db_writable: health.dbWritable,
          artifact_storage_writable: health.artifactStorageWritable,
          worker_alive: health.workerAlive,
        });
      }

      return toErrorContent(`unknown tool: ${name ?? "(missing name)"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toErrorContent(message);
    }
  });
}
