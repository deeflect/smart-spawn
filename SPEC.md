# Smart Spawn — Technical Spec

**Date:** 2026-02-15
**Status:** Draft v2
**Author:** borb

---

## Overview

Two interconnected pieces:

1. **Model Intelligence API** — standalone service that pulls model data from multiple sources (OpenRouter, Artificial Analysis, HF Leaderboard, LMArena, LiveBench), enriches with scores/benchmarks, and serves smart recommendations via REST API. Personal tool first, public later.

2. **Smart Spawn Plugin** — OpenClaw plugin that registers a `smart_spawn` tool. When the agent needs to delegate work and no specific model/agent is requested, it calls the API, picks optimal model(s), and spawns with the right strategy.

---

## Part 1: Model Intelligence API

### Stack

- **Runtime:** Bun
- **Framework:** Hono
- **Deploy:** Railway
- **Storage:** JSON file cache on disk (no DB)
- **Refresh:** On startup + every 6h + manual `POST /refresh`

### Data Sources

| # | Source | Endpoint / Method | What We Get | Refresh |
|---|--------|-------------------|-------------|---------|
| 1 | OpenRouter | `GET /api/v1/models` (free, no auth) | Base catalog (~340 models), pricing, capabilities, context, architecture | 6h |
| 2 | Artificial Analysis | `GET /api/v2/data/llms/models` (API key, 1000 req/day free) | Intelligence/coding/math indices, speed, latency, MMLU-Pro, GPQA, LiveCodeBench, MATH-500, AIME | 6h |
| 3 | HF Open LLM Leaderboard | JSON API via `datasets-server.huggingface.co` (paginated, no auth) | IFEval, BBH, MATH Lvl5, GPQA, MUSR, MMLU-Pro for **open models only** (~30 match) | Daily |
| 4 | LMArena (Chatbot Arena) | CSV from `fboulnois/llm-leaderboard-csv` GitHub releases (daily, no auth) | Arena ELO scores (human preference), 290 models, 76 matched | 6h |
| 5 | LiveBench | Parquet from `datasets/livebench/model_judgment` | Per-task scores (coding, math, reasoning), contamination-free | Monthly |
| 6 | Seed overrides | `src/data/seed-overrides.yaml` (manual) | Corrections for models missing or wrong in automated sources | Manual |

### Model Name Mapping

Every source uses different model identifiers. OpenRouter IDs are canonical.

- **HF Leaderboard → OpenRouter:** Via OpenRouter's `hugging_face_id` field + alias map fallback
- **Artificial Analysis → OpenRouter:** Alias map (display names like `"Claude Opus 4.6"` → `"anthropic/claude-opus-4-6"`)
- **LMArena → OpenRouter:** Alias map with aggressive name normalization (dash-to-space, strip dates/versions, ChatGPT→GPT mapping, Meta- prefix stripping)
- **LiveBench → OpenRouter:** Alias map (version slugs like `"claude-3-opus-20240229"`)

Hand-maintained alias file: `src/data/aliases.yaml` (~200 entries, ~632 name variants). New models need alias entries added when they appear in sources.

### Data Model

#### Enriched Model Schema

```typescript
interface EnrichedModel {
  // Identity
  id: string                    // "anthropic/claude-opus-4-6" (OpenRouter ID, canonical)
  name: string                  // "Claude Opus 4.6"
  provider: string              // "anthropic"

  // From OpenRouter
  contextLength: number         // 200000
  pricing: {
    prompt: number              // per 1M tokens, USD
    completion: number          // per 1M tokens, USD
  }
  capabilities: {
    vision: boolean             // from architecture.input_modalities includes "image"
    functionCalling: boolean    // from supported_parameters includes "tools"
    streaming: boolean
    json: boolean               // from supported_parameters includes "structured_outputs"
    reasoning: boolean          // from supported_parameters includes "reasoning"
  }

  // Enriched (from automated sources + rules + overrides)
  categories: Category[]        // ["coding", "reasoning", "creative"]
  scores: {
    [category in Category]?: number  // 0-100, quality score per category
  }
  costEfficiency: {
    [category in Category]?: number  // quality/cost ratio, higher = better value
  }
  tier: "premium" | "standard" | "budget"
  benchmarks?: {
    arena?: number              // LMArena ELO
    intelligenceIndex?: number  // Artificial Analysis intelligence index
    codingIndex?: number        // Artificial Analysis coding index
    mathIndex?: number          // Artificial Analysis math index
    mmluPro?: number            // MMLU-Pro score
    gpqa?: number               // GPQA score
    liveCodeBench?: number      // LiveCodeBench score
    math500?: number            // MATH-500 score
    ifEval?: number             // IFEval score
    bbh?: number                // BBH score
  }
  speed?: {
    outputTokensPerSecond?: number  // from Artificial Analysis
    timeToFirstToken?: number       // seconds
  }
  tags: string[]                // ["fast", "new", "multimodal", "reasoning"]
  lastUpdated: string           // ISO timestamp
  sourcesCovered: string[]      // ["openrouter", "artificial-analysis", "hf-leaderboard"]
}

type Category =
  | "coding"
  | "reasoning"
  | "creative"
  | "fast-cheap"
  | "vision"
  | "research"
  | "general"
```

