---
name: smart-spawn
description: "Intelligent sub-agent spawning with automatic model selection and role composition. Use instead of sessions_spawn for optimal model routing."
---

# Smart Spawn

Use `smart_spawn` to delegate tasks to sub-agents. It picks the best model and can inject expert role instructions that make cheap models perform like specialists.

## Flow

1. Analyze the task → pick role blocks if relevant
2. Call `smart_spawn` → get JSON with model + enriched task
3. Call `sessions_spawn` with the returned values

## Modes

| Mode | When to use |
|------|------------|
| `single` | Default. One optimal model. |
| `collective` | Need diverse perspectives. Spawns N models, you merge results. |
| `cascade` | Cost-sensitive. Cheap model first, escalate to premium if quality is poor. |
| `plan` | Multi-step sequential tasks. Format task as numbered list. |
| `swarm` | Complex tasks with parallel subtasks. API builds a dependency DAG. |

## Role Blocks

Analyze the task and specify blocks that match. **Only include what's clearly relevant — omit if unsure.** Guardrails auto-apply based on persona when not specified.

### persona — who the sub-agent is

**Engineering:** `software-engineer` `frontend-engineer` `backend-engineer` `fullstack-engineer` `devops-engineer` `data-engineer` `mobile-engineer` `systems-engineer` `security-engineer` `ml-engineer` `performance-engineer`

**Architecture:** `architect` `api-designer` `database-architect`

**Analysis:** `analyst` `data-analyst` `market-analyst` `financial-analyst`

**Problem Solving:** `problem-solver` `debugger` `mathematician`

**Content:** `writer` `technical-writer` `copywriter` `editor` `social-media`

**Product/Business:** `product-manager` `strategist` `ux-researcher` `project-manager`

**Design:** `ui-designer` `brand-designer`

**Other:** `sysadmin` `teacher` `legal-analyst` `assistant`

### stack — tech expertise (array, max 4)

**Frontend:** `react` `nextjs` `vue` `svelte` `angular` `tailwind` `shadcn` `css` `animation` `threejs`

**Languages:** `typescript` `python` `rust` `go` `java` `csharp` `php` `ruby` `elixir` `swift` `kotlin`

**Backend:** `nodejs` `fastapi` `django` `flask` `react-native` `flutter`

**Data:** `sql` `postgres` `mysql` `supabase` `prisma` `drizzle` `mongodb` `redis` `elasticsearch` `kafka` `rabbitmq`

**APIs:** `graphql` `rest` `grpc` `websocket` `auth` `stripe` `payment-general`

**DevOps:** `docker` `kubernetes` `cicd` `terraform` `aws` `gcp` `nginx` `caddy` `monitoring`

**AI/ML:** `llm` `rag` `langchain` `fine-tuning` `pytorch` `pandas`

**Web3:** `solidity` `web3-frontend`

**Platforms:** `vercel` `railway` `cloudflare` `firebase` `convex`

**Other:** `bash` `powershell` `markdown` `astro` `json` `yaml` `regex` `email` `a11y` `seo` `performance` `i18n` `git` `testing` `playwright`

### domain — industry (one)

`fintech` `ecommerce` `saas` `marketplace` `gaming` `crypto` `healthcare` `education` `media` `iot` `logistics` `real-estate` `social-platform` `legal` `developer-tools`

### format — output shape (one)

`full-implementation` `fix-debug` `refactor` `explain` `review` `comparison` `planning` `documentation` `copywriting` `social-post` `data-report` `migration` `pitch-deck` `project-proposal` `user-story` `email` `legal-doc`

### guardrails — quality rules (array, auto-applied if omitted)

`code` `research` `concise` `security` `production` `accuracy`

## Acting on Results

### `action: "spawn"` (single/fallback)
```
sessions_spawn(task: result.task, model: result.model, label: result.label)
```

### `action: "collective"`
Spawn each model, wait for all, merge the best parts:
```
for model in result.models:
  sessions_spawn(task: result.task, model: model.id, label: model.label)
```

### `action: "cascade"`
1. Spawn `cheapModel` first
2. Check quality via `sessions_history`
3. Escalate to `premiumModel` if: incomplete, wrong, vague, or too short for the task
4. Return whichever result is good

### `action: "plan"`
Execute steps sequentially, pass each output as context to the next.

### `action: "swarm"`
Execute wave-by-wave. Spawn all tasks in a wave in parallel. Pass outputs to dependents in the next wave.

## Rules

- **Always spawn after smart_spawn returns** — don't just report the recommendation
- Use the exact `model` and `task` strings from the result
- **Don't guess blocks** — if unsure, omit and the task goes raw
- For plan mode, format tasks as numbered lists
- After completion, consider calling `smart_spawn_feedback` with a 1-5 rating
