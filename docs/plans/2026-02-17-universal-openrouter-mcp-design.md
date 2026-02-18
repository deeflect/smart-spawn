# Universal OpenRouter MCP Design

Date: 2026-02-17  
Status: Approved (implementation starting)  
Scope: Local MCP server that orchestrates multi-agent runs asynchronously and returns a merged answer by default.

## 1. Goals and Non-Goals

### Goals
- Provide a universal MCP server usable by Codex, Claude, and other MCP-capable coding assistants.
- Run on the user device with user-provided OpenRouter API key.
- Orchestrate multi-agent workflows (`single`, `collective`, `cascade`, `plan`, `swarm`) asynchronously.
- Persist raw sub-agent outputs locally so users can inspect and revisit them.
- Return merged output as the primary result for main-agent UX.
- Reuse existing Smart Spawn API for planning/model selection logic where possible.

### Non-Goals (v1)
- No OpenClaw-specific integration requirements.
- No distributed/cloud queue infrastructure.
- No team multi-tenant auth model.
- No commit-time dependency on external hosted orchestrator.

## 2. High-Level Architecture

The MCP server is a local orchestration runtime with persistent storage.

- **MCP Interface Layer**
  - Exposes tool contracts for run creation, status, result retrieval, cancellation, and artifact access.
- **Orchestration Engine**
  - Builds execution plan from Smart Spawn API (`pick`, `recommend`, `decompose`, `swarm`, `roles/compose`).
  - Executes nodes with dependency-aware scheduling and mode-specific behavior.
- **OpenRouter Execution Adapter**
  - Sends prompts to selected models via OpenRouter using local API key.
  - Captures outputs, token usage, and estimated cost.
- **Persistence Layer**
  - SQLite for run/node/event metadata.
  - Filesystem artifacts for raw/merged outputs.
- **Recovery/Worker Loop**
  - Resumes non-terminal runs on restart.
  - Bounded retries for transient failures.

## 3. Execution Model

### Async lifecycle
1. `smartspawn_run_create` inserts a run (`queued`) and returns `run_id`.
2. Background worker picks queued runs and sets `running`.
3. Planner determines subtask graph based on selected mode.
4. Scheduler executes eligible nodes (dependency-aware, wave-aware for swarm).
5. Node outputs are stored as artifacts and linked in DB.
6. Merge phase creates final consolidated output artifact.
7. Run transitions to `completed` / `failed` / `canceled`.

### Modes
- **single**: one node, one model, one output, optional merge pass skipped.
- **collective**: parallel peer nodes + one merge node.
- **cascade**: cheap node first, quality gate, optional premium escalation node, then merge/finalize.
- **plan**: sequential nodes from decomposition.
- **swarm**: DAG/wave execution from decomposition with dependencies.

## 4. MCP Tool Contracts

### `smartspawn_run_create`
Input:
- `task: string`
- `mode: "single" | "collective" | "cascade" | "plan" | "swarm"`
- `budget?: "low" | "medium" | "high" | "any"`
- `context?: string`
- `collectiveCount?: number`
- `role?: { persona?: string; stack?: string[]; domain?: string; format?: string; guardrails?: string[] }`
- `merge?: { style?: "concise" | "detailed" | "decision"; model?: string }`

Output:
- `run_id: string`
- `status: "queued"`
- `created_at: string`
- `estimated_steps: number`

### `smartspawn_run_status`
Input:
- `run_id: string`

Output:
- `status: "queued" | "running" | "completed" | "failed" | "canceled"`
- `progress: { total_nodes: number; done_nodes: number; running_nodes: number; failed_nodes: number; percent: number }`
- `current_wave?: number`
- `last_event?: string`
- `updated_at: string`

### `smartspawn_run_result`
Input:
- `run_id: string`
- `include_raw?: boolean` (default false)

Output:
- `status`
- `merged_output` (primary answer)
- `summary`
- `artifacts: [{ node_id: string; path: string; model: string; status: string }]`
- `cost: { prompt_tokens: number; completion_tokens: number; usd_estimate: number }`
- `raw_outputs?` (trimmed)

### `smartspawn_run_cancel`
Input:
- `run_id: string`

Output:
- `status: "canceling" | "canceled"`

### `smartspawn_run_list`
Input:
- `status?: "queued" | "running" | "completed" | "failed" | "canceled"`
- `limit?: number`

Output:
- `runs: [{ run_id: string; task: string; status: string; created_at: string; updated_at: string }]`

### `smartspawn_artifact_get`
Input:
- `run_id: string`
- `node_id: string | "merged"`

Output:
- `artifact_type: "raw" | "merged" | "plan" | "log"`
- `content: string`
- `metadata: { model?: string; created_at: string; bytes: number; sha256: string }`

### `smartspawn_health`
Input:
- none

Output:
- `openrouter_configured: boolean`
- `smart_spawn_api_reachable: boolean`
- `db_writable: boolean`
- `artifact_storage_writable: boolean`
- `worker_alive: boolean`