### Enrichment Pipeline

Four layers, applied in order:

#### Layer 1: OpenRouter Base
Pull catalog, extract: id, name, provider, pricing, context, capabilities, architecture.
Derive capabilities from `supported_parameters` and `architecture.input_modalities`.

#### Layer 2: Automated Benchmark Sources
Pull Artificial Analysis, HF Leaderboard, LMArena, LiveBench.
Map model names → OpenRouter IDs via alias map.
Merge benchmark scores into `benchmarks` field.

#### Layer 3: Rule-Based Classification
Deterministic rules from model metadata + benchmarks:
- Has vision capability → add `vision` category
- Price < $1/1M prompt → add `fast-cheap` category
- Context > 100K → add `research` tag
- Has reasoning capability → add `reasoning` tag
- Provider + pricing → tier classification
- Benchmark scores → category scores (coding index → coding score, etc.)

#### Layer 4: Seed Overrides (highest priority)
Manual YAML overrides for corrections:
- Fix wrong scores from automated sources
- Add scores for models missing from all automated sources
- Force category assignments

#### Scoring Formula

**Source: Artificial Analysis (primary for frontier models)**

AA Intelligence Index v4.0 uses a **-100 to +100 scale**:
- 0 = as many correct as incorrect answers
- 4 equal-weight categories: Agents (25%), Coding (25%), General (25%), Scientific Reasoning (25%)
- Scored via pass@1 across 10 evaluations
- Current top: Opus 4.6 ~53, GPT-5.2 ~51

We normalize to 0-100: `normalized = (raw + 100) / 2`
So: -100 → 0, 0 → 50, 53 → 76.5, 100 → 100

AA also provides raw accuracy benchmarks (MMLU-Pro, GPQA, LiveCodeBench, MATH-500) as 0-1 fractions.
We convert to percentages: `percent = raw * 100`

```
general_score = normalizeAA(aa.intelligenceIndex)
coding_score = normalizeAA(aa.codingIndex)
reasoning_score = normalizeAA(aa.intelligenceIndex) (boosted if model has reasoning capability)
```

**Source: HF Open LLM Leaderboard (for open models)**

HF scores are already 0-100 normalized where random=0, perfect=100. No conversion needed.

```
general_score = hf.mmluPro (fallback from AA)
coding_score = estimate from general * 0.85 (HF has no coding-specific benchmark)
```

**Fallback: Tier baselines (for models with no benchmark data)**
```
base_score = tier_baseline[tier]  // premium=70, standard=50, budget=30
```

**Cost efficiency per category:**
```
costEfficiency[cat] = scores[cat] / (pricing.prompt + pricing.completion)
```

### API Endpoints

#### `GET /models`

Full enriched catalog. Cached, refreshed on schedule.

**Query params:**
- `category` — filter by category
- `tier` — filter by tier
- `limit` — max results (default 50)
- `sort` — `score`, `cost`, `efficiency` (default: `score`)

**Response:**
```json
{
  "data": [EnrichedModel],
  "meta": {
    "total": 100,
    "filtered": 50,
    "lastRefresh": "2026-02-15T10:00:00Z",
    "version": "1.0.0"
  }
}
```

#### `GET /recommend`

Smart recommendation for a task.

**Query params:**
- `task` — required. One of: `coding`, `reasoning`, `creative`, `research`, `general`, or free text
- `budget` — `low` | `medium` | `high` | `any` (default: `medium`)
- `count` — how many recommendations (default: 1, max: 5)
- `exclude` — comma-separated model IDs to exclude
- `require` — comma-separated capabilities: `vision`, `functionCalling`, `json`, `reasoning`
- `minContext` — minimum context length

**Response:**
```json
{
  "data": [
    {
      "model": EnrichedModel,
      "reason": "Top coding model with best cost-efficiency at medium budget",
      "confidence": 0.92
    }
  ],
  "meta": { "task": "coding", "budget": "medium" }
}
```

