# CLAUDE.md — Smart Spawn Development Guide

## Project Overview

Smart Spawn is two interconnected pieces:

1. **Model Intelligence API** — standalone Bun/Hono service that pulls OpenRouter models, enriches with benchmark data from 5 sources, and serves model recommendations via REST API
2. **OpenClaw Plugin** — registers a `smart_spawn` agent tool that calls the API, picks optimal model(s), and returns JSON instructions for the agent to spawn sub-agents

**Goal:** Any OpenClaw user installs the plugin, adds their OpenRouter key, and their agent automatically picks the best model for every delegated task. Zero config beyond that.

## Current State

### Model Intelligence API (working)
- Location: `src/`
- Running on port 3000 via `bun run dev`
- 340 models from OpenRouter, 213 with benchmarks
- 5 data sources: OpenRouter, Artificial Analysis, HuggingFace, LMArena, LiveBench
- SQLite cache with WAL, 6h incremental refresh
- Z-score normalization for benchmark scoring with data-driven weights
- Spawn logging for cost dashboard (`POST /spawn-log`, `GET /spawn-log/stats`)

### Plugin (working, tested)
- Location: `smart-spawn/`
- All 3 modes tested end-to-end on Docker OpenClaw instance
- Tool returns JSON recommendations, agent acts on them via SKILL.md
- Provider-aware routing: detects direct keys, skips OpenRouter markup
- Spawn logging on every call (fire-and-forget to API)

---

## Architecture

```
User says "research X" → Agent decides to delegate
    ↓
Agent calls smart_spawn(task="research X", category="research", budget="low")
    ↓
Plugin calls Model Intelligence API: GET /pick?task=research&budget=low
    ↓
API returns: { id: "google/gemini-2.5-flash", score: 78, pricing: {...}, reason: "..." }
    ↓
Plugin checks auth profiles → user has direct google-gemini key? Use "google/gemini-2.5-flash"
    ↓                         → no direct key? Use "openrouter/google/gemini-2.5-flash"
Plugin returns JSON: { action: "spawn", model: "...", task: "...", label: "..." }
    ↓
Agent parses JSON, calls sessions_spawn with recommended model (guided by SKILL.md)
    ↓
Sub-agent runs on selected model, returns result
    ↓
Plugin logs spawn to API for cost tracking (fire-and-forget)
```

### Provider-Aware Routing
Plugin reads `api.config.auth.profiles` at startup to detect direct provider keys.
If user has `anthropic:default` auth → Anthropic models skip `openrouter/` prefix.
If user only has `openrouter:default` → all models route through OpenRouter.
Saves money automatically on directly-available models.

---

## OpenClaw Plugin System — Key Facts

### Plugin Structure
```
smart-spawn/
├── openclaw.plugin.json    # Manifest (REQUIRED)
├── index.ts                # Entry point (all mode logic inline)
├── package.json            # Dependencies (if any)
├── src/
│   └── api-client.ts       # HTTP client for Model Intelligence API
└── skills/
    └── SKILL.md            # Agent prompt guidance for JSON→sessions_spawn handoff
```

### CRITICAL: execute() signature
```typescript
async execute(_callId: string, params: any)
```
- First arg is ALWAYS the call ID string
- Second arg is the params object
- Do NOT use `(input, ctx)` — that's wrong
- Cannot call other tools from inside execute() — no `ctx.callTool()` available
- Tool can only return content; the AGENT then acts on it via SKILL.md

### What `api` provides
- `api.config` — full OpenClaw config (read-only)
- `api.registerTool()` — register agent tools
- `api.config.auth.profiles` — auth profiles (detect which providers user has)
- `api.config.models.providers` — custom provider configs

### Auth Profile Structure
```json
{
  "anthropic:default": { "provider": "anthropic", "mode": "api_key" },
  "openrouter:default": { "provider": "openrouter", "mode": "api_key" },
  "google-gemini:default": { "provider": "google-gemini", "mode": "api_key" }
}
```
Profile ID format: `{provider}:{identifier}`. Provider names map to model prefixes:
- `anthropic` → `anthropic/`
- `openai` → `openai/`
- `google-gemini` → `google/`
- `aws-bedrock` → `amazon/`

### Plugin Config (user side)
```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/smart-spawn/smart-spawn"]
    },
    "entries": {
      "smart-spawn": {
        "enabled": true,
        "config": {
          "apiUrl": "http://localhost:3000",
          "defaultBudget": "medium"
        }
      }
    }
  }
}
```

