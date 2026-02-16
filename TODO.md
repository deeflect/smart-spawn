# Smart Spawn — TODO

## v1 — Core (DONE)

- [x] Model Intelligence API with 5 data sources (340 models, 213 with benchmarks)
- [x] SQLite cache with WAL, 6h incremental refresh
- [x] Z-score normalization for benchmark scoring (data-driven weights)
- [x] `/pick`, `/recommend`, `/models`, `/compare`, `/status`, `/refresh` endpoints
- [x] Budget tiers with price floors: low ($0-1), medium ($0-5), high ($2-20), any
- [x] `/pick` supports `?exclude=` for cascade deduplication
- [x] Plugin with smart_spawn tool (single, collective, cascade modes)
- [x] Companion SKILL.md for JSON→sessions_spawn handoff
- [x] Provider-aware routing (detects direct keys, skips OpenRouter markup)
- [x] Spawn logging to SQLite (`POST /spawn-log`, `GET /spawn-log/stats`)
- [x] Tested all 3 modes end-to-end on Docker OpenClaw instance

---

## Pre-Ship Polish (DONE)

- [x] Add error/warning when no OpenRouter auth and no direct providers detected
- [x] Finish cost dashboard: cascade escalation tracking, richer stats
- [x] Learning loop: track spawn outcomes, build personal model rankings
- [x] Update SKILL.md with latest JSON shapes (labels, scoring, pricing in cascade)
- [ ] Context-aware routing: pass tech stack to recommendations → moved to v2.1
- [ ] Clean up plugin `package.json` (minimal deps)
- [ ] Write user-facing README.md with install instructions

---

## v2 — Learning Loop (DONE)

- [x] Track outcomes: did user accept or redo the task?
- [x] Outcome signals: no complaint = success, "try again" / "use X instead" = failure
- [x] Personal model scores: rolling average per category
- [x] Feed personal scores into recommendation: blend with benchmark scores
- [x] Weight: 70% benchmarks + 30% personal history (adjustable)

---

## v2.1 — Context-Aware Routing (DONE)

- [x] Static context signals: context tags boost models with strong relevant benchmarks
- [x] API endpoint: `/pick?task=coding&budget=medium&context=nextjs,supabase`
- [x] Context-aware personal scores: learn which models work for specific tech stacks
- [x] Subcategory routing: LiveBench coding vs agentic coding vs math

---

## v3 — Task Decomposition (DONE)

- [x] Complexity classifier: simple (single spawn) vs complex (decompose)
- [x] Decomposition prompt: break task into subtasks with categories
- [x] Route each subtask to optimal model independently
- [x] Coordinate outputs: sequential (output feeds next) or parallel (merge at end)

---

## v4 — Community Rankings (DONE)

- [x] Anonymous telemetry opt-in (spawn model + category + outcome, no task content)
- [x] Aggregation endpoint on Model Intelligence API
- [x] Community scores: "across N users, model X is #1 for coding"
- [x] Blend: benchmarks + personal + community (configurable weights)

---

## Deploy (after polish)

- [ ] Deploy Model Intelligence API to Railway
- [ ] Set up domain (model-intel.borb.bot or similar)
- [ ] Update plugin default `apiUrl` to production URL
- [ ] Set up monitoring / uptime check
- [ ] Publish to npm as `@borbbot/smart-spawn`
- [ ] Test fresh install flow: `openclaw plugins install` → configure → use
