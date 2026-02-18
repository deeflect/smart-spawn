import { ApiClient } from "./src/api-client.ts";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  coding: [
    "code", "coding", "program", "debug", "fix", "implement", "refactor",
    "typescript", "python", "javascript", "rust", "api", "function", "test", "bug",
  ],
  reasoning: [
    "reason", "reasoning", "analysis", "think", "logic",
    "math", "prove", "evaluate", "strategy", "plan", "deduce", "infer",
  ],
  creative: [
    "creative", "write", "story", "poem", "essay", "blog", "content",
    "marketing", "brainstorm", "idea", "narrative", "fiction",
  ],
  research: [
    "research", "search", "find", "investigate", "summarize",
    "report", "literature", "paper", "study",
    "cause", "explain", "history", "compare", "overview", "background", "origin",
  ],
  "fast-cheap": [
    "quick", "fast", "simple", "brief", "classify", "label", "tag",
    "extract", "parse", "format", "convert",
    "add", "sum", "subtract", "multiply", "divide", "calculate",
  ],
  vision: [
    "image", "picture", "photo", "screenshot", "diagram", "visual", "ocr",
    "analyze", "look", "see", "describe", "identify", "detect", "recognize",
  ],
};

function classifyTask(text: string): string {
  const lower = (text || "").toLowerCase();
  let best = "general";
  let bestScore = 0;
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return best;
}

/**
 * Build set of providers the user has direct keys for.
 * Auth profile IDs follow the pattern: "{provider}:{identifier}"
 * e.g. "anthropic:default", "openai:oauth", "google-gemini:api_key"
 */
function detectDirectProviders(api: any): Set<string> {
  const profiles = api.config?.auth?.profiles ?? {};
  const direct = new Set<string>();
  for (const [profileId, profile] of Object.entries(profiles) as [string, any][]) {
    const provider = profile?.provider ?? profileId.split(":")[0];
    if (provider && provider !== "openrouter") {
      direct.add(provider);
    }
  }
  // Also check models.providers for custom provider configs
  const providers = api.config?.models?.providers ?? {};
  for (const key of Object.keys(providers)) {
    if (key !== "openrouter") direct.add(key);
  }
  return direct;
}

/**
 * Map provider names from auth profiles to OpenRouter model ID prefixes.
 * Auth uses "anthropic", "google-gemini", etc. Model IDs use "anthropic/", "google/", etc.
 */
const PROVIDER_TO_MODEL_PREFIX: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  "google-gemini": "google",
  "google-gemini-cli": "google",
  "aws-bedrock": "amazon",
};

/**
 * Route model to cheapest available provider.
 * If user has a direct key for the model's provider, skip OpenRouter.
 */
