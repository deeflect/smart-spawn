import type { MiddlewareHandler } from "hono";

interface CacheEntry {
  body: string;
  init: ResponseInit;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function responseCache(options: { ttlMs: number; paths: string[] }): MiddlewareHandler {
  const { ttlMs, paths } = options;
  const pathSet = new Set(paths);

  return async (c, next) => {
    if (c.req.method !== "GET") return next();

    const url = new URL(c.req.url);
    const path = url.pathname;

    if (!pathSet.has(path)) return next();

    const key = `${c.req.method}:${url.pathname}?${url.searchParams.toString()}`;
    const now = Date.now();
    const cached = cache.get(key);

    if (cached && cached.expiresAt > now) {
      const res = new Response(cached.body, cached.init);
      c.res = res;
      return res;
    }

    await next();

    if (!c.res) return;
    if (c.res.status >= 200 && c.res.status < 300) {
      const cloned = c.res.clone();
      const body = await cloned.text();
      const headers = new Headers(cloned.headers);
      const init: ResponseInit = {
        status: cloned.status,
        statusText: cloned.statusText,
        headers,
      };
      cache.set(key, { body, init, expiresAt: now + ttlMs });
    }
  };
}
