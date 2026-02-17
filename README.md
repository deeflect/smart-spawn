<p align="center">
  <img src="https://img.shields.io/badge/bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/hono-%23E36002.svg?style=for-the-badge&logo=hono&logoColor=white" alt="Hono">
  <img src="https://img.shields.io/badge/sqlite-%2307405e.svg?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite">
</p>

<h1 align="center">⚡ Smart Spawn</h1>

<p align="center">
  <strong>Model Intelligence API for smart AI model routing</strong><br>
  Benchmarks + pricing + capabilities unified into a single, queryable index.
</p>

---

## Overview

Smart Spawn ingests model catalogs, benchmark data, and pricing metadata, then serves a clean API for selecting the best models for a task. The server refreshes its data every 6 hours and caches popular endpoints for fast responses.

### Highlights

- Unified model index with pricing, context length, capabilities, and benchmark scores
- Smart recommendation endpoints (`/pick`, `/recommend`, `/compare`)
- Task decomposition helpers (`/decompose`, `/swarm`)
- Role prompt composition (`/roles/compose`)
- SQLite-backed spawn logging & feedback APIs

---

## Quickstart

```bash
bun install
bun run dev
```

The API listens on port `3000` (or `$PORT`). On startup it loads cached data and kicks off a background refresh.

### Environment variables

Create a `.env` (see `.env.example`):

- `PORT` — server port (default: `3000`)
- `REFRESH_API_KEY` — optional Bearer token to protect `POST /refresh`
- `ARTIFICIAL_ANALYSIS_API_KEY` — optional, enables richer benchmark data

---

## API

### `GET /models`
List models with optional filtering/sorting.

**Query params**
- `category` — one of known categories (e.g. `coding`, `reasoning`, `research`)
- `tier` — `budget` | `standard` | `premium`
- `limit` — 1–500 (default: 50)
- `sort` — `score` | `cost` | `efficiency` | `<category>`

### `GET /pick`
Pick the best single model for a task.

**Query params**
- `task` (required) — free text task or category name
- `budget` — `low` | `medium` | `high` | `any` (default: `medium`)
- `exclude` — comma-separated model IDs
- `context` — comma-separated context tags

### `GET /recommend`
Return top N models for a task/category with optional filters.

**Query params**
- `task` (required) — free text task **or** category name
- `category` — accepted as an alias for `task`
- `budget` — `low` | `medium` | `high` | `any` (default: `medium`)
- `count` — 1–5 (default: 1)
- `exclude` — comma-separated model IDs
- `require` — comma-separated capabilities (`vision`, `functionCalling`, `json`, `reasoning`)
- `minContext` — minimum context length
- `context` — comma-separated context tags

### `GET /compare`
Compare multiple models side-by-side.

**Query params**
- `models` (required) — comma-separated model IDs (2–5)

### `GET /status`
Health and data statistics.

### `POST /refresh`
Trigger a background data refresh.

- If `REFRESH_API_KEY` is set, include header: `Authorization: Bearer <key>`

### `POST /decompose`
Split a task into sequential subtasks.

**Body**
```json
{
  "task": "string",
  "budget": "low|medium|high|any",
  "context": "optional context tags"
}
```

### `POST /swarm`
Build a DAG for parallel execution of subtasks.

**Body**
```json
{
  "task": "string",
  "budget": "low|medium|high|any",
  "context": "optional context tags",
  "maxParallel": 1
}
```

### `GET /community/scores`
Community model scores.

**Query params**
- `category` — optional category filter
- `minRatings` — minimum ratings (default: 10)

### `POST /community/report`
Anonymous community rating.

**Body**
```json
{
  "model": "model-id",
  "category": "coding",
  "rating": 1,
  "instanceId": "anonymous-instance-id"
}
```

### `GET /spawn-log/scores`
Personal model scores.

**Query params**
- `category` — optional category filter
- `minSamples` — minimum samples (default: 3)

### `GET /spawn-log/stats`
Spawn statistics for cost dashboards.

**Query params**
- `days` — 1–365 (default: 7)

### `POST /spawn-log`
Log a spawn event.

**Body**
```json
{
  "model": "model-id",
  "category": "coding",
  "budget": "medium",
  "mode": "single",
  "role": "primary",
  "source": "api",
  "context": "optional context tags"
}
```

### `POST /spawn-log/outcome`
Report personal outcome for a model+category.

**Body**
```json
{
  "model": "model-id",
  "category": "coding",
  "rating": 1,
  "context": "optional context tags"
}
```

### `GET /roles/blocks`
List available role blocks.

### `POST /roles/compose`
Compose a role prompt from explicit blocks.

**Body**
```json
{
  "task": "build a react dashboard",
  "persona": "frontend-engineer",
  "stack": ["react", "tailwind"],
  "domain": "saas",
  "format": "full-implementation",
  "guardrails": ["code", "security"]
}
```

---

## Caching, Rate Limits, Security

- **Data refresh cycle:** background refresh every 6 hours
- **Response caching:** in-memory cache (60s TTL) for `/models`, `/pick`, `/recommend`, `/compare`, `/status`
- **Cache-Control headers:** public `max-age=300` for read endpoints; `no-store` for `/refresh` and `/spawn-log`
- **Rate limiting:** 200 requests/minute/IP (global), `/refresh` limited to 2/hour/IP
- **Security headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`

---

## Deployment

### Bun (local)
```bash
bun install
bun run dev
```

### Docker
```bash
docker build -t smart-spawn .
docker run -p 8080:8080 --env-file .env smart-spawn
```

### Railway
This repo includes a `railway.json` configured for Dockerfile deploys. Create a new Railway service and point it at this repo.

---

## License

MIT
