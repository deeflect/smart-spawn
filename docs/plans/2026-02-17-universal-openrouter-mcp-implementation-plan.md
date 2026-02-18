# Universal OpenRouter MCP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local universal MCP server that asynchronously orchestrates Smart Spawn multi-agent runs via OpenRouter, returns merged results, and stores raw artifacts.

**Architecture:** Add a new `mcp-server/` package in this repo. The MCP layer exposes async run tools, persists run state/artifacts locally, uses Smart Spawn API for planning/model selection, and executes model calls through OpenRouter. Worker + queue run in-process with restart-safe resume.

**Tech Stack:** TypeScript, Node.js, `@modelcontextprotocol/sdk`, `zod`, SQLite (`bun:sqlite`), Bun runtime scripts.

---

### Task 1: Scaffold MCP package and config plumbing

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`
- Create: `mcp-server/src/index.ts`
- Create: `mcp-server/src/config.ts`
- Modify: `README.md`

**Step 1: Write the failing test**

Create `mcp-server/src/config.ts` test harness in a temporary script call in `mcp-server/src/index.ts` that reads env vars; expected behavior not implemented yet.

**Step 2: Run test to verify it fails**

Run: `bun run mcp:dev`
Expected: FAIL because `mcp:dev` script/package does not exist.

**Step 3: Write minimal implementation**

- Add `mcp-server/package.json` with scripts: `dev`, `start`, `typecheck`.
- Add root scripts in `package.json`: `mcp:dev`, `mcp:start`, `mcp:typecheck`.
- Implement `config.ts` to parse:
  - `OPENROUTER_API_KEY`
  - `SMART_SPAWN_API_URL`
  - `SMART_SPAWN_MCP_HOME`
  - concurrency/timeouts/budget ceilings

**Step 4: Run test to verify it passes**

Run: `bun run mcp:typecheck`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json README.md mcp-server/package.json mcp-server/tsconfig.json mcp-server/src/index.ts mcp-server/src/config.ts
git commit -m "feat(mcp): scaffold universal MCP package and config"
```

### Task 2: Add persistent storage and schema initialization

**Files:**
- Create: `mcp-server/src/db.ts`
- Create: `mcp-server/src/storage.ts`
- Create: `mcp-server/src/types.ts`
- Create: `mcp-server/tests/db.test.ts`

**Step 1: Write the failing test**

`mcp-server/tests/db.test.ts`
```ts
import { expect, test } from "bun:test";
import { initDatabase } from "../src/db";

test("initDatabase creates core tables", () => {
  const db = initDatabase(":memory:");
  const rows = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
  const names = rows.map((r) => r.name);
  expect(names).toContain("runs");
  expect(names).toContain("nodes");
  expect(names).toContain("events");
  expect(names).toContain("artifacts");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test mcp-server/tests/db.test.ts`
Expected: FAIL (`Cannot find module '../src/db'`).

**Step 3: Write minimal implementation**

- Implement schema creation in `db.ts`.
- Implement storage helpers in `storage.ts`:
  - ensure home/artifact directories
  - write artifact file
  - sha256 + byte size metadata
- Define run/node/artifact/event types in `types.ts`.

**Step 4: Run test to verify it passes**

Run: `bun test mcp-server/tests/db.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add mcp-server/src/db.ts mcp-server/src/storage.ts mcp-server/src/types.ts mcp-server/tests/db.test.ts
git commit -m "feat(mcp): add persistent sqlite schema and artifact storage"
```

### Task 3: Implement Smart Spawn API and OpenRouter clients

**Files:**
- Create: `mcp-server/src/smart-spawn-client.ts`
- Create: `mcp-server/src/openrouter-client.ts`
- Create: `mcp-server/tests/clients.test.ts`

**Step 1: Write the failing test**

`mcp-server/tests/clients.test.ts`
```ts
import { expect, test } from "bun:test";
import { buildOpenRouterHeaders } from "../src/openrouter-client";

test("buildOpenRouterHeaders includes bearer token", () => {
  const headers = buildOpenRouterHeaders("test-key");
  expect(headers.Authorization).toBe("Bearer test-key");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test mcp-server/tests/clients.test.ts`
Expected: FAIL (module missing).

**Step 3: Write minimal implementation**

- Smart Spawn client methods:
  - `pick`, `recommend`, `decompose`, `swarm`, `composeRole`, `status`
- OpenRouter client methods:
  - `chatCompletion(model, messages, options)`
  - parse usage tokens safely
  - expose helper for headers

**Step 4: Run test to verify it passes**

Run: `bun test mcp-server/tests/clients.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add mcp-server/src/smart-spawn-client.ts mcp-server/src/openrouter-client.ts mcp-server/tests/clients.test.ts
git commit -m "feat(mcp): add Smart Spawn and OpenRouter client adapters"
```

### Task 4: Build queue + worker orchestration runtime

**Files:**
- Create: `mcp-server/src/runtime/queue.ts`
- Create: `mcp-server/src/runtime/planner.ts`
- Create: `mcp-server/src/runtime/executor.ts`
- Create: `mcp-server/src/runtime/merge.ts`
- Create: `mcp-server/tests/runtime.test.ts`

