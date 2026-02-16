export interface SwarmResponse {
  decomposed: boolean;
  reason?: string;
  dag?: {
    tasks: Array<{
      id: string;
      description: string;
      category: string;
      budget: string;
      persona: string;
      dependsOn: string[];
      model: {
        id: string;
        name: string;
        provider: string;
        score: number;
        pricing: { prompt: number; completion: number };
      } | null;
      reason: string;
      wave: number;
    }>;
    waves: Array<{
      wave: number;
      taskIds: string[];
      description: string;
    }>;
    edges: Array<{
      from: string;
      to: string;
      type: string;
    }>;
    totalTasks: number;
    totalWaves: number;
    originalTask: string;
    context: string | null;
    estimatedCost: { low: number; high: number };
    warning?: string;
  };
}

export interface DecomposeResponse {
  decomposed: boolean;
  reason?: string;
  totalSteps?: number;
  originalTask?: string;
  context?: string | null;
  steps?: Array<{
    step: number;
    task: string;
    category: string;
    budget: string;
    model: {
      id: string;
      name: string;
      provider: string;
      score: number;
      pricing: { prompt: number; completion: number };
    } | null;
    reason: string;
  }>;
}

export interface PickResponse {
  data: {
    id: string;
    name: string;
    provider: string;
    score: number;
    pricing: { prompt: number; completion: number };
    reason: string;
    contextBoost?: number;
    contextTags?: string[];
  };
}

export interface RecommendResponse {
  data: Array<{
    model: {
      id: string;
      name: string;
      provider: string;
      scores: Record<string, number>;
      tier: string;
    };
    reason: string;
    confidence: number;
  }>;
  meta: {
    task: string;
    budget: string;
    candidatesConsidered: number;
  };
}

export class ApiClient {
  private baseUrl: string;
  private communityUrl: string;

  constructor(baseUrl: string, communityUrl?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.communityUrl = (communityUrl ?? baseUrl).replace(/\/$/, "");
  }

  async pick(
    task: string,
    budget?: string,
    exclude?: string[],
    context?: string
  ): Promise<PickResponse> {
    const params = new URLSearchParams({ task });
    if (budget) params.set("budget", budget);
    if (exclude?.length) params.set("exclude", exclude.join(","));
    if (context) params.set("context", context);

    const res = await fetch(`${this.baseUrl}/pick?${params}`);
    if (!res.ok) {
      throw new Error(`API /pick failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<PickResponse>;
  }

  async recommend(opts: {
    task: string;
    budget?: string;
    count?: number;
    exclude?: string[];
    require?: string[];
    minContext?: number;
    context?: string;
  }): Promise<RecommendResponse> {
    const params = new URLSearchParams({ task: opts.task });
    if (opts.budget) params.set("budget", opts.budget);
    if (opts.count) params.set("count", String(opts.count));
    if (opts.exclude?.length) params.set("exclude", opts.exclude.join(","));
    if (opts.require?.length) params.set("require", opts.require.join(","));
    if (opts.minContext) params.set("minContext", String(opts.minContext));
    if (opts.context) params.set("context", opts.context);

    const res = await fetch(`${this.baseUrl}/recommend?${params}`);
    if (!res.ok) {
      throw new Error(
        `API /recommend failed: ${res.status} ${res.statusText}`
      );
    }
    return res.json() as Promise<RecommendResponse>;
  }

  async decompose(opts: {
    task: string;
    budget?: string;
    context?: string;
  }): Promise<DecomposeResponse> {
    const res = await fetch(`${this.baseUrl}/decompose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      throw new Error(`API /decompose failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<DecomposeResponse>;
  }

  async swarm(opts: {
    task: string;
    budget?: string;
    context?: string;
    maxParallel?: number;
  }): Promise<SwarmResponse> {
    const res = await fetch(`${this.baseUrl}/swarm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      throw new Error(`API /swarm failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<SwarmResponse>;
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/status`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Compose a role-enriched task prompt via explicit block selection.
   * Agent specifies what blocks it wants — API assembles them.
   * Returns null if no blocks specified (task sent raw).
   */
  async composeTaskPrompt(opts: {
    task: string;
    persona?: string;
    stack?: string[];
    domain?: string;
    format?: string;
    guardrails?: string[];
  }): Promise<string | null> {
    // If agent didn't specify any blocks, skip — no role prompt
    const hasBlocks = opts.persona || opts.stack?.length || opts.domain || opts.format || opts.guardrails?.length;
    if (!hasBlocks) return null;

    try {
      const res = await fetch(`${this.baseUrl}/roles/compose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!res.ok) {
        console.warn(`[smart-spawn] Role composition failed (${res.status}) — sending task without role blocks`);
        return null;
      }
      const data = await res.json() as { hasRole: boolean; fullPrompt: string };
      return data.hasRole ? data.fullPrompt : null;
    } catch {
      console.warn(`[smart-spawn] Role composition unavailable — sending task without role blocks`);
      return null;
    }
  }

  private logFailCount = 0;
  private logFailWarned = false;

  private handleLogError(endpoint: string, err: unknown): void {
    this.logFailCount++;
    if (!this.logFailWarned && this.logFailCount >= 3) {
      console.warn(`[smart-spawn] Spawn logging unavailable (${endpoint}) — tracking data may be lost. Is the API running?`);
      this.logFailWarned = true;
    }
  }

  /** Fire-and-forget spawn log for cost tracking */
  logSpawn(entry: {
    model: string;
    category: string;
    budget: string;
    mode: string;
    role: string;
    source: string;
    context?: string;
  }): void {
    fetch(`${this.baseUrl}/spawn-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).catch((e) => this.handleLogError("/spawn-log", e));
  }

  /** Fire-and-forget outcome feedback for learning loop */
  logOutcome(entry: {
    model: string;
    category: string;
    rating: number;
    context?: string;
  }): void {
    fetch(`${this.baseUrl}/spawn-log/outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).catch((e) => this.handleLogError("/spawn-log/outcome", e));
  }

  /** Fire-and-forget community outcome report */
  reportCommunity(entry: {
    model: string;
    category: string;
    rating: number;
    instanceId: string;
  }): void {
    fetch(`${this.communityUrl}/community/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).catch((e) => this.handleLogError("/community/report", e));
  }
}
