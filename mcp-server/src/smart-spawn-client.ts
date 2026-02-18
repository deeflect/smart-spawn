import type { Budget, RoleConfig } from "./types.ts";

interface HttpOptions {
  method?: string;
  body?: unknown;
}

export class SmartSpawnClient {
  constructor(private readonly baseUrl: string) {}

  async pick(params: {
    task: string;
    budget?: Budget;
    context?: string;
    exclude?: string[];
  }): Promise<{ modelId: string; reason: string }> {
    const query = new URLSearchParams({
      task: params.task,
      budget: params.budget ?? "medium",
    });
    if (params.context) query.set("context", params.context);
    if (params.exclude?.length) query.set("exclude", params.exclude.join(","));

    const data = await this.getJson(`/pick?${query.toString()}`);
    const modelId = data?.data?.id as string | undefined;
    if (!modelId) throw new Error("Smart Spawn /pick did not return data.id");
    return { modelId, reason: String(data?.data?.reason ?? "Picked by /pick") };
  }

  async recommend(params: {
    task: string;
    budget?: Budget;
    count?: number;
    context?: string;
    exclude?: string[];
  }): Promise<Array<{ modelId: string; reason: string }>> {
    const query = new URLSearchParams({
      task: params.task,
      budget: params.budget ?? "medium",
      count: String(params.count ?? 3),
    });
    if (params.context) query.set("context", params.context);
    if (params.exclude?.length) query.set("exclude", params.exclude.join(","));

    const data = await this.getJson(`/recommend?${query.toString()}`);
    const items = Array.isArray(data?.data) ? data.data : [];
    return items
      .map((item: any) => ({
        modelId: item?.model?.id as string | undefined,
        reason: String(item?.reason ?? "Recommended by /recommend"),
      }))
      .filter((item: { modelId: string | undefined }) => Boolean(item.modelId)) as Array<{ modelId: string; reason: string }>;
  }

  async decompose(params: {
    task: string;
    budget?: Budget;
    context?: string;
  }): Promise<{
    decomposed: boolean;
    steps: Array<{ id: string; task: string; modelId: string; wave: number; dependsOn: string[]; reason: string }>;
  }> {
    const data = await this.postJson("/decompose", {
      task: params.task,
      budget: params.budget ?? "medium",
      context: params.context,
    });

    if (!data?.decomposed) return { decomposed: false, steps: [] };
    const steps = Array.isArray(data?.steps) ? data.steps : [];
    return {
      decomposed: true,
      steps: steps
        .map((step: any) => ({
          id: `step-${step.step}`,
          task: String(step.task ?? ""),
          modelId: step?.model?.id as string | undefined,
          wave: Number(step.step ?? 1) - 1,
          dependsOn: Number(step.step ?? 1) > 1 ? [`step-${Number(step.step ?? 1) - 1}`] : [],
          reason: String(step.reason ?? "Planned by /decompose"),
        }))
        .filter((s: { modelId: string | undefined }) => Boolean(s.modelId)) as Array<{
          id: string;
          task: string;
          modelId: string;
          wave: number;
          dependsOn: string[];
          reason: string;
        }>,
    };
  }

  async swarm(params: {
    task: string;
    budget?: Budget;
    context?: string;
    maxParallel?: number;
  }): Promise<{
    decomposed: boolean;
    tasks: Array<{ id: string; task: string; modelId: string; wave: number; dependsOn: string[]; reason: string }>;
  }> {
    const data = await this.postJson("/swarm", {
      task: params.task,
      budget: params.budget ?? "medium",
      context: params.context,
      maxParallel: params.maxParallel ?? 5,
    });

    if (!data?.decomposed || !data?.dag) return { decomposed: false, tasks: [] };
    const tasks = Array.isArray(data?.dag?.tasks) ? data.dag.tasks : [];
    return {
      decomposed: true,
      tasks: tasks
        .map((task: any) => ({
          id: String(task.id ?? ""),
          task: String(task.description ?? task.task ?? ""),
          modelId: task?.model?.id as string | undefined,
          wave: Number(task.wave ?? 0),
          dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map((d: unknown) => String(d)) : [],
          reason: String(task.reason ?? "Planned by /swarm"),
        }))
        .filter((t: { modelId: string | undefined }) => Boolean(t.modelId)) as Array<{
          id: string;
          task: string;
          modelId: string;
          wave: number;
          dependsOn: string[];
          reason: string;
        }>,
    };
  }

  async composeRole(task: string, role?: RoleConfig): Promise<string> {
    if (!role) return task;
    const data = await this.postJson("/roles/compose", {
      task,
      ...role,
    });
    const prompt = data?.fullPrompt as string | undefined;
    return prompt && prompt.trim().length > 0 ? prompt : task;
  }

  async health(): Promise<{ reachable: boolean; payload: unknown | null }> {
    try {
      const data = await this.getJson("/status");
      return { reachable: true, payload: data };
    } catch {
      return { reachable: false, payload: null };
    }
  }

  private async getJson(path: string): Promise<any> {
    return this.request(path, { method: "GET" });
  }

  private async postJson(path: string, body: unknown): Promise<any> {
    return this.request(path, { method: "POST", body });
  }

  private async request(path: string, options: HttpOptions): Promise<any> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const raw = await res.text();
    const data = raw ? JSON.parse(raw) : null;

    if (!res.ok) {
      const message =
        data?.error?.message ??
        data?.message ??
        `${options.method ?? "GET"} ${path} failed with status ${res.status}`;
      throw new Error(String(message));
    }

    return data;
  }
}