**Step 1: Write the failing test**

`mcp-server/tests/runtime.test.ts`
```ts
import { expect, test } from "bun:test";
import { buildSinglePlan } from "../src/runtime/planner";

test("buildSinglePlan creates exactly one node", () => {
  const plan = buildSinglePlan({ task: "Write a test", model: "openai/gpt-4o-mini" });
  expect(plan.nodes.length).toBe(1);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test mcp-server/tests/runtime.test.ts`
Expected: FAIL (module missing).

**Step 3: Write minimal implementation**

- Planner converts mode inputs into normalized node graph.
- Queue stores job state + scheduling metadata in DB.
- Executor:
  - runs ready nodes
  - records events/status
  - retries transient failures
  - writes artifacts
- Merge component generates merged output from completed raw node outputs.

**Step 4: Run test to verify it passes**

Run: `bun test mcp-server/tests/runtime.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add mcp-server/src/runtime/queue.ts mcp-server/src/runtime/planner.ts mcp-server/src/runtime/executor.ts mcp-server/src/runtime/merge.ts mcp-server/tests/runtime.test.ts
git commit -m "feat(mcp): add async run queue and orchestration runtime"
```

### Task 5: Expose MCP tools and wire runtime

**Files:**
- Modify: `mcp-server/src/index.ts`
- Create: `mcp-server/src/tools.ts`
- Create: `mcp-server/tests/tools.test.ts`

**Step 1: Write the failing test**

`mcp-server/tests/tools.test.ts`
```ts
import { expect, test } from "bun:test";
import { listToolNames } from "../src/tools";

test("registers required tool names", () => {
  const names = listToolNames();
  expect(names).toContain("smartspawn_run_create");
  expect(names).toContain("smartspawn_run_status");
  expect(names).toContain("smartspawn_run_result");
  expect(names).toContain("smartspawn_run_cancel");
  expect(names).toContain("smartspawn_run_list");
  expect(names).toContain("smartspawn_artifact_get");
  expect(names).toContain("smartspawn_health");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test mcp-server/tests/tools.test.ts`
Expected: FAIL (module missing).

**Step 3: Write minimal implementation**

- Register the seven tools with explicit JSON schemas.
- Implement handlers that call runtime methods and return normalized payloads.
- Return merged output by default in `smartspawn_run_result`; gate raw payload behind `include_raw`.

**Step 4: Run test to verify it passes**

Run: `bun test mcp-server/tests/tools.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add mcp-server/src/index.ts mcp-server/src/tools.ts mcp-server/tests/tools.test.ts
git commit -m "feat(mcp): expose async orchestration MCP tools"
```

### Task 6: Add safety guardrails and recovery checks

**Files:**
- Modify: `mcp-server/src/runtime/executor.ts`
- Modify: `mcp-server/src/config.ts`
- Create: `mcp-server/tests/guardrails.test.ts`
- Modify: `README.md`

**Step 1: Write the failing test**

`mcp-server/tests/guardrails.test.ts`
```ts
import { expect, test } from "bun:test";
import { shouldStopForBudget } from "../src/runtime/executor";

test("stops run when estimated cost exceeds max", () => {
  expect(shouldStopForBudget({ spentUsd: 5.1, maxUsd: 5 })).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test mcp-server/tests/guardrails.test.ts`
Expected: FAIL (function missing).

**Step 3: Write minimal implementation**

- Enforce budget ceiling and run timeout in executor loop.
- Add startup resume scan for non-terminal runs.
- Add health checks for key dependencies.
- Document MCP setup and usage in `README.md`.

**Step 4: Run test to verify it passes**

Run: `bun test mcp-server/tests/guardrails.test.ts && bun test mcp-server/tests`
Expected: PASS.

**Step 5: Commit**

```bash
git add mcp-server/src/runtime/executor.ts mcp-server/src/config.ts mcp-server/tests/guardrails.test.ts README.md
git commit -m "feat(mcp): add guardrails, recovery, and docs"
```

### Task 7: End-to-end validation in local dev mode

**Files:**
- Modify: `mcp-server/src/index.ts`
- Create: `mcp-server/tests/e2e-smoke.test.ts`

**Step 1: Write the failing test**

`mcp-server/tests/e2e-smoke.test.ts`
```ts
import { expect, test } from "bun:test";
import { createInMemoryRuntime } from "../src/runtime/queue";

test("create->status->result lifecycle works for a mocked single run", async () => {
  const rt = createInMemoryRuntime();
  const run = await rt.createRun({ task: "hello", mode: "single" });
  expect(run.status).toBe("queued");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test mcp-server/tests/e2e-smoke.test.ts`
Expected: FAIL until helper/runtime wiring exists.

**Step 3: Write minimal implementation**

- Add in-memory runtime helper for tests.
- Add minimal mocked execution path for smoke tests.

**Step 4: Run test to verify it passes**

Run: `bun test mcp-server/tests`
Expected: PASS.

**Step 5: Commit**

```bash
git add mcp-server/src/index.ts mcp-server/tests/e2e-smoke.test.ts
git commit -m "test(mcp): add end-to-end smoke lifecycle coverage"
```
