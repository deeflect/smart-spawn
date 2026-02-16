<p align="center">
  <img src="https://img.shields.io/badge/bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/hono-%23E36002.svg?style=for-the-badge&logo=hono&logoColor=white" alt="Hono">
  <img src="https://img.shields.io/badge/sqlite-%2307405e.svg?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/OpenRouter-6366F1?style=for-the-badge" alt="OpenRouter">
  <img src="https://img.shields.io/badge/OpenClaw-FF6B35?style=for-the-badge" alt="OpenClaw">
</p>

<h1 align="center">⚡ Smart Spawn</h1>

<p align="center">
  <strong>Intelligent AI model routing for <a href="https://github.com/openclaw/openclaw">OpenClaw</a></strong><br>
  Pick the best model for any task. Automatically. With benchmarks.
</p>

<p align="center">
  <code>342 models</code> · <code>5 data sources</code> · <code>5 spawn modes</code> · <code>150+ role blocks</code>
</p>

---

## What is this?

Smart Spawn is a two-part system:

1. **Model Intelligence API** — indexes 342+ models from OpenRouter, enriches them with real benchmark data from 5 sources, and serves smart recommendations
2. **OpenClaw Plugin** — registers a `smart_spawn` tool that auto-picks the optimal model, composes expert role instructions, and spawns sub-agents

The result: your AI assistant picks the right model for the job and makes cheap models perform like specialists with targeted role prompts.

```
You: "build me a react dashboard"

Smart Spawn:
  → Task type: frontend
  → Budget: medium ($0-5/M tokens)
  → Best model: google/gemini-2.5-pro (score: 0.89, $1.25/M)
  → Role: frontend-engineer + react + tailwind + full-implementation
  → Spawns sub-agent with expert prompt (~200 words)
  → 98% cheaper than using Claude Opus for everything
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      OpenClaw Agent                      │
│                                                         │
│  User message → smart_spawn tool → JSON response        │
│                      │                                   │
│                      ▼                                   │
│              sessions_spawn()                            │
│           (with optimal model + role prompt)              │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│              Model Intelligence API                       │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌───────────┐ │
│  │OpenRouter│  │Artificial│  │HuggingFace│ │  LMArena  │ │
│  │  Models  │  │ Analysis │  │Leaderboard│ │  Rankings │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘ └─────┬─────┘ │
│       │              │              │              │      │
│       ▼              ▼              ▼              ▼      │
│  ┌──────────────────────────────────────────────────┐    │
│  │           Unified Model Index (SQLite)            │    │
│  │     342 models · Z-score normalized scores        │    │
│  │         Auto-refresh every 6 hours                │    │
│  └──────────────────────┬───────────────────────────┘    │
│                         │                                │
│       ┌─────────────────┼─────────────────┐              │
│       ▼                 ▼                 ▼              │
│  ┌─────────┐     ┌───────────┐     ┌──────────┐        │
│  │  /pick  │     │/recommend │     │  /roles   │        │
│  │Best model│    │  Top N    │     │ Compose   │        │
│  │for task  │    │by category│     │  prompt   │        │
│  └─────────┘    └───────────┘     └──────────┘         │
└──────────────────────────────────────────────────────────┘
```

## Spawn Modes

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   SINGLE     │     │  COLLECTIVE  │     │   CASCADE    │
│              │     │              │     │              │
│  One model,  │     │  N models,   │     │ Cheap first, │
│  best pick   │     │  merge best  │     │ escalate if  │
│              │     │  answers     │     │ quality low  │
└──────────────┘     └──────────────┘     └──────────────┘

┌──────────────┐     ┌──────────────┐
│    PLAN      │     │    SWARM     │
│              │     │              │
│  Sequential  │     │  Parallel    │
│  steps with  │     │  subtasks    │
│  context     │     │  with DAG    │
│  passing     │     │  deps        │
└──────────────┘     └──────────────┘
```

## Data Sources

| Source | What it provides | Models matched |
|--------|-----------------|----------------|
| **OpenRouter** | Pricing, context length, capabilities | 342 (base) |
| **Artificial Analysis** | Speed, quality, latency benchmarks | ~163 |
| **LMArena** | Human preference ELO ratings | ~78 |
| **LiveBench** | Contamination-free benchmark scores | ~70 |
| **HuggingFace Open LLM** | Academic benchmark scores | ~30 |

All scores are **Z-score normalized** for fair cross-source comparison.

## Role Composition System

Smart Spawn includes a composable role system with **150+ building blocks** that the agent assembles into expert prompts:

```
┌─────────────────────────────────────────────────┐
│              Role Prompt (~200 words)             │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ PERSONA  │  │  STACK   │  │  DOMAIN  │      │
│  │          │  │  (1-4)   │  │          │      │
│  │ frontend │  │ react    │  │ saas     │      │
│  │ engineer │  │ tailwind │  │          │      │
│  │          │  │ nextjs   │  │          │      │
│  └──────────┘  └──────────┘  └──────────┘      │
│                                                  │
│  ┌──────────┐  ┌──────────────────────┐         │
│  │  FORMAT  │  │     GUARDRAILS       │         │
│  │          │  │                      │         │
│  │ full-    │  │ code · production    │         │
│  │ implemen │  │ (auto-applied)       │         │
│  │ tation   │  │                      │         │
│  └──────────┘  └──────────────────────┘         │
└─────────────────────────────────────────────────┘
```

**38 personas** · **82+ tech stacks** · **15 domains** · **17 formats** · **6 guardrails**

The agent picks relevant blocks. The API just assembles. No keyword detection — the LLM already understands the task.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/pick` | `GET` | Best model for a task type + budget |
| `/recommend` | `GET` | Top N models by category |
| `/models` | `GET` | Full model index with benchmarks |
| `/compare` | `GET` | Side-by-side model comparison |
| `/roles/compose` | `POST` | Assemble role prompt from blocks |
| `/roles/blocks` | `GET` | List all available block IDs |
| `/decompose` | `POST` | Split task into subtasks |
| `/swarm` | `POST` | Build parallel execution DAG |
| `/status` | `GET` | API health + model count |
| `/refresh` | `POST` | Force data refresh |
| `/spawn-log` | `POST/GET` | Log and query spawn history |
| `/community` | `GET` | Aggregated community stats |

