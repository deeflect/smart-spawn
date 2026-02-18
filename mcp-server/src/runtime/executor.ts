import type { McpConfig } from "../config.ts";
import { McpStore } from "../db.ts";
import { OpenRouterClient } from "../openrouter-client.ts";
import { ArtifactStorage } from "../storage.ts";
import type { NodeRecord, RunRecord } from "../types.ts";

function parseDependsOn(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function truncate(text: string, max = 6000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} chars]`;
}

function shouldRetry(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  return lower.includes("429") || lower.includes("timeout") || lower.includes("temporarily") || lower.includes("5");
}

function calcCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  void model;
  // Conservative default estimate when exact model pricing is unknown.
  const promptPer1m = 1;
  const completionPer1m = 3;
  return (promptTokens / 1_000_000) * promptPer1m + (completionTokens / 1_000_000) * completionPer1m;
}

function elapsedSeconds(startedAt: string): number {
  const startMs = new Date(startedAt).getTime();
  return (Date.now() - startMs) / 1000;
}

function findNode(nodes: NodeRecord[], id: string): NodeRecord | undefined {
  return nodes.find((n) => n.id === id);
}

export function shouldStopForBudget(input: { spentUsd: number; maxUsd: number }): boolean {
  return input.spentUsd > input.maxUsd;
}

export class RunExecutor {
  constructor(
    private readonly config: McpConfig,
    private readonly store: McpStore,
    private readonly storage: ArtifactStorage,
    private readonly openRouter: OpenRouterClient
  ) {}

  async processRun(run: RunRecord): Promise<void> {
    const current = this.store.getRun(run.id);
    if (!current || current.status === "canceled" || current.status === "completed" || current.status === "failed") {
      return;
    }

    this.store.updateRunStatus(run.id, "running");
    if (!run.startedAt) {
      this.store.addEvent(run.id, "info", "Run started");
    }

    if (this.isRunTimedOut(this.store.getRun(run.id)!)) {
      this.failRun(run.id, "Run timed out before execution");
      return;
    }

    const nodes = this.store.listNodes(run.id);
    if (nodes.length === 0) {
      this.failRun(run.id, "Run has no planned nodes");
      return;
    }

    while (true) {
      const snapshot = this.store.getRun(run.id);
      if (!snapshot) return;
      if (snapshot.status === "canceled") {
        this.store.addEvent(run.id, "warn", "Run canceled");
        return;
      }

      if (this.isRunTimedOut(snapshot)) {
        this.failRun(run.id, "Run timed out");
        return;
      }

      const nodeRows = this.store.listNodes(run.id);
      const runningNodes = nodeRows.filter((n) => n.status === "running");
      const terminalNodes = nodeRows.filter((n) => ["completed", "failed", "canceled", "skipped"].includes(n.status));
      const failedNodes = nodeRows.filter((n) => n.status === "failed");

      if (terminalNodes.length === nodeRows.length) {
        if (failedNodes.length > 0) {
          this.failRun(run.id, `${failedNodes.length} node(s) failed`);
          return;
        }
        await this.ensureMergedArtifact(run.id);
        this.store.updateRunStatus(run.id, "completed");
        this.store.addEvent(run.id, "info", "Run completed");
        return;
      }

      if (runningNodes.length >= this.config.maxParallelNodesPerRun) {
        await Bun.sleep(200);
        continue;
      }

      const ready = nodeRows.filter((node) => {
        if (node.status !== "queued") return false;
        const deps = parseDependsOn(node.dependsOnJson);
        return deps.every((depId) => {
          const dep = findNode(nodeRows, depId);
          return dep && (dep.status === "completed" || dep.status === "skipped");
        });
      });

      if (ready.length === 0) {
        await Bun.sleep(200);
        continue;
      }

      const available = Math.max(1, this.config.maxParallelNodesPerRun - runningNodes.length);
      const toRun = ready.slice(0, available);
      await Promise.all(toRun.map((node) => this.executeNode(run.id, node)));
    }
  }

  private async executeNode(runId: string, node: NodeRecord): Promise<void> {
    if (node.kind === "merge") {
      await this.executeMergeNode(runId, node);
      return;
    }

    if (await this.shouldSkipCascadePremium(runId, node)) {
      this.store.markNodeSkipped(node.id, "Cascade cheap output passed quality gate");
      this.store.addEvent(runId, "info", `Skipped premium cascade node ${node.id}`, node.id);
      return;
    }

    this.store.startNode(node.id);
    this.store.addEvent(runId, "info", `Executing node ${node.id} on ${node.model}`, node.id);

    try {
      const dependencyContext = await this.buildDependencyContext(runId, node);
      const prompt = dependencyContext
        ? `${node.prompt}\n\n## Dependency context\n${dependencyContext}`
        : node.prompt;

      const result = await this.runWithNodeTimeout(node.id, (signal) =>
        this.openRouter.chatCompletion({
          model: node.model,
          messages: [{ role: "user", content: prompt }],
          signal,
        })
      );

      const costUsd = calcCostUsd(node.model, result.promptTokens, result.completionTokens);
      const artifactPayload = JSON.stringify(
        {
          runId,
          nodeId: node.id,
          model: node.model,
          task: node.task,
          output: result.text,
          tokens: {
            prompt: result.promptTokens,
            completion: result.completionTokens,
            total: result.totalTokens,
          },
          costUsd,
          finishedAt: new Date().toISOString(),
        },
        null,
        2
      );

      const file = await this.storage.writeArtifact(runId, node.id, "raw", artifactPayload, "json");
      this.store.createArtifact({
        runId,
        nodeId: node.id,
        type: "raw",
        path: file.relativePath,
        bytes: file.bytes,
        sha256: file.sha256,
        createdAt: new Date().toISOString(),
      });
      this.store.markNodeCompleted(node.id, result.promptTokens, result.completionTokens, costUsd);

      const runCost = this.store.getRunCost(runId);
      if (shouldStopForBudget({ spentUsd: runCost.usdEstimate, maxUsd: this.config.maxUsdPerRun })) {
        this.store.updateRunStatus(runId, "canceled", "Budget limit reached");
        this.store.addEvent(runId, "warn", "Run canceled: budget limit reached", node.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (node.retryCount < node.maxRetries && shouldRetry(message)) {
        this.store.incrementNodeRetry(node.id, message);
        this.store.addEvent(runId, "warn", `Retrying node ${node.id}: ${message}`, node.id);
        await Bun.sleep(300 * (node.retryCount + 1));
      } else {
        this.store.markNodeFailed(node.id, message);
        this.store.addEvent(runId, "error", `Node failed: ${message}`, node.id);
      }
    }
  }

  private async executeMergeNode(runId: string, node: NodeRecord): Promise<void> {
    this.store.startNode(node.id);

    try {
      const inputs = [];
      for (const parentId of parseDependsOn(node.dependsOnJson)) {
        const artifact = this.store.getArtifact(runId, parentId);
        if (!artifact) continue;
        const raw = await this.storage.readArtifact(artifact.path);
        inputs.push({ nodeId: parentId, payload: raw });
      }

      const meta = parseMeta(node.metaJson);
      const style = String(meta.mergeStyle ?? "detailed");
      const mergePrompt = [
        `You are merging outputs from multiple sub-agents for task: ${node.task}`,
        `Output style: ${style}.`,
        "Produce one final answer, remove conflicts, and include the strongest concrete recommendations.",
        "Inputs:",
        ...inputs.map((item, idx) => `### Input ${idx + 1} (${item.nodeId})\n${truncate(item.payload, 10000)}`),
      ].join("\n\n");

      const result = await this.runWithNodeTimeout(node.id, (signal) =>
        this.openRouter.chatCompletion({
          model: node.model,
          messages: [{ role: "user", content: mergePrompt }],
          signal,
        })
      );
      const costUsd = calcCostUsd(node.model, result.promptTokens, result.completionTokens);

      const mergedContent = [
        `# Merged Output`,
        "",
        result.text.trim(),
      ].join("\n");

      const file = await this.storage.writeArtifact(runId, "merged", "merged", mergedContent, "md");
      this.store.createArtifact({
        runId,
        nodeId: "merged",
        type: "merged",
        path: file.relativePath,
        bytes: file.bytes,
        sha256: file.sha256,
        createdAt: new Date().toISOString(),
      });
      this.store.markNodeCompleted(node.id, result.promptTokens, result.completionTokens, costUsd);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.markNodeFailed(node.id, message);
      this.store.addEvent(runId, "error", `Merge node failed: ${message}`, node.id);
    }
  }

  private async buildDependencyContext(runId: string, node: NodeRecord): Promise<string> {
    const dependencyIds = parseDependsOn(node.dependsOnJson);
    if (dependencyIds.length === 0) return "";

    const chunks: string[] = [];
    for (const depId of dependencyIds) {
      const artifact = this.store.getArtifact(runId, depId);
      if (!artifact) continue;
      const raw = await this.storage.readArtifact(artifact.path);
      chunks.push(`## ${depId}\n${truncate(raw, 6000)}`);
    }
    return chunks.join("\n\n");
  }

  private async shouldSkipCascadePremium(runId: string, node: NodeRecord): Promise<boolean> {
    const meta = parseMeta(node.metaJson);
    if (meta.mode !== "cascade" || meta.tier !== "premium" || meta.conditional !== true) return false;

    const nodes = this.store.listNodes(runId);
    const cheap = nodes.find((n) => {
      const m = parseMeta(n.metaJson);
      return m.mode === "cascade" && m.tier === "cheap";
    });
    if (!cheap || cheap.status !== "completed") return false;

    const artifact = this.store.getArtifact(runId, cheap.id);
    if (!artifact) return false;

    try {
      const raw = await this.storage.readArtifact(artifact.path);
      const parsed = JSON.parse(raw);
      const output = String(parsed?.output ?? "");
      if (output.trim().length < 500) return false;
    } catch {
      return false;
    }
    return true;
  }

  private isRunTimedOut(run: RunRecord): boolean {
    if (!run.startedAt) return false;
    return elapsedSeconds(run.startedAt) > this.config.runTimeoutSeconds;
  }

  private async runWithNodeTimeout<T>(
    nodeId: string,
    execute: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const timeoutMs = Math.max(1, Math.floor(this.config.nodeTimeoutSeconds * 1000));
    const controller = new AbortController();
    const timeoutError = new Error(`Node ${nodeId} timed out after ${this.config.nodeTimeoutSeconds}s`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(timeoutError);
      }, timeoutMs);
    });

    try {
      return await Promise.race([execute(controller.signal), timeoutPromise]);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw timeoutError;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw timeoutError;
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private failRun(runId: string, error: string): void {
    this.store.updateRunStatus(runId, "failed", error);
    this.store.addEvent(runId, "error", error);
  }

  private async ensureMergedArtifact(runId: string): Promise<void> {
    const existing = this.store.getArtifact(runId, "merged");
    if (existing) return;

    const artifacts = this.store.listArtifacts(runId).filter((a) => a.type === "raw");
    if (artifacts.length === 0) return;

    const latest = artifacts[artifacts.length - 1];
    if (!latest) return;
    const raw = await this.storage.readArtifact(latest.path);

    let output = raw;
    try {
      const parsed = JSON.parse(raw);
      output = String(parsed?.output ?? raw);
    } catch {
      output = raw;
    }

    const mergedContent = `# Merged Output\n\n${output.trim()}\n`;
    const file = await this.storage.writeArtifact(runId, "merged", "merged", mergedContent, "md");
    this.store.createArtifact({
      runId,
      nodeId: "merged",
      type: "merged",
      path: file.relativePath,
      bytes: file.bytes,
      sha256: file.sha256,
      createdAt: new Date().toISOString(),
    });
  }
}
