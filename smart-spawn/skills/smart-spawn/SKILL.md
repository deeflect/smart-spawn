---
name: smart-spawn
description: "Act on smart_spawn tool results. When smart_spawn returns a model recommendation, automatically spawn the sub-agent using sessions_spawn with that model."
---

# Smart Spawn — Intelligent Sub-Agent Spawning

When you need to delegate a task to a sub-agent, use `smart_spawn` instead of `sessions_spawn` directly. It picks the optimal model AND can inject expert role instructions.

## How It Works

1. You call `smart_spawn` with the task + role hints
2. It returns JSON with model recommendation + enriched task
3. You call `sessions_spawn` with those values

## Specifying Role Blocks

When calling `smart_spawn`, analyze the task and specify relevant blocks. This gives the sub-agent expert-level instructions that make even cheap models perform like specialists.

**Only specify blocks when they're clearly relevant.** Don't guess — if unsure, omit them and the task goes raw.

### persona — who the sub-agent is

Pick the most specific persona that fits:

**Engineering:** `software-engineer`, `frontend-engineer`, `backend-engineer`, `fullstack-engineer`, `devops-engineer`, `data-engineer`, `mobile-engineer`, `systems-engineer`, `security-engineer`, `ml-engineer`, `performance-engineer`

**Architecture:** `architect`, `api-designer`, `database-architect`

**Analysis:** `analyst`, `data-analyst`, `market-analyst`, `financial-analyst`

**Problem Solving:** `problem-solver`, `debugger`, `mathematician`

**Content:** `writer`, `technical-writer`, `copywriter`, `editor`, `social-media`

**Product/Business:** `product-manager`, `strategist`, `ux-researcher`, `project-manager`

**Design:** `ui-designer`, `brand-designer`

**Other:** `sysadmin`, `teacher`, `legal-analyst`, `assistant`

### stack — tech-specific expertise (array)

Pick up to 4 that match the task. Each adds 3-4 expert-level bullets.

**Frontend:** `react`, `nextjs`, `vue`, `svelte`, `angular`, `tailwind`, `shadcn`, `css`, `animation`, `threejs`

**Languages:** `typescript`, `python`, `rust`, `go`, `java`, `csharp`, `php`, `ruby`, `elixir`, `swift`, `kotlin`

**Backend:** `nodejs`, `fastapi`, `django`, `flask`

**Mobile:** `react-native`, `flutter`

**Data/DB:** `sql`, `postgres`, `mysql`, `supabase`, `prisma`, `drizzle`, `mongodb`, `redis`, `elasticsearch`, `kafka`, `rabbitmq`

**APIs:** `graphql`, `rest`, `grpc`, `websocket`, `auth`, `stripe`, `payment-general`

**DevOps:** `docker`, `kubernetes`, `cicd`, `terraform`, `aws`, `gcp`, `nginx`, `caddy`, `monitoring`

**Testing:** `testing`, `playwright`

**AI/ML:** `llm`, `rag`, `langchain`, `fine-tuning`, `pytorch`, `pandas`

**Web3:** `solidity`, `web3-frontend`

**Platforms:** `vercel`, `railway`, `cloudflare`, `firebase`, `convex`

**Other:** `bash`, `powershell`, `markdown`, `astro`, `json`, `yaml`, `regex`, `email`, `a11y`, `seo`, `performance`, `i18n`, `git`

### domain — industry expertise (one)

`fintech`, `ecommerce`, `saas`, `marketplace`, `gaming`, `crypto`, `healthcare`, `education`, `media`, `iot`, `logistics`, `real-estate`, `social-platform`, `legal`, `developer-tools`

### format — output structure (one)

`full-implementation`, `fix-debug`, `refactor`, `explain`, `review`, `comparison`, `planning`, `documentation`, `copywriting`, `social-post`, `data-report`, `migration`, `pitch-deck`, `project-proposal`, `user-story`, `email`, `legal-doc`

### guardrails — quality rules (array)

`code`, `research`, `concise`, `security`, `production`, `accuracy`

## Examples

### Coding task with full context
```
smart_spawn(
  task: "Build a checkout page with Stripe integration",
  category: "coding",
  budget: "low",
  persona: "frontend-engineer",
  stack: ["react", "nextjs", "stripe", "tailwind"],
  domain: "ecommerce",
  format: "full-implementation",
  guardrails: ["code"]
)
```

### Security audit
```
smart_spawn(
  task: "Review this authentication middleware for vulnerabilities",
  category: "coding",
  persona: "security-engineer",
  stack: ["nodejs", "auth"],
  format: "review",
  guardrails: ["security", "code"]
)
```

### Market research
```
smart_spawn(
  task: "Analyze the competitive landscape for AI coding assistants",
  category: "research",
  persona: "market-analyst",
  domain: "developer-tools",
  format: "comparison",
  guardrails: ["accuracy", "research"]
)
```

### Landing page copy
```
smart_spawn(
  task: "Write landing page copy for our developer tool",
  category: "creative",
  persona: "copywriter",
  domain: "saas",
  format: "copywriting"
)
```

### Simple task (no blocks needed)
```
smart_spawn(
  task: "What's 42 + 69?",
  budget: "low"
)
```

## Acting on Results

### Single Mode (`action: "spawn"`)
```
sessions_spawn(
  task: <task from result>,
  model: <model from result>,
  label: <label from result>
)
```

### Collective Mode (`action: "collective"`)
Spawn each model, then synthesize:
```
For each model in result.models:
  sessions_spawn(task: <task>, model: <model.id>, label: <label>)
```
Wait for all to complete, merge the best parts.

### Cascade Mode (`action: "cascade"`)
1. Spawn with `cheapModel`
2. Check quality via `sessions_history`
3. If poor quality → spawn with `premiumModel`
4. If good → return cheap result (saved money)

**Escalation triggers:** "I don't know", syntax errors, incomplete code, vague answers, suspiciously short for complex task.

### Plan Mode
When using plan mode, format the task as a numbered list:
```
smart_spawn(
  mode: "plan",
  task: "1. Create schema\n2. Build API\n3. Add tests"
)
```

## Rules

- **Always spawn after smart_spawn returns** — don't just report the recommendation
- Use the exact `model` string from the result (already routed correctly)
- Use the `label` from the result for tracking
- **Don't guess blocks** — if unsure about persona/stack/domain, omit them
- If spawn fails, report the error with model ID and reason
