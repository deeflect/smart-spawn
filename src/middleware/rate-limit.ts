import type { MiddlewareHandler } from "hono";

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

interface RateLimitEntry {
  timestamps: number[];
}

function getClientIp(req: Request): string {
  const headers = req.headers;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const { windowMs, max } = options;
  const store = new Map<string, RateLimitEntry>();

  return async (c, next) => {
    const ip = getClientIp(c.req.raw);
    const now = Date.now();
    const entry = store.get(ip) ?? { timestamps: [] };

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= max) {
      const retryAfterMs = windowMs - (now - entry.timestamps[0]);
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
      c.header("Retry-After", retryAfterSec.toString());
      return c.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        429
      );
    }

    entry.timestamps.push(now);
    store.set(ip, entry);

    await next();
  };
}
