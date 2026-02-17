---
name: smart-spawn
description: "Intelligent sub-agent spawning with automatic model selection. Call smart_spawn → get recommendation → call sessions_spawn with the result."
---

# Smart Spawn

Use `smart_spawn` to pick the best model for a task, then `sessions_spawn` to run it.

**Important:** `smart_spawn` is a recommendation tool — it returns a JSON response telling you which model to use. It does NOT spawn agents itself. You MUST call `sessions_spawn` after getting the result.

## Flow

```
1. Call smart_spawn(task, budget, mode)     → returns JSON recommendation
2. Call sessions_spawn(task, model, label)  → actually runs the sub-agent
```

## Quick Examples

### Single (default)
```
smart_spawn result → { action: "spawn", model: "moonshotai/kimi-k2.5", task: "...", label: "..." }

You do: sessions_spawn(task=result.task, model=result.model, label=result.label)
```

### Collective (parallel diverse models)
```
smart_spawn result → { action: "collective", models: [{id, label}, ...], task: "..." }

You do: for each model → sessions_spawn(task=result.task, model=model.id, label=model.label)
Then merge the best parts from all results.
```

### Cascade (cheap first, escalate if needed)
```
smart_spawn result → { action: "cascade", cheapModel: "...", premiumModel: "...", task: "..." }

You do:
1. sessions_spawn(task=result.task, model=result.cheapModel)
2. Check result quality via sessions_history(sessionKey)
3. If quality is poor → sessions_spawn(task=result.task, model=result.premiumModel)
```

## sessions_spawn Parameters

This is the OpenClaw built-in tool you call AFTER smart_spawn:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `task` | Yes | The task string (use exactly what smart_spawn returns) |
| `model` | No | Model ID like `moonshotai/kimi-k2.5` (from smart_spawn result) |
| `label` | No | Short label for the session |
| `agentId` | No | Agent ID if using configured agents |
| `runTimeoutSeconds` | No | Max runtime in seconds (0 = no limit) |

## Modes

| Mode | When | What happens |
|------|------|-------------|
| `single` | Default — one task, one model | Returns best model for the job |
| `collective` | Need diverse perspectives | Returns N models from different providers |
| `cascade` | Budget-conscious | Returns cheap + premium model pair |
| `plan` | Multi-step sequential work | Returns ordered steps with model per step |
| `swarm` | Complex parallel work | Returns DAG of tasks with dependencies |

## Role Blocks (Optional)

You can hint what kind of expert is needed. **Only include what's clearly relevant — omit if unsure.** The API enriches the task prompt with expert context.

### persona — who the sub-agent should be
`software-engineer` `frontend-engineer` `backend-engineer` `devops-engineer` `data-engineer` `ml-engineer` `architect` `analyst` `writer` `technical-writer` `product-manager` `debugger` `ui-designer` `sysadmin` `assistant`

### stack — tech expertise (array, max 4)
`react` `nextjs` `typescript` `python` `rust` `go` `nodejs` `postgres` `redis` `docker` `kubernetes` `aws` `tailwind` `llm` `rag` (and many more)

### domain — industry context (one)
`fintech` `saas` `ecommerce` `crypto` `healthcare` `developer-tools` `gaming` `education`

### format — output shape (one)
`full-implementation` `fix-debug` `refactor` `explain` `review` `planning` `documentation`

## Error Handling

- If `smart_spawn` fails or times out → fall back to `sessions_spawn` without a model (uses default)
- If the spawned agent fails → check `sessions_history` for errors, consider retrying with a different budget tier
- If cascade cheap model produces bad results → escalate to premium (that's the point of cascade)

## Rules

1. **Always call sessions_spawn after smart_spawn** — never just report the recommendation
2. Use the exact `model` and `task` strings from the result
3. **Don't guess role blocks** — if unsure about persona/stack/domain, omit them entirely
4. For plan/swarm modes, pass outputs from earlier steps as context to later ones
5. After completion, optionally call `smart_spawn_feedback` with a 1-5 rating to improve future picks
