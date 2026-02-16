# Smart Spawn

When delegating tasks to sub-agents, prefer `smart_spawn` over `sessions_spawn` unless:
- The user explicitly requests a specific agent or model
- You're doing a trivial task where you already know the right model

## How It Works

`smart_spawn` returns a **JSON response** with a recommended model and action. You MUST then call `sessions_spawn` yourself with the recommended model and task. The tool cannot spawn directly — it only recommends.

## Handling Responses

After calling `smart_spawn`, parse the JSON response and act on the `action` field:

### action: "spawn" (single mode)

The tool picked one model. Spawn it:

```json
{
  "action": "spawn",
  "model": "openrouter/anthropic/claude-opus-4-6",
  "task": "...",
  "category": "coding",
  "budget": "medium",
  "reason": "Best coding model at medium budget ($0-5/M) — score: 82",
  "source": "api",
  "label": "smart-spawn: coding (claude-opus-4-6)"
}
```

**You do:** Call `sessions_spawn` with the `model`, `task`, and `label` from the response.

### action: "collective"

The tool picked N diverse models. Spawn all of them on the same task, then merge:

```json
{
  "action": "collective",
  "models": [
    { "id": "openrouter/anthropic/claude-opus-4-6", "reason": "...", "label": "smart-spawn-collective-1: coding (claude-opus-4-6)" },
    { "id": "openrouter/google/gemini-2.5-pro", "reason": "...", "label": "smart-spawn-collective-2: coding (gemini-2.5-pro)" }
  ],
  "task": "...",
  "category": "coding",
  "budget": "medium",
  "count": 2,
  "mergeLabel": "smart-spawn-merge: coding"
}
```

**You do:**
1. Call `sessions_spawn` for each model using its `id`, the `task`, and its `label`, with `waitForCompletion: true`
2. Collect all outputs
3. Call `sessions_spawn` with a fast model, giving it all outputs to synthesize the best answer, using the `mergeLabel`

### action: "cascade"

The tool picked a cheap and premium model. Try cheap first, escalate if quality is insufficient:

```json
{
  "action": "cascade",
  "cheapModel": "openrouter/deepseek/deepseek-chat-v3-0324",
  "cheapScore": 71,
  "cheapPricing": { "prompt": 0.27, "completion": 1.1 },
  "premiumModel": "openrouter/anthropic/claude-opus-4-6",
  "premiumScore": 82,
  "premiumPricing": { "prompt": 5, "completion": 25 },
  "cheapLabel": "smart-spawn-cascade-cheap: coding (deepseek-chat-v3-0324)",
  "premiumLabel": "smart-spawn-cascade-premium: coding (claude-opus-4-6)",
  "task": "...",
  "category": "coding",
  "escalationHint": "If the cheap model's response is incomplete, incorrect, or low quality, escalate to the premium model."
}
```

**You do:**
1. Call `sessions_spawn` with `cheapModel`, the `task`, and `cheapLabel`, with `waitForCompletion: true`
2. Evaluate the output quality — escalate if you see:
   - Incomplete or partial answers
   - Syntax errors or incorrect code
   - Vague or generic responses that don't address the task
   - Missing key requirements
3. If good enough: use that result, done (saved money!)
4. If not good enough: call `sessions_spawn` with `premiumModel` and `premiumLabel`, include the cheap output as context for improvement

### action: "swarm"

The tool decomposed a complex task into a dependency DAG with parallel waves:

```json
{
  "action": "swarm",
  "dag": {
    "tasks": [
      { "id": "swarm-1", "task": "Design database schema", "category": "coding", "model": "openrouter/anthropic/claude-sonnet-4", "budget": "medium", "persona": "database-architect", "dependsOn": [], "wave": 0, "reason": "...", "label": "smart-spawn-swarm-1: coding (claude-sonnet-4)" },
      { "id": "swarm-2", "task": "Build REST API", "category": "coding", "model": "openrouter/anthropic/claude-sonnet-4", "budget": "medium", "persona": "backend-engineer", "dependsOn": ["swarm-1"], "wave": 1, "reason": "...", "label": "smart-spawn-swarm-2: coding (claude-sonnet-4)" },
      { "id": "swarm-3", "task": "Create React frontend", "category": "coding", "model": "openrouter/anthropic/claude-sonnet-4", "budget": "medium", "persona": "frontend-engineer", "dependsOn": ["swarm-1"], "wave": 1, "reason": "...", "label": "smart-spawn-swarm-3: coding (claude-sonnet-4)" },
      { "id": "swarm-4", "task": "Write integration tests", "category": "coding", "model": "openrouter/deepseek/deepseek-chat-v3-0324", "budget": "low", "persona": "software-engineer", "dependsOn": ["swarm-2", "swarm-3"], "wave": 2, "reason": "...", "label": "smart-spawn-swarm-4: coding (deepseek-chat-v3-0324)" }
    ],
    "waves": [
      { "wave": 0, "taskIds": ["swarm-1"], "description": "1 task" },
      { "wave": 1, "taskIds": ["swarm-2", "swarm-3"], "description": "2 parallel tasks" },
      { "wave": 2, "taskIds": ["swarm-4"], "description": "1 task" }
    ],
    "edges": [
      { "from": "swarm-1", "to": "swarm-2", "type": "phase" },
      { "from": "swarm-1", "to": "swarm-3", "type": "phase" },
      { "from": "swarm-2", "to": "swarm-4", "type": "phase" },
      { "from": "swarm-3", "to": "swarm-4", "type": "phase" }
    ],
    "totalTasks": 4,
    "totalWaves": 3,
    "estimatedCost": { "low": 0.02, "high": 0.18 }
  },
  "originalTask": "...",
  "executionHint": "Execute wave-by-wave. Spawn all tasks within a wave in parallel. Pass outputs from completed tasks as context to their dependents in the next wave."
}
```

