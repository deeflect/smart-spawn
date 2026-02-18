import type { OpenRouterExecutionResult } from "./types.ts";

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function buildOpenRouterHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": "https://github.com/deeflect/smart-spawn",
    "X-Title": "smart-spawn-mcp",
  };
}

export class OpenRouterClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://openrouter.ai/api/v1"
  ) {}

  async chatCompletion(input: {
    model: string;
    messages: OpenRouterMessage[];
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<OpenRouterExecutionResult> {
    if (!this.apiKey) {
      throw new Error("OPENROUTER_API_KEY is required to execute runs");
    }

    const model = input.model.replace(/^openrouter\//, "");
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildOpenRouterHeaders(this.apiKey),
      signal: input.signal,
      body: JSON.stringify({
        model,
        messages: input.messages,
        max_tokens: input.maxTokens ?? 2000,
        temperature: input.temperature ?? 0.2,
      }),
    });

    const raw = await res.text();
    const data = raw ? JSON.parse(raw) : {};

    if (!res.ok) {
      const msg = data?.error?.message ?? `OpenRouter error ${res.status}`;
      throw new Error(String(msg));
    }

    const choice = data?.choices?.[0];
    const content = this.flattenContent(choice?.message?.content);
    const promptTokens = Number(data?.usage?.prompt_tokens ?? 0);
    const completionTokens = Number(data?.usage?.completion_tokens ?? 0);
    const totalTokens = Number(data?.usage?.total_tokens ?? promptTokens + completionTokens);

    return {
      text: content,
      promptTokens,
      completionTokens,
      totalTokens,
    };
  }

  private flattenContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part) {
            return String((part as any).text ?? "");
          }
          return "";
        })
        .join("\n")
        .trim();
    }
    return "";
  }
}
