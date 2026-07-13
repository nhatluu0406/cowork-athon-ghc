---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# Multi-Provider Profiles — Phase 1

Phase 1 adds application-layer provider profiles independent of D4 Gateway.

## In scope

- Multiple saved profiles (DeepSeek preset + custom OpenAI-compatible)
- Per-profile Windows keyring credential (`profile:{id}` namespace)
- Active profile switching without app restart
- Per-profile connection test (isolated results)
- Conversation provider snapshot on first turn
- Legacy single-provider settings migration (idempotent)

## Out of scope

- Routing, failover, round-robin, key pool, cost routing
- D4 Gateway merge
- Model auto-discovery beyond DeepSeek preset list
- In-conversation provider switch UI

## Architecture seams

- `ProviderProfileStore` — persisted CRUD + active profile
- `ProviderConnectionTester` — per-profile probe isolation
- `RuntimeProviderConfig` — maps profile → OpenCode/custom adapter config
- `ProfileRuntimeBridge` — syncs active profile into runtime resolver without restart