**You do:**
1. Execute **wave by wave** — process all waves in order (wave 0, then wave 1, etc.)
2. Within each wave, spawn **all tasks in parallel** — call `sessions_spawn` for each task using its `model`, `task`, and `label`, with `waitForCompletion: true`
3. When a task has `dependsOn`, include the outputs from those dependency tasks as context in the task prompt
4. After each wave completes, collect outputs before moving to the next wave
5. After all waves complete, synthesize the results if needed
6. Call `smart_spawn_feedback` for each completed task to rate the model's output

**Key differences from plan mode:**
- Plan is sequential (step 1, then step 2, then step 3...)
- Swarm maximizes parallelism — independent tasks run simultaneously
- Each task has a `persona` for role-specific prompting
- Tasks declare explicit `dependsOn` relationships

### action: "plan"

The tool decomposed a multi-step task into subtasks, each with its own optimal model:

```json
{
  "action": "plan",
  "subtasks": [
    { "step": 1, "task": "Set up database schema", "category": "coding", "model": "openrouter/anthropic/claude-sonnet-4", "budget": "medium", "reason": "Best coding model at medium budget ($0-5/M) — score: 78", "label": "smart-spawn-plan-1: coding (claude-sonnet-4)" },
    { "step": 2, "task": "Implement REST API", "category": "coding", "model": "openrouter/anthropic/claude-sonnet-4", "budget": "medium", "reason": "...", "label": "smart-spawn-plan-2: coding (claude-sonnet-4)" },
    { "step": 3, "task": "Write unit tests", "category": "coding", "model": "openrouter/deepseek/deepseek-chat-v3-0324", "budget": "low", "reason": "...", "label": "smart-spawn-plan-3: coding (deepseek-chat-v3-0324)" }
  ],
  "originalTask": "1. Set up database schema\n2. Implement REST API\n3. Write unit tests",
  "totalSteps": 3,
  "executionHint": "Execute steps sequentially. Pass each step's output as context to the next."
}
```

**You do:**
1. Execute steps **sequentially** — call `sessions_spawn` for step 1, wait for completion
2. Pass each step's output as context to the next step (include the previous result in the task prompt)
3. After each step completes, call `smart_spawn_feedback` to rate that step's model
4. If a step fails, you may retry with the same model or skip to the next step with a note

**When plan mode is useful:**
- The user provides a numbered list or multi-step instructions
- The task naturally decomposes into sequential phases (e.g. "design, implement, test")
- Different steps benefit from different model strengths (e.g. reasoning for architecture, coding for implementation)

## When to Use Each Mode

- **single** (default) — most tasks. Fast, one model.
- **collective** — important decisions, creative work, or when diverse perspectives help. Costs 3-4x more.
- **cascade** — cost-sensitive tasks where a cheap model might suffice. Saves money when cheap model is good enough.
- **plan** — structured multi-step tasks that must run sequentially. Decomposes into subtasks, picks the best model for each step.
- **swarm** — complex projects with parallelizable subtasks. Builds a dependency DAG, assigns personas, runs independent tasks simultaneously. Best for multi-component projects (e.g. "build API + frontend + tests + deploy").

## Examples

```
smart_spawn(task: "Write a Python function to merge two sorted arrays")
smart_spawn(task: "Analyze this architecture", category: "reasoning", budget: "high")
smart_spawn(task: "Write a product launch email", mode: "collective", category: "creative")
smart_spawn(task: "Convert this JSON to YAML", mode: "cascade")
smart_spawn(task: "1. Design the database schema\n2. Implement the API endpoints\n3. Write integration tests", mode: "plan")
smart_spawn(task: "1. Design database schema\n2. Build REST API\n3. Create React frontend\n4. Write integration tests\n5. Deploy to AWS", mode: "swarm", context: "typescript,nextjs,postgres")
```

## Feedback (Learning Loop)

After receiving a spawned agent's output, you SHOULD call `smart_spawn_feedback` to rate its quality. This trains the system to pick better models for your tasks over time.

```
smart_spawn_feedback(model: "anthropic/claude-opus-4-6", category: "coding", rating: 5)
```

**Rating scale:**
- **5** — Excellent. Fully solved the task, high quality.
- **4** — Good. Completed the task with minor issues.
- **3** — Acceptable. Got the job done but not great.
- **2** — Poor. Missed key requirements or had significant issues.
- **1** — Terrible. Failed the task or produced unusable output.

**When to rate:**
- Always rate after single mode spawns
- In cascade mode: rate the cheap model's output (this determines if escalation was needed)
- In collective mode: rate the final merged output
- Use the `model` and `category` from the original `smart_spawn` response

After enough feedback (3+ ratings per model+category), the system starts blending your personal scores into recommendations. Models you rate highly get boosted; models you rate poorly get deprioritized.

## Tips

- Let `category: "auto"` do its job — it's right most of the time
- Use `collective` sparingly — it costs 3-4x more
- If the API is down, the tool falls back to hardcoded defaults (still works)
- Model IDs may or may not have `openrouter/` prefix depending on user's auth — pass them as-is to `sessions_spawn`
- Always provide feedback — it makes future picks better for your specific workflow