**Budget mapping:**
- `low` — under $1/1M prompt tokens
- `medium` — under $5/1M prompt tokens
- `high` — under $20/1M prompt tokens
- `any` — no price filter

#### `GET /pick`

Simple opinionated pick. Returns one model ID.

**Query params:**
- `task` — required
- `budget` — optional (default: `medium`)

**Response:**
```json
{
  "data": {
    "id": "anthropic/claude-opus-4-6",
    "reason": "Top coding model at medium budget"
  }
}
```

#### `GET /status`

```json
{
  "data": {
    "status": "ok",
    "lastRefresh": "2026-02-15T10:00:00Z",
    "modelCount": 100,
    "sources": {
      "openrouter": { "status": "ok", "lastPull": "...", "count": 100 },
      "artificialAnalysis": { "status": "ok", "lastPull": "...", "count": 60 },
      "hfLeaderboard": { "status": "ok", "lastPull": "...", "count": 200 },
      "lmarena": { "status": "ok", "lastPull": "...", "count": 80 },
      "livebench": { "status": "ok", "lastPull": "...", "count": 100 }
    },
    "version": "1.0.0"
  }
}
```

#### `POST /refresh`

Trigger manual enrichment refresh. Returns immediately, refresh runs in background.

```json
{ "data": { "started": true, "estimatedSeconds": 30 } }
```

### Refresh Pipeline

Every 6 hours (or on `POST /refresh`):
1. Pull OpenRouter `/api/v1/models`
2. Pull Artificial Analysis `/api/v2/data/llms/models`
3. Pull HF Open LLM Leaderboard via JSON API
4. Pull LMArena CSV from GitHub releases
5. Pull LiveBench Parquet (if monthly check needed)
6. Map all names → OpenRouter IDs via alias map
7. Merge all sources into EnrichedModel
8. Apply rule-based classification
9. Apply seed overrides
10. Compute cost-efficiency scores
11. Write to `data/models.json`
12. Log diff (new models, removed models, score changes)

On startup: load from cache if exists, serve immediately, refresh in background.

---

## Part 2: OpenClaw Plugin (`smart-spawn`)

### Plugin Manifest

```json
{
  "id": "smart-spawn",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "apiUrl": {
        "type": "string",
        "default": "https://model-intel.borb.bot",
        "description": "Model Intelligence API URL"
      },
      "defaultBudget": {
        "type": "string",
        "enum": ["low", "medium", "high", "any"],
        "default": "medium"
      },
      "defaultMode": {
        "type": "string",
        "enum": ["single", "collective", "cascade"],
        "default": "single"
      },
      "collectiveCount": {
        "type": "number",
        "default": 3,
        "minimum": 2,
        "maximum": 5
      },
      "maxBudgetPerTask": {
        "type": "number",
        "default": 1.0
      },
      "fallbackModels": {
        "type": "object",
        "properties": {
          "coding": { "type": "string", "default": "anthropic/claude-opus-4-6" },
          "reasoning": { "type": "string", "default": "anthropic/claude-opus-4-6" },
          "creative": { "type": "string", "default": "anthropic/claude-opus-4-6" },
          "research": { "type": "string", "default": "google/gemini-2.5-flash" },
          "fast-cheap": { "type": "string", "default": "moonshotai/kimi-k2-thinking" },
          "general": { "type": "string", "default": "anthropic/claude-sonnet-4" }
        }
      }
    }
  },
  "uiHints": {
    "apiUrl": { "label": "API URL", "placeholder": "https://model-intel.borb.bot" },
    "defaultBudget": { "label": "Default Budget" },
    "defaultMode": { "label": "Default Spawn Mode" },
    "maxBudgetPerTask": { "label": "Max $ Per Task" }
  }
}
```

### Tool Registration

```typescript
// index.ts
export default function (api) {
  const config = api.config.plugins?.entries?.["smart-spawn"]?.config ?? {};

  api.registerTool({
    name: "smart_spawn",
    description: `Intelligently spawn sub-agent(s) for a task. Automatically selects the best model(s) based on task type, budget, and strategy. Use this instead of sessions_spawn when you want optimal model selection. Do NOT use this when the user explicitly requests a specific agent or model.`,
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The task to delegate. Be specific."
        },
        category: {
          type: "string",
          enum: ["coding", "reasoning", "creative", "research", "general", "auto"],
          description: "Task category. 'auto' lets the API classify it.",
          default: "auto"
        },
        mode: {
          type: "string",
          enum: ["single", "collective", "cascade"],
          description: "Spawning strategy.",
          default: "single"
        },
        budget: {
          type: "string",
          enum: ["low", "medium", "high", "any"]
        },
        collectiveCount: {
          type: "number",
          minimum: 2,
          maximum: 5
        },
        label: {
          type: "string",
          description: "Optional label for the spawned session."
        }
      },
      required: ["task"]
    },
    async execute(input, ctx) {
      // Implementation in modes/single.ts, collective.ts, cascade.ts
    }
  });
}
```

