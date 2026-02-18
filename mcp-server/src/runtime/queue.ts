import type { McpConfig } from "../config.ts";
import { McpStore } from "../db.ts";
import { OpenRouterClient } from "../openrouter-client.ts";
import { SmartSpawnClient } from "../smart-spawn-client.ts";
import { ArtifactStorage } from "../storage.ts";
import type { RunCreateInput, RunProgress, RunRecord, RunStatus } from "../types.ts";
import { buildRunPlan } from "./planner.ts";
import { RunExecutor } from "./executor.ts";

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function formatPercent(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

export class RuntimeQueue {
  private interval: Timer | null = null;
  private processing = new Set<string>();
  private readonly executor: RunExecutor;

  constructor(
    private readonly config: McpConfig,
    private readonly store: McpStore,
    private readonly storage: ArtifactStorage,
    private readonly smartSpawn: SmartSpawnClient,
    private readonly openRouter: OpenRouterClient
  ) {
    this.executor = new RunExecutor(config, store, storage, openRouter);
  }

  async start(): Promise<void> {
    await this.storage.ensure();
    this.interval = setInterval(() => {
      void this.tick();
    }, this.config.pollIntervalMs);
    await this.tick();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async createRun(input: RunCreateInput): Promise<RunRecord> {
    const run = this.store.createRun(input);
    this.store.addEvent(run.id, "info", "Run created");
    await this.tick();
    return run;
  }

  getRun(runId: string): RunRecord | null {
    return this.store.getRun(runId);
  }

  listRuns(status?: RunStatus, limit?: number): RunRecord[] {
    return this.store.listRuns(status, limit ?? 20);
  }

  cancelRun(runId: string): RunRecord | null {
    const run = this.store.getRun(runId);
    if (!run) return null;
    if (run.status === "completed" || run.status === "failed") return run;
    this.store.updateRunStatus(runId, "canceled");
    this.store.addEvent(runId, "warn", "Run canceled by user");
    return this.store.getRun(runId);
  }

  getProgress(runId: string): RunProgress {
    const nodes = this.store.listNodes(runId);
    const totalNodes = nodes.length;
    const doneNodes = nodes.filter((n) => n.status === "completed" || n.status === "skipped").length;
    const runningNodes = nodes.filter((n) => n.status === "running").length;
    const failedNodes = nodes.filter((n) => n.status === "failed").length;
    const percent = totalNodes > 0 ? formatPercent((doneNodes / totalNodes) * 100) : 0;
    return { totalNodes, doneNodes, runningNodes, failedNodes, percent };
  }

  getLastEvent(runId: string): string | null {
    const events = this.store.listRecentEvents(runId, 1);
    return events.length > 0 ? (events[0]?.message ?? null) : null;
  }

  async getResult(runId: string, includeRaw = false): Promise<{
    status: string;
    mergedOutput: string | null;
    summary: string;
    artifacts: Array<{ nodeId: string; path: string; type: string; model: string; status: string }>;
    cost: { promptTokens: number; completionTokens: number; usdEstimate: number };
    rawOutputs?: Array<{ nodeId: string; output: string }>;
  } | null> {
    const run = this.store.getRun(runId);
    if (!run) return null;

    const nodes = this.store.listNodes(runId);
    const artifacts = this.store.listArtifacts(runId);
    const mergedArtifact = artifacts.find((a) => a.nodeId === "merged");
    const mergedOutput = mergedArtifact ? await this.storage.readArtifact(mergedArtifact.path) : null;
    const cost = this.store.getRunCost(runId);

    const artifactRows = artifacts.map((a) => {
      const node = nodes.find((n) => n.id === a.nodeId || (a.nodeId === "merged" && n.kind === "merge"));
      return {
        nodeId: a.nodeId,
        path: a.path,
        type: a.type,
        model: node?.model ?? "",
        status: node?.status ?? run.status,
      };
    });

    const rawOutputs = [];
    if (includeRaw) {
      for (const artifact of artifacts.filter((a) => a.type === "raw")) {
        const content = await this.storage.readArtifact(artifact.path);
        rawOutputs.push({ nodeId: artifact.nodeId, output: content.slice(0, 12000) });
      }
    }

    return {
      status: run.status,
      mergedOutput,
      summary: `${run.mode} run with ${nodes.length} nodes`,
      artifacts: artifactRows,
      cost,
      ...(includeRaw ? { rawOutputs } : {}),
    };
  }

  async getArtifact(runId: string, nodeId: string): Promise<{
    type: string;
    content: string;
    metadata: { bytes: number; sha256: string; createdAt: string; path: string };
  } | null> {
    const artifact = this.store.getArtifact(runId, nodeId);
    if (!artifact) return null;
    const content = await this.storage.readArtifact(artifact.path);
    return {
      type: artifact.type,
      content,
      metadata: {
        bytes: artifact.bytes,
        sha256: artifact.sha256,
        createdAt: artifact.createdAt,
        path: artifact.path,
      },
    };
  }

  async tick(): Promise<void> {
    if (this.processing.size >= this.config.maxParallelRuns) return;
    const openSlots = this.config.maxParallelRuns - this.processing.size;
    const active = this.store.listActiveRuns(openSlots * 2);
    for (const run of active) {
      if (this.processing.size >= this.config.maxParallelRuns) break;
      if (this.processing.has(run.id)) continue;
      this.processing.add(run.id);
      void this.processRun(run).finally(() => {
        this.processing.delete(run.id);
      });
    }
  }

  private async processRun(run: RunRecord): Promise<void> {
    const latest = this.store.getRun(run.id);
    if (!latest || latest.status === "canceled" || latest.status === "completed" || latest.status === "failed") {
      return;
    }

    let nodes = this.store.listNodes(run.id);
    if (nodes.length === 0) {
      const input = parseJson<RunCreateInput>(latest.paramsJson);
      const plan = await buildRunPlan(input, this.smartSpawn);
      this.store.createNodes(run.id, plan.nodes);
      const planFile = await this.storage.writeArtifact(run.id, "plan", "plan", JSON.stringify(plan, null, 2), "json");
      this.store.createArtifact({
        runId: run.id,
        nodeId: "plan",
        type: "plan",
        path: planFile.relativePath,
        bytes: planFile.bytes,
        sha256: planFile.sha256,
        createdAt: new Date().toISOString(),
      });
      this.store.addEvent(run.id, "info", plan.plannerSummary);
      nodes = this.store.listNodes(run.id);
      if (nodes.length === 0) {
        this.store.updateRunStatus(run.id, "failed", "Planner returned no nodes");
        return;
      }
    }

    await this.executor.processRun(run);
  }

  async health(): Promise<{
    openrouterConfigured: boolean;
    smartSpawnApiReachable: boolean;
    dbWritable: boolean;
    artifactStorageWritable: boolean;
    workerAlive: boolean;
  }> {
    const smart = await this.smartSpawn.health();
    const dbWritable = this.store.pingWritable();

    let artifactStorageWritable = false;
    try {
      await this.storage.ensure();
      artifactStorageWritable = true;
    } catch {
      artifactStorageWritable = false;
    }

    return {
      openrouterConfigured: Boolean(this.config.openRouterApiKey),
      smartSpawnApiReachable: smart.reachable,
      dbWritable,
      artifactStorageWritable,
      workerAlive: this.interval !== null,
    };
  }
}
