# Agent Coordination Guide

## Project: Smart Spawn

### Agent Roles

#### API Developer Agent
**Focus:** Model Intelligence API — routes, enrichment pipeline, scoring
- Scaffold Bun + Hono project
- Implement routes (`/models`, `/recommend`, `/pick`, `/status`, `/refresh`)
- Build enrichment pipeline orchestrator
- Build individual source adapters (OpenRouter, Artificial Analysis, HF, LMArena, LiveBench)
- Composite scoring logic
- Write tests for enrichment and API endpoints

#### Data Agent
**Focus:** Model name mapping and seed overrides
- Build and maintain `aliases.yaml` (~100 model name mappings across sources)
- Curate `seed-overrides.yaml` for models missing from automated sources
- Validate enrichment output against known benchmarks
- Identify new models that need alias entries
- Research benchmark score accuracy

#### Plugin Agent
**Focus:** OpenClaw smart_spawn plugin
- `openclaw.plugin.json` manifest (follows OpenClaw docs)
- `index.ts` tool registration with `parameters` + `execute(_callId, params)`
- API client for Model Intelligence API
- Single / collective / cascade mode implementations
- Fallback behavior when API is unreachable
- Companion `SKILL.md`

#### DevOps Agent
**Focus:** Deployment and infrastructure
- Railway deployment config
- Domain setup
- Cron scheduling for enrichment refresh
- Health monitoring
- Environment variables (Artificial Analysis API key)

### Coordination Rules

1. **API Developer** is primary — enrichment pipeline and routes are the core
2. **Data Agent** works in parallel on alias mapping and seed overrides
3. **Plugin Agent** starts after API endpoints are functional
4. **DevOps Agent** works after scaffold is complete
5. No agent should modify files owned by another without coordination

### File Ownership

| Path | Owner |
|------|-------|
| `src/routes/*` | API Developer |
| `src/enrichment/pipeline.ts` | API Developer |
| `src/enrichment/sources/*` | API Developer |
| `src/enrichment/scoring.ts` | API Developer |
| `src/enrichment/rules.ts` | API Developer |
| `src/enrichment/alias-map.ts` | API Developer + Data Agent |
| `src/data/aliases.yaml` | Data Agent |
| `src/data/seed-overrides.yaml` | Data Agent |
| `src/types.ts` | API Developer (shared) |
| `smart-spawn/*` | Plugin Agent |
| `railway.json`, `Dockerfile` | DevOps |
| `data/models.json` | Generated (no manual edits) |

### Current Phase

**Phase 1: Model Intelligence API + Enrichment Pipeline**

Priority order:
1. Scaffold (Bun + Hono + TypeScript)
2. Types and data model
3. OpenRouter source adapter
4. Artificial Analysis source adapter
5. HF Open LLM Leaderboard source adapter
6. Model name alias map (initial ~50 entries)
7. Enrichment pipeline (merge + score)
8. Rule-based classification
9. `/models` + `/recommend` + `/pick` endpoints
10. `/status` + `/refresh` endpoints
11. Seed overrides for gap-fill
12. Deploy to Railway

**Phase 2: OpenClaw Plugin**

1. Plugin manifest + tool registration
2. API client
3. Single mode
4. Collective mode
5. Cascade mode
6. Fallback behavior
7. SKILL.md

**Phase 3: Expansion**

- LMArena integration (weekly, pickle parsing)
- LiveBench integration (monthly)
- MCP server (parallel to plugin, same recommendation logic)
- `/compare` endpoint

### What NOT to Build Yet

- Web dashboard
- Auth / rate limiting (personal tool)
- Custom user seed data via API
- A/B testing infrastructure
- Cost tracking integration with OpenRouter credits