### Execution Flows

#### Mode: Single

```
1. Call API: GET /pick?task={category}&budget={budget}
2. Get recommended model ID
3. Call sessions_spawn(task, model=recommended.id, label)
4. Return spawn confirmation + model choice reasoning
```

#### Mode: Collective

```
1. Call API: GET /recommend?task={category}&budget={budget}&count={collectiveCount}
2. Get N recommended models (diverse — different providers/architectures)
3. Fan-out: spawn N agents in parallel, same task, different models
4. Wait for all to complete (with timeout)
5. Collect all outputs
6. Spawn one final "merge" agent with all outputs
7. Merge agent synthesizes best answer
8. Return merged result + individual model outputs for transparency
```

**Merge Agent Prompt:**
```
You are a synthesis agent. You received the same task processed by multiple AI models.
Your job:
1. Compare all responses for accuracy, completeness, and quality
2. Identify where they agree (high confidence) and disagree (needs judgment)
3. Produce a single best response that takes the strongest parts of each
4. Note which model(s) performed best and why

Task: {original_task}

Model outputs:
---
Model A ({model_id}): {output_a}
---
Model B ({model_id}): {output_b}
---
Model C ({model_id}): {output_c}
---

Synthesize the best possible response.
```

#### Mode: Cascade

```
1. Call API: GET /pick?task={category}&budget=low → cheap model
2. Spawn agent with cheap model
3. Get result
4. Quality check: spawn a judge agent that scores the output 1-10
5. If score >= 7: return result (done, saved money)
6. If score < 7:
   a. Call API: GET /pick?task={category}&budget=high → premium model
   b. Spawn agent with premium model, include cheap model's output as context
   c. Return premium result
7. Track cost savings
```

### Fallback Behavior

If Model Intelligence API is unreachable:
1. Log warning
2. Use `fallbackModels` from plugin config
3. Map task category → fallback model
4. Proceed with single mode only

### Companion Skill

```markdown
# Smart Spawn

When delegating tasks to sub-agents, prefer `smart_spawn` over `sessions_spawn` unless:
- The user explicitly requests a specific agent
- The user explicitly requests a specific model
- You're doing a simple, well-defined task where you already know the right model

## When to use each mode:
- **single** (default) — most tasks, fastest
- **collective** — important decisions, creative work, diverse perspectives
- **cascade** — cost-sensitive tasks where cheap might be good enough
```

---

## Part 3: File Structure

```
smart-spawn/
├── src/
│   ├── index.ts                  # Hono server entry
│   ├── routes/
│   │   ├── models.ts             # GET /models
│   │   ├── recommend.ts          # GET /recommend
│   │   ├── pick.ts               # GET /pick
│   │   ├── status.ts             # GET /status
│   │   └── refresh.ts            # POST /refresh
│   ├── enrichment/
│   │   ├── pipeline.ts           # Orchestrator
│   │   ├── sources/
│   │   │   ├── openrouter.ts     # OpenRouter client
│   │   │   ├── artificial.ts     # Artificial Analysis API client
│   │   │   ├── hf-leaderboard.ts # HF JSON API client
│   │   │   ├── lmarena.ts        # LMArena CSV from GitHub releases
│   │   │   └── livebench.ts      # LiveBench Parquet puller (not yet implemented)
│   │   ├── alias-map.ts          # Name → OpenRouter ID resolver
│   │   ├── rules.ts              # Rule-based classification
│   │   └── scoring.ts            # Composite score computation
│   ├── data/
│   │   ├── seed-overrides.yaml   # Manual corrections (highest priority)
│   │   └── aliases.yaml          # Model name aliases across all sources
│   └── types.ts
├── smart-spawn/                  # OpenClaw plugin
│   ├── openclaw.plugin.json
│   ├── index.ts
│   ├── src/
│   │   └── api-client.ts
│   └── skills/
│       └── SKILL.md
├── data/
│   └── models.json               # Generated cache (gitignored)
├── package.json
├── tsconfig.json
├── SPEC.md
├── TODO.md
├── CLAUDE.md
└── agents.md
```

---

## Part 4: Open Questions

