# Smart Spawn

Intelligent model routing for [OpenClaw](https://github.com/openclaw/openclaw). Automatically picks the best AI model for any task based on real benchmark data from 5 sources.

Instead of hardcoding models or guessing, Smart Spawn analyzes what you're doing and routes to the optimal model for the job — factoring in task type, budget, benchmarks, speed, and your own feedback history.

## Quick Start (OpenClaw Plugin)

You don't need to host anything. The public API runs at `ss.deeflect.com`.

**Install the plugin:**

```bash
openclaw plugins install @deeflectcom/smart-spawn
openclaw gateway restart
```

**Use it in conversation:**

> "Research the latest developments in WebGPU"
>
> Smart Spawn picks Gemini 2.5 Flash (fast, free, great context) and spawns a research sub-agent on it.

> "Build me a React dashboard with auth"
>
> Smart Spawn picks the best coding model in your budget tier and spawns a coder sub-agent.

**Plugin config** (optional — add to your OpenClaw config under `plugins.entries.smart-spawn.config`):

```json
{
  "apiUrl": "https://ss.deeflect.com/api",
  "defaultBudget": "medium",
  "defaultMode": "single"
}
```

| Setting | Default | Options |
|---------|---------|---------|
| `apiUrl` | `https://ss.deeflect.com/api` | Your own API URL if self-hosting |
| `defaultBudget` | `medium` | `low`, `medium`, `high`, `any` |
| `defaultMode` | `single` | `single`, `collective`, `cascade`, `plan`, `swarm` |
| `collectiveCount` | `3` | Number of models for collective mode (2-5 recommended) |
| `telemetryOptIn` | `false` | Opt-in to anonymous community telemetry |
| `communityUrl` | `apiUrl` | Alternate community telemetry endpoint |

### Spawn Modes

- **Single** — Pick one best model, spawn one agent
- **Collective** — Pick N diverse models, spawn parallel agents, merge results
- **Cascade** — Start cheap, escalate to premium if quality is insufficient
- **Plan** — Decompose sequential multi-step tasks and assign best model per step
- **Swarm** — Decompose complex tasks into a DAG of sub-tasks with optimal model per step

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                  Data Sources (5)                     │
│                                                       │
│  OpenRouter ─── model catalog, pricing, capabilities  │
│  Artificial Analysis ─── intelligence/coding/math idx │
│  HuggingFace Open LLM Leaderboard ─── MMLU, BBH, etc│
│  LMArena (Chatbot Arena) ─── ELO from human prefs    │
│  LiveBench ─── contamination-free coding/reasoning    │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│              Enrichment Pipeline                      │
│                                                       │
│  1. Pull raw data from all 5 sources                  │
│  2. Alias matching (map model names across sources)   │
│  3. Z-score normalization per benchmark               │
│  4. Category scoring (coding/reasoning/creative/...)  │
│  5. Cost-efficiency calculation                       │
│  6. Tier + capability classification                  │
│  7. Blend: benchmarks + personal + community scores   │
│                                                       │
│  Refreshes every 6 hours automatically                │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│              SQLite Cache → API → Plugin → Agent      │
└──────────────────────────────────────────────────────┘
```

### Scoring System

**Z-score normalization** — Each benchmark source uses different scales. An "intelligence index" of 65 from Artificial Analysis means something completely different than an Arena ELO of 1350. We normalize everything:

1. Compute mean and stddev for each benchmark across all models
2. Convert to z-scores: `(value - mean) / stddev`
3. Map to 0-100 scale: z=-2.5→0, z=0→50, z=+1→70, z=+2→90

This means a model that's 2σ above average on LiveCodeBench gets the same score as one 2σ above average on Arena ELO — both are "equally exceptional" on their metric.

**Category scores** — Models get scored per category (coding, reasoning, creative, vision, research, fast-cheap, general) using weighted combinations of relevant benchmarks:

| Category | Key Benchmarks |
|----------|---------------|
| Coding | LiveCodeBench, Agentic Coding, Coding Index |
| Reasoning | GPQA, Arena ELO, MATH-500, BBH |
| Creative | Arena ELO (human preference), LiveBench Language |
| Vision | Intelligence Index (vision-capable models) |
| Research | Arena ELO, context length bonus |
| Fast-cheap | Speed (tokens/sec), low pricing |

**Score blending** — Final score = weighted mix of:
- Benchmark score (primary)
- Personal feedback (your own ratings from past spawns)
- Community scores (anonymous aggregated ratings from other instances)
- Context boost (task-specific signals like "needs vision" or "long context")

### Budget Tiers

| Budget | Price Range (per 1M input tokens) | Examples |
|--------|----------------------------------|----------|
| `low` | $0 – $1 | DeepSeek, Kimi K2.5, Gemini Flash |
| `medium` | $0 – $5 | Claude Sonnet, GPT-4o, Gemini Pro |
| `high` | $2 – $20 | Claude Opus, GPT-5, o3 |
| `any` | No limit | Best available regardless of cost |

### Model Classification

Every model is automatically classified with:
- **Tier**: premium / standard / budget (based on provider + pricing)
- **Categories**: which task types it's good at (derived from benchmarks + capabilities)
- **Tags**: specific traits like "fast", "vision", "reasoning", "large-context"
- **Cost efficiency**: quality-per-dollar ratio per category

---

## API Reference

Base URL: `https://ss.deeflect.com/api`

### GET /pick

Pick the single best model for a task.

```bash
curl "https://ss.deeflect.com/api/pick?task=build+a+react+app&budget=medium"
```

| Param | Required | Description |
|-------|----------|-------------|
| `task` | Yes | Task description or category name |
| `budget` | No | `low`, `medium`, `high`, `any` (default: `medium`) |
| `exclude` | No | Comma-separated model IDs to skip |
| `context` | No | Context tags (e.g. `vision,long-context`) |

```json
{
  "data": {
    "id": "anthropic/claude-opus-4.6",
    "name": "Claude Opus 4.6",
    "score": 86,
    "pricing": { "prompt": 5, "completion": 25 },
    "budget": "medium",
    "reason": "Best general model at medium budget ($0-5/M) — score: 86"
  }
}
```

### GET /recommend

Get multiple model recommendations with provider diversity.

```bash
curl "https://ss.deeflect.com/api/recommend?task=coding&budget=low&count=3"
```

| Param | Required | Description |
|-------|----------|-------------|
| `task` or `category` | Yes | Task description or category name |
| `budget` | No | Budget tier (default: `medium`) |
| `count` | No | Number of recommendations, 1-5 (default: `1`) |
| `exclude` | No | Comma-separated model IDs to skip |
| `require` | No | Required capabilities: `vision`, `functionCalling`, `json`, `reasoning` |
| `minContext` | No | Minimum context window length |
| `context` | No | Context tags for routing boost |

### GET /compare

Side-by-side model comparison.

```bash
curl "https://ss.deeflect.com/api/compare?models=anthropic/claude-opus-4.6,openai/gpt-5.2"
```

| Param | Required | Description |
|-------|----------|-------------|
| `models` | Yes | Comma-separated OpenRouter model IDs |

### GET /models

Browse the full model catalog.

```bash
curl "https://ss.deeflect.com/api/models?category=coding&sort=score&limit=10"
```

| Param | Required | Description |
|-------|----------|-------------|
| `category` | No | Filter by category |
| `tier` | No | Filter by tier: `premium`, `standard`, `budget` |
| `sort` | No | `score` (default), `cost`, `efficiency`, or any category name |
| `limit` | No | Results to return, 1-500 (default: `50`) |

### POST /decompose

Break a complex task into sequential steps with optimal model per step.

```bash
curl -X POST "https://ss.deeflect.com/api/decompose" \
  -H "Content-Type: application/json" \
  -d '{"task": "Build and deploy a SaaS landing page", "budget": "medium"}'
```

### POST /swarm

Decompose a task into a parallel DAG of sub-tasks with dependency tracking.

```bash
curl -X POST "https://ss.deeflect.com/api/swarm" \
  -H "Content-Type: application/json" \
  -d '{"task": "Research competitors and build a pitch deck", "budget": "low"}'
```

### GET /status

API health and data freshness.

```bash
curl "https://ss.deeflect.com/api/status"
```

### POST /refresh

Force a data refresh (pulls from all 5 sources). Protected by API key if `REFRESH_API_KEY` is set.

```bash
curl -X POST "https://ss.deeflect.com/api/refresh" \
  -H "Authorization: Bearer YOUR_KEY"
```

### POST /spawn-log

Log a spawn event (used by the plugin for feedback/learning).

### POST /spawn-log/outcome

Report task outcome rating (1-5) for the learning loop.

### POST /community/report

Anonymous community outcome report for shared intelligence.

### POST /roles/compose

Compose a role-enriched prompt from persona/stack/domain blocks.

```bash
curl -X POST "https://ss.deeflect.com/api/roles/compose" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Build a dashboard with auth and billing",
    "persona": "fullstack-engineer",
    "stack": ["nextjs", "typescript", "postgres", "stripe"],
    "domain": "saas",
    "format": "full-implementation",
    "guardrails": ["code", "security", "production"]
  }'
```

Returns:
- `hasRole` — whether any valid blocks were resolved
- `fullPrompt` — composed prompt that includes role blocks + task
- `warnings` — unknown block IDs, if any

### GET /roles/blocks

List available role block IDs for `persona`, `stack`, `domain`, `format`, and `guardrails`.

```bash
curl "https://ss.deeflect.com/api/roles/blocks"
```

---

## Self-Hosting

The API is open source. Run your own if you want full control.

### Local Development

```bash
git clone https://github.com/deeflect/smart-spawn.git
cd smart-spawn
bun install
bun run dev    # starts on http://localhost:3000
```

### Universal MCP Server (OpenRouter Orchestration)

Smart Spawn now includes a local MCP server that can run async multi-agent workflows and return merged results to Codex/Claude/any MCP client.

```bash
cd mcp-server
npm install
OPENROUTER_API_KEY=your_key_here bun run start
```

Default local storage:
- `<current-working-directory>/.smart-spawn-mcp/db.sqlite`
- `<current-working-directory>/.smart-spawn-mcp/artifacts/<run_id>/...`

Root scripts:

```bash
bun run mcp:dev
bun run mcp:start
bun run mcp:typecheck
bun run mcp:test
```

Required env vars for execution:
- `OPENROUTER_API_KEY`

Optional env vars:
- `SMART_SPAWN_API_URL` (default: `https://ss.deeflect.com/api`)
- `SMART_SPAWN_MCP_HOME` (default: `<cwd>/.smart-spawn-mcp`)
- `MAX_PARALLEL_RUNS` (default: `2`)
- `MAX_PARALLEL_NODES_PER_RUN` (default: `4`)
- `MAX_USD_PER_RUN` (default: `5`)
- `NODE_TIMEOUT_SECONDS` (default: `180`)
- `RUN_TIMEOUT_SECONDS` (default: `1800`)

### Connect MCP Client (stdio)

Register the MCP server as a stdio process in your MCP client.

Example (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "smart-spawn": {
      "command": "bun",
      "args": [
        "run",
        "--cwd",
        "/absolute/path/to/smart-spawn/mcp-server",
        "start"
      ],
      "env": {
        "OPENROUTER_API_KEY": "your_openrouter_key_here",
        "SMART_SPAWN_API_URL": "https://ss.deeflect.com/api"
      }
    }
  }
}
```

For Codex or any other MCP host, use the same stdio command + env values in that host's MCP server config format.

### MCP Tools

- `smartspawn_health` — health checks for OpenRouter/API/DB/storage/worker
- `smartspawn_run_create` — create async run and return `run_id`
- `smartspawn_run_status` — get status/progress for a run
- `smartspawn_run_result` — get merged output (and optional raw outputs)
- `smartspawn_artifact_get` — fetch a stored artifact by `run_id` + `node_id`
- `smartspawn_run_list` — list recent runs
- `smartspawn_run_cancel` — cancel queued/running run

### First Run Workflow

1. Check health:

```json
{"name":"smartspawn_health","arguments":{}}
```

2. Create run:

```json
{
  "name": "smartspawn_run_create",
  "arguments": {
    "task": "Design and implement a small REST API with tests",
    "mode": "swarm",
    "budget": "medium",
    "role": {
      "persona": "backend-engineer",
      "stack": ["typescript", "nodejs", "postgres"],
      "format": "full-implementation",
      "guardrails": ["code", "security", "production"]
    }
  }
}
```

3. Poll status until terminal state (`completed`, `failed`, `canceled`):

```json
{"name":"smartspawn_run_status","arguments":{"run_id":"<run_id>"}}
```

4. Get merged result:

```json
{"name":"smartspawn_run_result","arguments":{"run_id":"<run_id>"}}
```

5. Optional: inspect artifacts directly (example: merged output artifact):

```json
{"name":"smartspawn_artifact_get","arguments":{"run_id":"<run_id>","node_id":"merged"}}
```

### Docker

```bash
docker build -t smart-spawn .
docker run -p 3000:3000 -v smart-spawn-data:/app/data smart-spawn
```

### Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template)

The repo includes `railway.json` and `Dockerfile`. Just connect your repo and deploy.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: `3000`) |
| `REFRESH_API_KEY` | No | Protects `/refresh` endpoint. If set, requires `Authorization: Bearer <key>` |

### Rate Limits

- **200 requests/min** per IP (all endpoints)
- **2 requests/hour** per IP on `/refresh`
- Returns `429 Too Many Requests` with `Retry-After` header

These are generous enough for agent use. If you're hitting limits, self-host.

---

## Architecture

```
smart-spawn/
├── src/                        # API server
│   ├── index.ts                # Hono app, middleware, startup
│   ├── db.ts                   # SQLite (cache, spawn logs, scores)
│   ├── types.ts                # All TypeScript types
│   ├── model-selection.ts      # Score sorting, blending logic
│   ├── scoring-utils.ts        # Category classification, score helpers
│   ├── context-signals.ts      # Context tag parsing and boost calculation
│   ├── task-splitter.ts        # Task decomposition for cascade/swarm
│   ├── enrichment/
│   │   ├── pipeline.ts         # Main pipeline: pull → enrich → cache
│   │   ├── scoring.ts          # Z-score normalization, score computation
│   │   ├── rules.ts            # Tier classification, category derivation
│   │   ├── alias-map.ts        # Cross-source model name matching
│   │   └── sources/            # Data source adapters
│   │       ├── openrouter.ts   # OpenRouter model catalog
│   │       ├── artificial.ts   # Artificial Analysis benchmarks
│   │       ├── hf-leaderboard.ts # HuggingFace Open LLM Leaderboard
│   │       ├── lmarena.ts      # LMArena / Chatbot Arena ELO
│   │       └── livebench.ts    # LiveBench scores
│   ├── routes/                 # API endpoints
│   ├── roles/                  # Role composition blocks
│   ├── middleware/              # Rate limiting, response caching
│   └── utils/                  # Input validation
├── smart-spawn/                # OpenClaw plugin
│   ├── index.ts                # Plugin entry point (tool registration)
│   ├── openclaw.plugin.json    # Plugin manifest
│   ├── src/api-client.ts       # API client for plugin
│   └── skills/smart-spawn/     # Companion SKILL.md
├── skills/                     # API-only skill (no plugin required)
│   └── SKILL.md
├── mcp-server/                 # Universal MCP server (async orchestration)
│   ├── src/index.ts            # MCP stdio entrypoint
│   ├── src/tools.ts            # MCP tool contracts
│   ├── src/runtime/            # Planner + queue + executor
│   ├── src/db.ts               # Run/node/event/artifact persistence
│   └── src/storage.ts          # Artifact filesystem manager
├── data/                       # SQLite database (auto-created)
├── Dockerfile
├── railway.json
└── .env.example
```

---

## License

MIT — see [LICENSE](LICENSE).

Built by [@deeflect](https://github.com/deeflect).
