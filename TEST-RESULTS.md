# Smart Spawn — Test Results (2026-02-15)

Tested by Bobby (MiniMax M2.5) on Docker OpenClaw test instance.

## ✅ Passing

| Mode | Task | Result |
|------|------|--------|
| Single | Python hello world | ✅ Correct model, clean spawn |
| Collective (3) | JS hello world | ✅ All 3 completed, diverse responses |
| Cascade (cheap) | JS closures | ✅ Good enough, no escalation |
| Cascade (cheap) | Thread-safe LRU cache | ✅ 18 tests passing |

## 🐛 Bugs

1. **Cascade returns same model for cheap + premium** — `/pick` with budget "low" and "high" both return DeepSeek V3.2. API scoring doesn't differentiate tiers properly.
2. **No auto-escalation** — Cascade quality eval is manual (agent decides). Need LLM-judged threshold.
3. **No auto-synthesis** — Collective results require manual `sessions_history` fetch.
4. **Inconsistent labels** — Collective labels constructed manually by agent.

## 📋 TODO

- [ ] Fix `/pick` budget tier logic — low/medium/high must return different price ranges
- [ ] Define budget tiers: low = <$1/M, medium = $1-5/M, high = $5+/M (or similar)
- [ ] Auto-fetch collective results when subagents complete
- [ ] Standardize label format in all response modes
- [ ] Add quality scoring for cascade escalation (v2)