### Resolved
- ~~Auth for API~~ → personal tool, no auth needed for v1
- ~~Seed data vs automated~~ → automated primary, seed is override layer
- ~~Artificial Analysis API~~ → confirmed: REST API exists, free tier sufficient, -100 to +100 index scale documented
- ~~Plugin API format~~ → uses `parameters` + `execute(_callId, params)` per OpenClaw docs
- ~~HF data access~~ → using datasets-server.huggingface.co JSON API (paginated, no Parquet reader needed)

- ~~LMArena pickle parsing~~ → solved: using fboulnois/llm-leaderboard-csv daily CSV releases (pure TypeScript, no Python needed)

### Remaining
1. **API hosting domain** — `model-intel.borb.bot`? Something else?
2. **Merge model for collective** — always use the "best" model, or configurable?

### Risks
- **Model name mapping drift** — new models appear in sources with new naming conventions. Alias map needs ongoing maintenance.
- **API downtime** — plugin falls back to hardcoded defaults.
- **Token cost of collective mode** — 3x models + merge = 4x cost. Need clear UX.
- **Cascade judge reliability** — cheap model scoring quality is noisy. Needs tuning.
- **Artificial Analysis free tier** — 1000 req/day is plenty now but could be an issue if service goes public.
- **HF API flakiness** — datasets-server sometimes returns different row counts between requests.

---

## Roadmap

### v1.1 — Provider-Aware Routing
Instead of always routing through OpenRouter, detect if the user has direct provider keys configured:
- Read `api.config.auth.profiles` to find direct provider keys (e.g., `anthropic:manual`)
- Read `api.config.models.providers` to find custom provider configs
- If user has direct Anthropic key → route `anthropic/*` models through direct provider, not OpenRouter
- Only use `openrouter/` prefix for models the user doesn't have direct access to
- Saves money automatically (no OpenRouter markup on directly-available models)

### v1.2 — Cost Dashboard
Track and report on smart-spawn usage:
- Log every spawn to SQLite: model, category, budget, timestamp, estimated cost
- Register a `/smartspawn` slash command showing: total spend, spend by model, spend by category
- Calculate savings: "vs always using opus, smart-spawn saved $X this week"
- Track cascade hit rate: how often cheap model was good enough
- Export stats for integration with morning digest or session summary

### v2 — Learning Loop + Community Rankings
Track what actually works for the user's tasks:
- Log spawn outcomes: did user accept result or ask to redo?
- Build personal model rankings per category over time
- "For your coding tasks, Kimi K2.5 outperforms Opus 60% of the time"
- Feed personal rankings back into recommendations
- Eventually: aggregate anonymous usage data across OpenClaw instances for crowdsourced quality signals
- Community rankings surface models that perform well in real usage, not just benchmarks

### v2.1 — Context-Aware Routing
Go beyond category-level routing:
- Pass project context to recommendations: tech stack, language, domain
- Score models per technology stack based on learning loop data
- "When task mentions Next.js + Supabase, model X has 90% acceptance rate"
- Subcategory benchmarks (LiveBench coding vs agentic coding vs math) inform finer routing

### v3 — Task Decomposition
Before spawning, optionally break complex tasks into subtasks:
- Orchestrator agent analyzes task complexity
- Breaks into subtasks, each routed to optimal model
- "Build a full-stack app" → backend (coding model) + UI (frontend model) + architecture (reasoning model)
- Coordinate subtask outputs into final result

### OpenRouter Auto Comparison
| | OpenRouter Auto | Smart Spawn |
|---|---|---|
| Routing level | Per API call (prompt) | Per agent task |
| Intelligence | Black box (NotDiamond) | Transparent scores from 5 benchmark sources |
| Modes | Single model only | Single, Collective (ensemble), Cascade |
| Budget control | cost/speed strategy | 4 tiers with $/M awareness |
| Transparency | Shows which model used | Shows scores, reasons, sources |
| Scope | Routes one completion | Spawns full agent sessions |
| Collective | ❌ | Fan out to N models + merge |
| Cascade | ❌ | Cheap first → judge → escalate |
| Learning | ❌ | Tracks outcomes, improves over time |
| Provider-aware | ❌ | Routes through cheapest available provider |

---

## Important: OpenClaw Plugin execute() Signature

```typescript
// CORRECT:
async execute(_callId: string, params: any) {
  // _callId = unique call ID string
  // params = the parameters object from the LLM
  return { content: [{ type: "text", text: "result" }] };
}

// WRONG (will crash):
async execute(input: any, ctx: any) { ... }
```

- Plugin tools CANNOT call other tools from inside execute()
- No `ctx.callTool()` available
- Tool returns content, agent acts on it
- Use companion SKILL.md to instruct the agent how to act on the JSON response