function routeModel(modelId: string, directProviders: Set<string>): string {
  if (modelId.startsWith("openrouter/")) modelId = modelId.replace(/^openrouter\//, "");
  const provider = modelId.split("/")[0]; // e.g. "anthropic" from "anthropic/claude-opus-4-6"

  // Check if any direct provider matches this model's provider
  for (const [authProvider, modelPrefix] of Object.entries(PROVIDER_TO_MODEL_PREFIX)) {
    if (modelPrefix === provider && directProviders.has(authProvider)) {
      return modelId; // Use direct — no openrouter/ prefix
    }
  }

  // Also check if provider name directly matches (e.g. "anthropic" in both)
  if (directProviders.has(provider)) {
    return modelId;
  }

  // Fallback to OpenRouter
  return `openrouter/${modelId}`;
}

/** Get or create a persistent instance ID for community telemetry */
function getInstanceId(pluginDir: string): string {
  // Try multiple paths: explicit dir, home-based fallback
  const candidates = [
    join(pluginDir, ".instance-id"),
    join(process.env.HOME ?? "/tmp", ".smart-spawn-instance-id"),
  ];

  for (const idPath of candidates) {
    try {
      if (existsSync(idPath)) {
        return readFileSync(idPath, "utf-8").trim();
      }
    } catch { /* ignore */ }
  }

  const id = randomUUID();
  for (const idPath of candidates) {
    try {
      writeFileSync(idPath, id, "utf-8");
      return id;
    } catch { /* ignore, try next */ }
  }
  return id;
}

export default function (api: any) {
  const pluginConfig =
    api.config?.plugins?.entries?.["smart-spawn"]?.config ?? {};

  const apiUrl = pluginConfig.apiUrl ?? "https://ss.deeflect.com/api";
  const defaultBudget = pluginConfig.defaultBudget ?? "medium";
  const defaultMode = pluginConfig.defaultMode ?? "single";
  const collectiveCount = pluginConfig.collectiveCount ?? 3;
  const telemetryOptIn = pluginConfig.telemetryOptIn ?? false;
  const communityUrl = pluginConfig.communityUrl ?? apiUrl;

  // Detect which providers the user has direct access to
  const directProviders = detectDirectProviders(api);
  const hasOpenRouter = Object.keys(api.config?.auth?.profiles ?? {})
    .some((id: string) => id.startsWith("openrouter:"));

  if (directProviders.size > 0) {
    console.log(`[smart-spawn] Direct providers detected: ${[...directProviders].join(", ")}`);
  }
  if (hasOpenRouter) {
    console.log(`[smart-spawn] OpenRouter auth detected — will use for models without direct provider`);
  }
  if (!hasOpenRouter && directProviders.size === 0) {
    console.warn(`[smart-spawn] WARNING: No auth profiles detected! Models will fail to spawn.`);
    console.warn(`[smart-spawn] Run: openclaw auth add openrouter   (or add a direct provider key)`);
  }

  const RAW_FALLBACKS: Record<string, string> = {
    coding: "anthropic/claude-opus-4-6",
    reasoning: "anthropic/claude-opus-4-6",
    creative: "anthropic/claude-opus-4-6",
    research: "google/gemini-2.5-flash",
    "fast-cheap": "moonshotai/kimi-k2.5",
    general: "anthropic/claude-sonnet-4",
    vision: "anthropic/claude-sonnet-4",
  };
  function getFallback(category: string): string {
    return routeModel(RAW_FALLBACKS[category] ?? RAW_FALLBACKS.general, directProviders);
  }

  const client = new ApiClient(apiUrl, communityUrl);

  // Instance ID for community telemetry (lazy-loaded)
  let instanceId: string | null = null;
  function getOrCreateInstanceId(): string {
    if (!instanceId) {
      instanceId = getInstanceId(typeof __dirname !== 'undefined' ? __dirname : new URL('.', import.meta.url).pathname);
    }
    return instanceId;
  }

  /** Build a fallback-to-single-mode response when the API is unavailable */
  function buildFallbackResponse(category: string, budget: string, enrichedTask: string, context?: string) {
    const modelId = getFallback(category);
    client.logSpawn({ model: modelId, category, budget, mode: "single", role: "primary", source: "fallback", context });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          action: "spawn",
          model: modelId,
          task: enrichedTask,
          category,
          budget,
          reason: "API unavailable, falling back to single mode",
          source: "fallback",
        }),
      }],
    };
  }

  api.registerTool({
    name: "smart_spawn",
    description: `Intelligently spawn sub-agent(s) for a task. Automatically selects the best model(s) based on task type, budget, and strategy. Use this instead of sessions_spawn when you want optimal model selection. Do NOT use this when the user explicitly requests a specific agent or model.`,
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The task to delegate. Be specific.",
        },
        category: {
          type: "string",
          enum: [
            "coding", "reasoning", "creative", "research",
            "general", "fast-cheap", "vision", "auto",
          ],
          description: "Task category. 'auto' (default) lets the system classify it.",
        },
        mode: {
          type: "string",
          enum: ["single", "collective", "cascade", "plan", "swarm"],
          description: "Spawning strategy. 'single' (default): one optimal model. 'collective': N diverse models + merge. 'cascade': cheap first, escalate if needed. 'plan': decompose multi-step task sequentially. 'swarm': decompose into a dependency DAG, maximize parallelism.",
        },
        budget: {
          type: "string",
          enum: ["low", "medium", "high", "any"],
          description: "Budget tier for model selection.",
        },
        collectiveCount: {
          type: "number",
          description: "Number of models for collective mode (default: 3).",
        },
        label: {
          type: "string",
          description: "Optional label for the spawned session.",
        },
        context: {
          type: "string",
          description: "Project context tags, comma-separated (e.g. 'typescript,nextjs,supabase'). Improves model selection for specific tech stacks.",
        },
        persona: {
          type: "string",
          description: "Role persona for the sub-agent (e.g. 'frontend-engineer', 'security-engineer', 'copywriter', 'data-analyst'). See SKILL.md for full list.",
        },
        stack: {
          type: "array",
          items: { type: "string" },
          description: "Tech stack blocks to include in role instructions (e.g. ['react', 'nextjs', 'supabase', 'stripe']). See SKILL.md for available blocks.",
        },
        domain: {
          type: "string",
          description: "Industry/domain block (e.g. 'saas', 'fintech', 'healthcare', 'crypto', 'ecommerce'). Adds domain-specific expertise.",
        },
        format: {
          type: "string",
          description: "Output format block (e.g. 'full-implementation', 'review', 'comparison', 'documentation', 'pitch-deck'). Shapes how the sub-agent structures its response.",
        },
        guardrails: {
          type: "array",
          items: { type: "string" },
          description: "Quality guardrails (e.g. ['code', 'security', 'production']). Adds constraints to prevent common mistakes.",
        },
      },
      required: ["task"],
    },
    async execute(_callId: string, input: any) {
      const task = input.task || "";
      const category =
        input.category === "auto" || !input.category
          ? classifyTask(task)
          : input.category;
      const budget = input.budget ?? defaultBudget;
      const mode = input.mode ?? defaultMode;
      const context = input.context || undefined;

      // Compose role-enriched task if agent specified blocks
      const enrichedTask = await client.composeTaskPrompt({
        task,
        persona: input.persona,
        stack: input.stack,
        domain: input.domain,
        format: input.format,
        guardrails: input.guardrails,
      }) ?? task;

      // --- SINGLE MODE ---
      if (mode === "single") {
        let modelId: string;
        let reason: string;
        let source = "api";

        try {
          const pick = await client.pick(category, budget, undefined, context);
          modelId = routeModel(pick.data.id, directProviders);
          reason = pick.data.reason;
        } catch {
          modelId = getFallback(category);
          reason = `API unavailable, using fallback for ${category}`;
          source = "fallback";
        }

        const label = input.label ?? `smart-spawn: ${category} (${modelId.split("/").pop()})`;

        client.logSpawn({ model: modelId, category, budget, mode, role: "primary", source, context });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              action: "spawn",
              model: modelId,
              task: enrichedTask,
              category,
              budget,
              reason,
              source,
              label,
            }),
          }],
        };
      }

      // --- COLLECTIVE MODE ---
      if (mode === "collective") {
        const count = input.collectiveCount ?? collectiveCount;
        try {
          const rec = await client.recommend({ task: category, budget, count, context });
          const models = rec.data.map((r) => ({
            id: routeModel(r.model.id, directProviders),
            reason: r.reason,
          }));
          for (const m of models) {
            client.logSpawn({ model: m.id, category, budget, mode, role: "collective_worker", source: "api", context });
          }
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                action: "collective",
                models: models.map((m, i) => ({
                  ...m,
                  label: `smart-spawn-collective-${i + 1}: ${category} (${m.id.split("/").pop()})`,
                })),
                task: enrichedTask,
                category,
                budget,
                count,
                mergeLabel: `smart-spawn-merge: ${category}`,
              }),
            }],
          };
        } catch {
          return buildFallbackResponse(category, budget, enrichedTask, context);
        }
      }

      // --- CASCADE MODE ---
      if (mode === "cascade") {
        try {
          const cheapPick = await client.pick(category, "low", undefined, context);
          const cheapId = cheapPick.data.id;
          // Exclude the cheap model so premium is guaranteed different
          const premiumPick = await client.pick(category, "high", [cheapId], context);
          const routedCheap = routeModel(cheapId, directProviders);
          const routedPremium = routeModel(premiumPick.data.id, directProviders);
          client.logSpawn({ model: routedCheap, category, budget: "low", mode, role: "cascade_cheap", source: "api", context });
          client.logSpawn({ model: routedPremium, category, budget: "high", mode, role: "cascade_premium", source: "api", context });
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                action: "cascade",
                cheapModel: routedCheap,
                cheapScore: cheapPick.data.score,
                cheapPricing: cheapPick.data.pricing,
                premiumModel: routedPremium,
                premiumScore: premiumPick.data.score,
                premiumPricing: premiumPick.data.pricing,
                cheapLabel: `smart-spawn-cascade-cheap: ${category} (${cheapId.split("/").pop()})`,
                premiumLabel: `smart-spawn-cascade-premium: ${category} (${premiumPick.data.id.split("/").pop()})`,
                task: enrichedTask,
                category,
                escalationHint: "If the cheap model's response is incomplete, incorrect, or low quality, escalate to the premium model.",
              }),
            }],
          };
        } catch {
          return buildFallbackResponse(category, budget, enrichedTask, context);
        }
      }

      // --- PLAN MODE ---
      if (mode === "plan") {
        try {
          const decomposition = await client.decompose({ task, budget, context });

          // If task can't be decomposed, fall back to single mode
          if (!decomposition.decomposed || !decomposition.steps?.length) {
            let modelId: string;
            let reason: string;
            let source = "api";

            try {
              const pick = await client.pick(category, budget, undefined, context);
              modelId = routeModel(pick.data.id, directProviders);
              reason = pick.data.reason;
            } catch {
              modelId = getFallback(category);
              reason = `API unavailable, using fallback for ${category}`;
              source = "fallback";
            }

            const lbl = input.label ?? `smart-spawn: ${category} (${modelId.split("/").pop()})`;
            client.logSpawn({ model: modelId, category, budget, mode: "single", role: "primary", source, context });

            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  action: "spawn",
                  model: modelId,
                  task: enrichedTask,
                  category,
                  budget,
                  reason: `Task not decomposable — ${reason}`,
                  source,
                  label: lbl,
                }),
              }],
            };
          }

          // Build plan response with routed models
          const subtasks = await Promise.all(decomposition.steps.map(async (step) => {
            const modelId = step.model
              ? routeModel(step.model.id, directProviders)
              : getFallback(step.category);

            client.logSpawn({
              model: modelId,
              category: step.category,
              budget: step.budget,
              mode: "plan",
              role: `plan_step_${step.step}`,
              source: step.model ? "api" : "fallback",
              context,
            });

            const stepTask = await client.composeTaskPrompt({
              task: step.task,
              persona: input.persona,
              stack: input.stack,
              domain: input.domain,
              format: input.format,
              guardrails: input.guardrails,
            }) ?? step.task;

            return {
              step: step.step,
              task: stepTask,
              category: step.category,
              model: modelId,
              budget: step.budget,
              reason: step.reason,
              label: `smart-spawn-plan-${step.step}: ${step.category} (${modelId.split("/").pop()})`,
            };
          }));

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                action: "plan",
                subtasks,
                originalTask: task,
                totalSteps: subtasks.length,
                executionHint: "Execute steps sequentially. Pass each step's output as context to the next.",
              }),
            }],
          };
        } catch {
          return buildFallbackResponse(category, budget, enrichedTask, context);
        }
      }

      // --- SWARM MODE ---
      if (mode === "swarm") {
        try {
          const swarmResult = await client.swarm({ task, budget, context });

          // If task can't be decomposed, fall back to single mode
          if (!swarmResult.decomposed || !swarmResult.dag?.tasks?.length) {
            let modelId: string;
            let reason: string;
            let source = "api";

            try {
              const pick = await client.pick(category, budget, undefined, context);
              modelId = routeModel(pick.data.id, directProviders);
              reason = pick.data.reason;
            } catch {
              modelId = getFallback(category);
              reason = `API unavailable, using fallback for ${category}`;
              source = "fallback";
            }

            const lbl = input.label ?? `smart-spawn: ${category} (${modelId.split("/").pop()})`;
            client.logSpawn({ model: modelId, category, budget, mode: "single", role: "primary", source, context });

            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  action: "spawn",
                  model: modelId,
                  task: enrichedTask,
                  category,
                  budget,
                  reason: `Task not decomposable — ${reason}`,
                  source,
                  label: lbl,
                }),
              }],
            };
          }

          // Build swarm response with routed models
          const dag = swarmResult.dag;
          const dagTasks = await Promise.all(dag.tasks.map(async (t) => {
            const modelId = t.model
              ? routeModel(t.model.id, directProviders)
              : getFallback(t.category);

            client.logSpawn({
              model: modelId,
              category: t.category,
              budget: t.budget,
              mode: "swarm",
              role: `swarm_${t.id}`,
              source: t.model ? "api" : "fallback",
              context,
            });

            const swarmTask = await client.composeTaskPrompt({
              task: t.description,
              persona: input.persona,
              stack: input.stack,
              domain: input.domain,
              format: input.format,
              guardrails: input.guardrails,
            }) ?? t.description;

            return {
              id: t.id,
              task: swarmTask,
              category: t.category,
              model: modelId,
              budget: t.budget,
              persona: t.persona,
              dependsOn: t.dependsOn,
              wave: t.wave,
              reason: t.reason,
              label: `smart-spawn-${t.id}: ${t.category} (${modelId.split("/").pop()})`,
            };
          }));

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                action: "swarm",
                dag: {
                  tasks: dagTasks,
                  waves: dag.waves,
                  edges: dag.edges,
                  totalTasks: dag.totalTasks,
                  totalWaves: dag.totalWaves,
                  estimatedCost: dag.estimatedCost,
                  ...(dag.warning ? { warning: dag.warning } : {}),
                },
                originalTask: task,
                executionHint: "Execute wave-by-wave. Spawn all tasks within a wave in parallel. Pass outputs from completed tasks as context to their dependents in the next wave.",
              }),
            }],
          };
        } catch {
          return buildFallbackResponse(category, budget, enrichedTask, context);
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            action: "error",
            error: `Unknown mode: ${mode}`,
            validModes: ["single", "collective", "cascade", "plan", "swarm"],
          }),
        }],
        isError: true,
      };
    },
  });

  // --- FEEDBACK TOOL (learning loop) ---
  api.registerTool({
    name: "smart_spawn_feedback",
    description: `Report quality feedback after a smart_spawn task completes. Rate the spawned model's output 1-5 (1=terrible, 5=excellent). This feedback improves future model recommendations for your specific use patterns.`,
    parameters: {
      type: "object",
      properties: {
        model: {
          type: "string",
          description: "The model ID that was spawned (from the smart_spawn response).",
        },
        category: {
          type: "string",
          enum: ["coding", "reasoning", "creative", "research", "general", "fast-cheap", "vision"],
          description: "The task category.",
        },
        rating: {
          type: "number",
          description: "Quality rating 1-5. 1=terrible, 2=poor, 3=acceptable, 4=good, 5=excellent.",
        },
        context: {
          type: "string",
          description: "Project context tags from the original smart_spawn call (e.g. 'typescript,nextjs').",
        },
      },
      required: ["model", "category", "rating"],
    },
    async execute(_callId: string, input: any) {
      const model = input.model || "";
      const category = input.category || "general";
      const rating = Math.max(1, Math.min(5, Math.round(input.rating ?? 3)));
      const context = input.context || undefined;

      client.logOutcome({ model, category, rating, context });

      // Community telemetry (opt-in)
      if (telemetryOptIn) {
        client.reportCommunity({
          model,
          category,
          rating,
          instanceId: getOrCreateInstanceId(),
        });
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            recorded: true,
            model,
            category,
            rating,
            communityReported: telemetryOptIn,
            message: rating >= 3
              ? "Positive feedback recorded — this model will be favored for similar tasks."
              : "Negative feedback recorded — this model will be deprioritized for similar tasks.",
          }),
        }],
      };
    },
  });
}