### Quick Examples

```bash
# Best model for coding on a budget
curl "localhost:3000/pick?task=coding&budget=low"

# Top 5 reasoning models
curl "localhost:3000/recommend?category=reasoning&limit=5"

# Compose a role prompt
curl -X POST "localhost:3000/roles/compose" \
  -H "Content-Type: application/json" \
  -d '{"persona":"frontend-engineer","stack":["react","tailwind"],"format":"full-implementation"}'

# API status
curl "localhost:3000/status"
```

## Installation

### 1. Run the API

```bash
git clone https://github.com/borbbot/smart-spawn.git
cd smart-spawn
bun install
bun run dev
```

The API starts on port 3000 (or `$PORT`). It auto-fetches model data on startup and refreshes every 6 hours.

**Optional:** Set `ARTIFICIAL_ANALYSIS_API_KEY` for richer benchmark data (~163 more models with quality/speed scores).

### 2. Install the OpenClaw Plugin

Copy the `smart-spawn/` directory into your OpenClaw plugins folder:

```bash
cp -r smart-spawn/ ~/.openclaw/plugins/smart-spawn/
```

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "smart-spawn": {
      "apiUrl": "http://localhost:3000",
      "defaultBudget": "medium",
      "defaultMode": "single"
    }
  }
}
```

Restart OpenClaw. The `smart_spawn` tool and companion skill are now available.

### 3. Deploy the API (Railway)

```bash
# Railway CLI
railway init
railway up

# Add a volume for SQLite persistence (mount: /app/data)
# Set ARTIFICIAL_ANALYSIS_API_KEY in Railway variables
```

Or use the included `Dockerfile`:

```bash
docker build -t smart-spawn .
docker run -p 3000:3000 -v smart-spawn-data:/app/data smart-spawn
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiUrl` | string | `http://localhost:3000` | Model Intelligence API URL |
| `defaultBudget` | string | `medium` | Budget tier: `low` ($0-1/M), `medium` ($0-5/M), `high` ($2-20/M), `any` |
| `defaultMode` | string | `single` | Spawn mode: `single`, `collective`, `cascade`, `plan`, `swarm` |
| `collectiveCount` | number | `3` | Models for collective mode (2-5) |
| `telemetryOptIn` | boolean | `false` | Share anonymous spawn stats |

## Budget Tiers

| Tier | Price Range | Use Case |
|------|------------|----------|
| **low** | $0 - $1/M tokens | Quick tasks, bulk processing |
| **medium** | $0 - $5/M tokens | Most tasks, good quality/cost balance |
| **high** | $2 - $20/M tokens | Complex reasoning, architecture |
| **any** | Unlimited | Best model regardless of cost |

## How Scoring Works

```
Final Score = weighted average of:
  ├── OpenRouter quality    (if available)
  ├── Artificial Analysis   (if available)
  ├── LMArena ELO          (if available)
  ├── LiveBench score       (if available)
  └── HuggingFace score     (if available)

All normalized to Z-scores for fair comparison.
Task-type multipliers boost relevant benchmarks:
  coding  → weight coding/reasoning benchmarks higher
  creative → weight language/creative benchmarks higher
  math    → weight math benchmarks higher
```

## Project Structure

```
smart-spawn/
├── src/
│   ├── index.ts              # Hono server entrypoint
│   ├── enrichment/
│   │   └── pipeline.ts       # Data fetching + enrichment pipeline
│   ├── routes/
│   │   ├── pick.ts           # /pick — best model selection
│   │   ├── recommend.ts      # /recommend — top N models
│   │   ├── models.ts         # /models — full index
│   │   ├── roles.ts          # /roles — prompt composition
│   │   ├── decompose.ts      # /decompose — task splitting
│   │   ├── swarm.ts          # /swarm — parallel DAG
│   │   ├── status.ts         # /status — health check
│   │   ├── refresh.ts        # /refresh — force update
│   │   ├── spawn-log.ts      # /spawn-log — history
│   │   └── community.ts      # /community — shared stats
│   ├── roles/
│   │   ├── blocks.ts         # 150+ composable role blocks
│   │   └── composer.ts       # Block assembly engine
│   └── types.ts              # Shared types
├── smart-spawn/              # OpenClaw plugin
│   ├── index.ts              # Plugin entrypoint (registerTool)
│   ├── openclaw.plugin.json  # Plugin manifest
│   ├── package.json
│   └── skills/
│       └── smart-spawn/
│           └── SKILL.md      # Agent instructions
├── data/                     # SQLite cache (gitignored)
├── Dockerfile
├── railway.json
└── package.json
```

## Why?

Most AI assistants use one model for everything. That's like using a sledgehammer for every job.

Smart Spawn picks **the right model** based on:
- What the task actually needs (coding vs writing vs analysis)
- Real benchmark data (not vibes)
- Your budget constraints
- Available models right now

Then it makes that model even better with targeted expert prompts. A $0.10/M model with the right role prompt outperforms a $15/M model running blind.

**Measured results:** 88-98% cost savings with comparable quality using cascade mode.

## License

MIT

---

<p align="center">
  Built by <a href="https://github.com/borbbot">@borbbot</a> · Powered by <a href="https://openrouter.ai">OpenRouter</a>
</p>
