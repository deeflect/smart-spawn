import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { ArtifactRecord, NodeRecord, PlannedNode, RunCreateInput, RunRecord, RunStatus } from "./types.ts";

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export class McpStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true, strict: false });
    this.initSchema();
  }

  initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        mode TEXT NOT NULL,
        budget TEXT NOT NULL,
        context TEXT,
        params_json TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        wave INTEGER NOT NULL,
        depends_on_json TEXT NOT NULL,
        task TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt TEXT NOT NULL,
        meta_json TEXT NOT NULL,
        status TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 2,
        error TEXT,
        started_at TEXT,
        finished_at TEXT,
        tokens_prompt INTEGER NOT NULL DEFAULT 0,
        tokens_completion INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        node_id TEXT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        ts TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
      CREATE INDEX IF NOT EXISTS idx_nodes_run_id ON nodes(run_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
      CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);
      CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id, ts);
    `);
  }

  createRun(input: RunCreateInput): RunRecord {
    const id = randomUUID();
    const now = nowIso();
    const budget = input.budget ?? "medium";
    const context = input.context ?? null;
    const params = JSON.stringify(input);

    this.db
      .query(
        `INSERT INTO runs (id, task, mode, budget, context, params_json, status, error, created_at, updated_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', NULL, ?, ?, NULL, NULL)`
      )
      .run(id, input.task, input.mode, budget, context, params, now, now);

    return this.getRun(id)!;
  }

  getRun(runId: string): RunRecord | null {
    const row = this.db
      .query(
        `SELECT id, task, mode, budget, context, params_json, status, error, created_at, updated_at, started_at, finished_at
         FROM runs WHERE id = ? LIMIT 1`
      )
      .get(runId) as any;
    if (!row) return null;
    return this.mapRun(row);
  }

  listRuns(status?: RunStatus, limit = 20): RunRecord[] {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = status
      ? (this.db
          .query(
            `SELECT id, task, mode, budget, context, params_json, status, error, created_at, updated_at, started_at, finished_at
             FROM runs WHERE status = ? ORDER BY created_at DESC LIMIT ?`
          )
          .all(status, safeLimit) as any[])
      : (this.db
          .query(
            `SELECT id, task, mode, budget, context, params_json, status, error, created_at, updated_at, started_at, finished_at
             FROM runs ORDER BY created_at DESC LIMIT ?`
          )
          .all(safeLimit) as any[]);

    return rows.map((r) => this.mapRun(r));
  }

  listActiveRuns(limit: number): RunRecord[] {
    const rows = this.db
      .query(
        `SELECT id, task, mode, budget, context, params_json, status, error, created_at, updated_at, started_at, finished_at
         FROM runs WHERE status IN ('queued', 'running') ORDER BY created_at ASC LIMIT ?`
      )
      .all(limit) as any[];
    return rows.map((r) => this.mapRun(r));
  }

  updateRunStatus(runId: string, status: RunStatus, error: string | null = null): void {
    const now = nowIso();
    if (status === "running") {
      this.db
        .query(
          `UPDATE runs
           SET status = ?, error = ?, updated_at = ?, started_at = COALESCE(started_at, ?)
           WHERE id = ?`
        )
        .run(status, error, now, now, runId);
      return;
    }

    if (status === "completed" || status === "failed" || status === "canceled") {
      this.db
        .query(
          `UPDATE runs
           SET status = ?, error = ?, updated_at = ?, finished_at = ?
           WHERE id = ?`
        )
        .run(status, error, now, now, runId);
      return;
    }

    this.db
      .query(`UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ?`)
      .run(status, error, now, runId);
  }

  getRunInput(runId: string): RunCreateInput | null {
    const row = this.db
      .query(`SELECT params_json FROM runs WHERE id = ? LIMIT 1`)
      .get(runId) as any;
    if (!row) return null;
    return parseJson<RunCreateInput>(row.params_json);
  }

  createNodes(runId: string, nodes: PlannedNode[]): void {
    const insert = this.db.query(
      `INSERT INTO nodes
      (id, run_id, kind, wave, depends_on_json, task, model, prompt, meta_json, status, retry_count, max_retries, error, started_at, finished_at, tokens_prompt, tokens_completion, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, NULL, NULL, NULL, 0, 0, 0)`
    );
    const tx = this.db.transaction(() => {
      const idMap = new Map<string, string>();
      for (const node of nodes) {
        idMap.set(node.id, `${runId}:${node.id}`);
      }

      for (const node of nodes) {
        const nodeId = idMap.get(node.id)!;
        const mappedDependsOn = node.dependsOn.map((dep) => idMap.get(dep) ?? `${runId}:${dep}`);
        insert.run(
          nodeId,
          runId,
          node.kind,
          node.wave,
          JSON.stringify(mappedDependsOn),
          node.task,
          node.model,
          node.prompt,
          JSON.stringify(node.meta ?? {}),
          node.maxRetries ?? 2
        );
      }
    });
    tx();
  }

  listNodes(runId: string): NodeRecord[] {
    const rows = this.db
      .query(
        `SELECT id, run_id, kind, wave, depends_on_json, task, model, prompt, meta_json, status, retry_count, max_retries, error, started_at, finished_at, tokens_prompt, tokens_completion, cost_usd
         FROM nodes WHERE run_id = ? ORDER BY wave ASC, id ASC`
      )
      .all(runId) as any[];
    return rows.map((r) => this.mapNode(r));
  }

  getNode(nodeId: string): NodeRecord | null {
    const row = this.db
      .query(
        `SELECT id, run_id, kind, wave, depends_on_json, task, model, prompt, meta_json, status, retry_count, max_retries, error, started_at, finished_at, tokens_prompt, tokens_completion, cost_usd
         FROM nodes WHERE id = ? LIMIT 1`
      )
      .get(nodeId) as any;
    if (!row) return null;
    return this.mapNode(row);
  }

  startNode(nodeId: string): void {
    const now = nowIso();
    this.db
      .query(
        `UPDATE nodes
         SET status = 'running', started_at = COALESCE(started_at, ?) 
         WHERE id = ?`
      )
      .run(now, nodeId);
  }

  markNodeCompleted(nodeId: string, tokensPrompt: number, tokensCompletion: number, costUsd: number): void {
    const now = nowIso();
    this.db
      .query(
        `UPDATE nodes
         SET status = 'completed', finished_at = ?, tokens_prompt = ?, tokens_completion = ?, cost_usd = ?, error = NULL
         WHERE id = ?`
      )
      .run(now, tokensPrompt, tokensCompletion, costUsd, nodeId);
  }

  markNodeSkipped(nodeId: string, reason: string): void {
    const now = nowIso();
    this.db
      .query(
        `UPDATE nodes
         SET status = 'skipped', finished_at = ?, error = ?
         WHERE id = ?`
      )
      .run(now, reason, nodeId);
  }

  markNodeFailed(nodeId: string, error: string): void {
    const now = nowIso();
    this.db
      .query(
        `UPDATE nodes
         SET status = 'failed', finished_at = ?, error = ?
         WHERE id = ?`
      )
      .run(now, error.slice(0, 5000), nodeId);
  }

  incrementNodeRetry(nodeId: string, error: string): void {
    this.db
      .query(
        `UPDATE nodes
         SET status = 'queued', retry_count = retry_count + 1, error = ?
         WHERE id = ?`
      )
      .run(error.slice(0, 5000), nodeId);
  }

  addEvent(runId: string, level: "info" | "warn" | "error", message: string, nodeId?: string): void {
    this.db
      .query(
        `INSERT INTO events (id, run_id, node_id, level, message, ts)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), runId, nodeId ?? null, level, message.slice(0, 5000), nowIso());
  }

  listRecentEvents(runId: string, limit = 20): Array<{ level: string; message: string; ts: string; nodeId: string | null }> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = this.db
      .query(
        `SELECT level, message, ts, node_id
         FROM events WHERE run_id = ? ORDER BY ts DESC LIMIT ?`
      )
      .all(runId, safeLimit) as Array<{ level: string; message: string; ts: string; node_id: string | null }>;
    return rows.map((row) => ({
      level: row.level,
      message: row.message,
      ts: row.ts,
      nodeId: row.node_id,
    }));
  }

  createArtifact(input: Omit<ArtifactRecord, "id">): ArtifactRecord {
    const id = randomUUID();
    this.db
      .query(
        `INSERT INTO artifacts (id, run_id, node_id, type, path, bytes, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.runId, input.nodeId, input.type, input.path, input.bytes, input.sha256, input.createdAt);

    return {
      id,
      ...input,
    };
  }

  listArtifacts(runId: string): ArtifactRecord[] {
    const rows = this.db
      .query(
        `SELECT id, run_id, node_id, type, path, bytes, sha256, created_at
         FROM artifacts WHERE run_id = ? ORDER BY created_at ASC`
      )
      .all(runId) as any[];

    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      nodeId: r.node_id,
      type: r.type,
      path: r.path,
      bytes: r.bytes,
      sha256: r.sha256,
      createdAt: r.created_at,
    }));
  }

  getArtifact(runId: string, nodeId: string): ArtifactRecord | null {
    const row = this.db
      .query(
        `SELECT id, run_id, node_id, type, path, bytes, sha256, created_at
         FROM artifacts WHERE run_id = ? AND node_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(runId, nodeId) as any;
    if (!row) return null;
    return {
      id: row.id,
      runId: row.run_id,
      nodeId: row.node_id,
      type: row.type,
      path: row.path,
      bytes: row.bytes,
      sha256: row.sha256,
      createdAt: row.created_at,
    };
  }

  getRunCost(runId: string): { promptTokens: number; completionTokens: number; usdEstimate: number } {
    const row = this.db
      .query(
        `SELECT
           COALESCE(SUM(tokens_prompt), 0) AS prompt_tokens,
           COALESCE(SUM(tokens_completion), 0) AS completion_tokens,
           COALESCE(SUM(cost_usd), 0) AS usd_estimate
         FROM nodes WHERE run_id = ?`
      )
      .get(runId) as any;

    return {
      promptTokens: Number(row.prompt_tokens ?? 0),
      completionTokens: Number(row.completion_tokens ?? 0),
      usdEstimate: Number(row.usd_estimate ?? 0),
    };
  }

  pingWritable(): boolean {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS _health_probe (id INTEGER PRIMARY KEY, ts TEXT NOT NULL);
        INSERT INTO _health_probe (ts) VALUES (datetime('now'));
        DELETE FROM _health_probe WHERE id = (SELECT MAX(id) FROM _health_probe);
      `);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.db.close();
  }

  private mapRun(row: any): RunRecord {
    return {
      id: row.id,
      task: row.task,
      mode: row.mode,
      budget: row.budget,
      context: row.context,
      paramsJson: row.params_json,
      status: row.status,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }

  private mapNode(row: any): NodeRecord {
    return {
      id: row.id,
      runId: row.run_id,
      kind: row.kind,
      wave: row.wave,
      dependsOnJson: row.depends_on_json,
      task: row.task,
      model: row.model,
      prompt: row.prompt,
      metaJson: row.meta_json,
      status: row.status,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      error: row.error,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      tokensPrompt: row.tokens_prompt,
      tokensCompletion: row.tokens_completion,
      costUsd: Number(row.cost_usd ?? 0),
    };
  }
}