---

## Model Intelligence API

### Endpoints
```
GET /pick?task=coding&budget=medium&exclude=id1,id2  → Single best model (with pricing)
GET /recommend?task=coding&count=3&budget=low         → Top N models (diverse providers)
GET /models?category=coding&sort=coding&limit=5       → Browse catalog
GET /compare?models=model1,model2                     → Compare models
GET /status                                           → Health + stats
POST /refresh                                         → Trigger data refresh
POST /spawn-log                                       → Log a spawn event
GET /spawn-log/stats?days=7                           → Cost analytics
```

### Budget Tiers (price per 1M prompt tokens)
- `low` — $0-1 (cheapest usable models)
- `medium` — $0-5 (mid-range, best value)
- `high` — $2-20 (premium models, floor ensures quality)
- `any` — no price filter

### /pick Response
```json
{
  "data": {
    "id": "anthropic/claude-opus-4.6",
    "name": "Claude Opus 4.6",
    "provider": "anthropic",
    "score": 82,
    "pricing": { "prompt": 5, "completion": 25 },
    "budget": "medium",
    "tier": { "min": 0, "max": 5 },
    "candidateCount": 45,
    "reason": "Best coding model at medium budget ($0-5/M) — score: 82"
  }
}
```

### Scoring
- Z-score normalization: each benchmark → (value - mean) / stddev → mapped to 0-100
- Weighted average per category (weights from signal analysis):
  - Coding: LiveCodeBench(4) > AgenticCoding(3) > LiveBenchCoding(2) > codingIndex(1)
  - General: Arena(3) > MMLU-Pro(2) > GPQA(2) > intelligenceIndex(1)
  - Reasoning: LiveBenchReasoning(3) > GPQA(3) > mathIndex(2) > Arena(1) > ii(1)
  - Creative: Arena(4) > LiveBenchLanguage(2) > general(1)

---

## Smart Spawn Modes

### Single (default)
Pick best model → return JSON → agent spawns one agent.

### Collective
Pick N diverse models → return JSON → agent spawns N in parallel + merge agent.
- Models from different providers for diversity
- JSON includes per-model labels and merge label

### Cascade
Pick cheap + premium models → return JSON → agent tries cheap first, escalates if needed.
- Cheap pick uses `budget=low`, premium uses `budget=high`
- `?exclude=` ensures premium is a different model than cheap
- JSON includes scoring/pricing for both so agent can make informed escalation decision

---

## Development Commands

```bash
# Start API server
bun run dev                    # Hot reload on :3000

# Test API
curl 'localhost:3000/status'
curl 'localhost:3000/pick?task=coding&budget=medium'
curl 'localhost:3000/recommend?task=research&count=3'
curl 'localhost:3000/spawn-log/stats?days=7'

# Trigger data refresh
curl -X POST 'localhost:3000/refresh'

# After plugin changes, restart OpenClaw gateway
openclaw gateway restart
```

## File Structure
```
smart-spawn/
├── CLAUDE.md               # This file
├── SPEC.md                 # Full technical spec
├── TODO.md                 # Task checklist
├── README.md               # User-facing docs
├── package.json            # Bun project
├── tsconfig.json
├── src/                    # Model Intelligence API
│   ├── index.ts            # Hono server entry
│   ├── db.ts               # SQLite cache + spawn_log table
│   ├── types.ts            # Shared types
│   ├── routes/             # API endpoints
│   │   ├── pick.ts         # GET /pick (with exclude, pricing)
│   │   ├── recommend.ts    # GET /recommend
│   │   ├── models.ts       # GET /models
│   │   ├── status.ts       # GET /status
│   │   ├── refresh.ts      # POST /refresh
│   │   └── spawn-log.ts    # POST /spawn-log + GET /spawn-log/stats
│   └── enrichment/         # Data source adapters
│       ├── pipeline.ts     # Orchestrates all sources (incremental refresh)
│       └── scoring.ts      # Z-score normalization + weighted scoring
├── data/                   # Cached data, seed YAML, SQLite DB
├── smart-spawn/            # OpenClaw plugin
│   ├── openclaw.plugin.json
│   ├── index.ts            # Plugin entry + tool registration (all modes inline)
│   ├── package.json
│   ├── src/
│   │   └── api-client.ts   # HTTP client for our API
│   └── skills/
│       └── SKILL.md        # Agent prompt guidance (JSON→sessions_spawn handoff)
└── agents.md               # Agent behavior docs
```