## 5. Data Model

### SQLite tables

#### `runs`
- `id TEXT PRIMARY KEY`
- `task TEXT NOT NULL`
- `mode TEXT NOT NULL`
- `budget TEXT NOT NULL`
- `context TEXT`
- `status TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `started_at TEXT`
- `finished_at TEXT`
- `error TEXT`

#### `nodes`
- `id TEXT PRIMARY KEY`
- `run_id TEXT NOT NULL`
- `wave INTEGER`
- `depends_on_json TEXT NOT NULL`
- `task TEXT NOT NULL`
- `model TEXT NOT NULL`
- `role_json TEXT`
- `status TEXT NOT NULL`
- `started_at TEXT`
- `finished_at TEXT`
- `tokens_prompt INTEGER DEFAULT 0`
- `tokens_completion INTEGER DEFAULT 0`
- `cost_usd REAL DEFAULT 0`
- `error TEXT`

#### `events`
- `id TEXT PRIMARY KEY`
- `run_id TEXT NOT NULL`
- `node_id TEXT`
- `level TEXT NOT NULL`
- `message TEXT NOT NULL`
- `ts TEXT NOT NULL`

#### `artifacts`
- `id TEXT PRIMARY KEY`
- `run_id TEXT NOT NULL`
- `node_id TEXT NOT NULL`
- `type TEXT NOT NULL`
- `path TEXT NOT NULL`
- `bytes INTEGER NOT NULL`
- `sha256 TEXT NOT NULL`
- `created_at TEXT NOT NULL`

### Local storage layout
- `~/.smart-spawn-mcp/db.sqlite`
- `~/.smart-spawn-mcp/artifacts/<run_id>/<node_id>.json`
- `~/.smart-spawn-mcp/artifacts/<run_id>/merged.md`

## 6. Reliability and Recovery

- Persistent queue states: `queued`, `running`, `retry_pending`, terminal (`completed`, `failed`, `canceled`).
- Retry policy: bounded exponential backoff for transient `429`, `5xx`, network timeout.
- Concurrency controls:
  - `max_parallel_runs`
  - `max_parallel_nodes_per_run`
- Restart recovery:
  - On startup, find non-terminal runs and resume safely.
  - Ensure idempotent node transitions using status checks.
- Timeout policy:
  - Node execution timeout.
  - Run-level hard timeout.

## 7. Safety and Cost Guardrails

- Require `OPENROUTER_API_KEY` to execute runs.
- Per-run estimated cost ceiling (`max_usd_per_run`) with soft-stop behavior.
- Optional model allowlist/denylist.
- Prompt/response max length caps to prevent runaway cost.
- Optional artifact redaction mode for sensitive content.

## 8. UX Principles

- Main agent UX centers on merged output from `smartspawn_run_result`.
- Raw sub-agent outputs are persistently available through artifact tools.
- Async tools keep long-running orchestration from blocking main conversation loops.
- Errors should be actionable and specific (which node/model failed, retry state, next step).

## 9. Config Surface (v1)

Environment variables:
- `OPENROUTER_API_KEY` (required for execution)
- `SMART_SPAWN_API_URL` (default `https://ss.deeflect.com/api`)
- `SMART_SPAWN_MCP_HOME` (default `~/.smart-spawn-mcp`)
- `MAX_PARALLEL_RUNS` (default `2`)
- `MAX_PARALLEL_NODES_PER_RUN` (default `4`)
- `MAX_USD_PER_RUN` (default `5`)
- `NODE_TIMEOUT_SECONDS` (default `180`)
- `RUN_TIMEOUT_SECONDS` (default `1800`)

## 10. Implementation Phases

### Phase 1: Runtime Foundation
- MCP server bootstrap and config loading.
- SQLite schema initialization.
- Filesystem artifact manager.
- Queue + worker loop with resume support.

### Phase 2: Planning Integration
- Smart Spawn API client integration.
- Mode-to-plan conversion for all five modes.
- Node graph persistence.

### Phase 3: OpenRouter Execution
- Request builder for node prompts.
- Response capture, token/cost accounting.
- Retry/backoff and timeout handling.

### Phase 4: Tooling and UX
- Implement all MCP tools defined above.
- Result shaping (merged primary, artifacts secondary).
- Health/reporting endpoints.

### Phase 5: Hardening
- Validation and schema checks.
- Cost/safety guardrails.
- Integration and failure-path tests.

## 11. Open Questions (to resolve during implementation)

- Merge model default: use planned best model vs explicit lightweight merge model.
- Quality gate for cascade: deterministic heuristics vs optional evaluator model pass.
- Artifact redaction defaults for local plaintext storage.

## 12. Approval Record

- Architecture: approved.
- Tool contract: approved.
- Data/reliability/safety section: approved.
- Commit behavior: user requested no commit at this stage.
