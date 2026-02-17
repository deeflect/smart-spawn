# Smart Spawn — OpenClaw Plugin

Intelligent model routing for [OpenClaw](https://github.com/openclaw/openclaw). Automatically picks the best AI model for any task based on real benchmark data from 5 sources.

Instead of hardcoding models or guessing, Smart Spawn analyzes what you're doing and routes to the optimal model — factoring in task type, budget, benchmarks, speed, and your own feedback history.

## Install

```bash
openclaw plugins install @deeflectcom/smart-spawn
openclaw gateway restart
```

That's it. The plugin talks to the public API at `ss.deeflect.com` — no self-hosting needed.

## Usage

Just use your agent normally. Smart Spawn adds a `smart_spawn` tool that the agent calls when spawning sub-agents:

> "Research the latest developments in WebGPU"
>
> → Picks Gemini 2.5 Flash (fast, free, great context) and spawns a research sub-agent

> "Build me a React dashboard with auth"
>
> → Picks the best coding model in your budget tier and spawns a coder sub-agent

## Spawn Modes

- **Single** — Pick the best model, spawn one agent
- **Collective** — Pick N diverse models, run in parallel, merge results
- **Cascade** — Start cheap, escalate to premium if needed
- **Swarm** — Decompose complex tasks into a DAG of sub-tasks with optimal model per step

## Configuration

Optional — add to your OpenClaw config under `plugins.entries.smart-spawn.config`:

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
| `defaultMode` | `single` | `single`, `collective`, `cascade`, `swarm` |
| `collectiveCount` | `3` | Number of models for collective mode (2-5) |
| `telemetryOptIn` | `false` | Opt-in to anonymous community telemetry |

## How It Works

The plugin calls the Model Intelligence API which:

1. Pulls model data from **5 sources** — OpenRouter, Artificial Analysis, HuggingFace Leaderboard, LMArena (Chatbot Arena), LiveBench
2. **Z-score normalizes** benchmarks across sources so scores are comparable
3. Scores models per category — coding, reasoning, creative, vision, research, fast-cheap, general
4. Factors in **budget tiers**, speed, cost efficiency, and your personal feedback
5. Returns the optimal model for the task

### Budget Tiers

| Budget | Price Range (per 1M input tokens) |
|--------|----------------------------------|
| `low` | $0 – $1 |
| `medium` | $0 – $5 |
| `high` | $2 – $20 |
| `any` | No limit |

## Self-Hosting the API

The API source is in the [same repo](https://github.com/deeflect/smart-spawn). If you want full control, run your own instance and point `apiUrl` to it.

## License

MIT — [@deeflect](https://github.com/deeflect)
