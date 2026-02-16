# Smart Spawn

Model Intelligence API that pulls LLM data from multiple sources, enriches with benchmarks and scores, and serves smart recommendations.

## What it does

Aggregates model data from 4 sources into one API:

| Source | Models | Matched | Data |
|--------|--------|---------|------|
| OpenRouter | 340 | 340 (base catalog) | Pricing, context length, capabilities |
| Artificial Analysis | 398 | 162 | Intelligence/coding/math indices, speed, latency |
| HF Open LLM Leaderboard | ~4500 | ~30 | IFEval, BBH, MMLU-Pro, GPQA (open models only) |
| LMArena (Chatbot Arena) | 290 | 76 | Arena ELO scores (human preference) |

179 models end up with benchmark data. Every model gets scored across 7 categories: general, coding, reasoning, creative, vision, research, fast-cheap.

## Quick start

```bash
bun install
ARTIFICIAL_ANALYSIS_API_KEY=your_key bun run dev
```

Server starts on `http://localhost:3000`. First refresh takes ~30s (pulls all sources).

## API

```
GET /models                    Full catalog with filters (?category=coding&tier=premium&limit=10)
GET /recommend?task=coding     Smart recommendations (?budget=medium&count=3)
GET /pick?task=coding          Single best model ID for a task
GET /status                    Health check, source status, model counts
POST /refresh                  Trigger manual data refresh
```

### Example: recommend for coding

```bash
curl "http://localhost:3000/recommend?task=coding&count=3&budget=medium"
```

```json
{
  "data": [
    {
      "model": { "id": "google/gemini-2.5-pro-preview-05-06", "scores": { "coding": 77 }, ... },
      "reason": "Strong coding model at medium budget",
      "confidence": 0.92
    },
    ...
  ]
}
```

### Example: pick best model

```bash
curl "http://localhost:3000/pick?task=creative+writing&budget=high"
```

```json
{
  "data": {
    "id": "google/gemini-2.5-pro",
    "reason": "Top creative model at high budget"
  }
}
```

## How scoring works

Each model gets a 0-100 score per category:

- **General:** AA intelligence index > Arena ELO > HF MMLU-Pro > tier baseline
- **Coding:** AA coding index > LiveCodeBench > general * 0.85
- **Reasoning:** AA intelligence index > Arena ELO > baseline (boosted for reasoning-capable models)
- **Creative:** Arena ELO (human preference) > general for premium models
- **Vision:** Same as general for vision-capable models
- **Research:** General + context length bonus (up to +20 for 1M+ context)
- **Fast-cheap:** Inverse of price ($0 = 100, $1 = 50)

Cost efficiency = score / price ratio per category.

## Model name mapping

The hardest part. Every source uses different names for the same model. A hand-maintained `src/data/aliases.yaml` maps ~200 models across ~632 name variants. The pipeline also does aggressive normalization: dash-to-space, strip date/version suffixes, ChatGPT→GPT mapping, etc.

## Stack

- **Runtime:** Bun
- **Framework:** Hono
- **Language:** TypeScript
- **Storage:** JSON file cache (no database)

## Environment variables

```
ARTIFICIAL_ANALYSIS_API_KEY=   # Required for Artificial Analysis source
PORT=3000                       # Server port (default 3000)
```
