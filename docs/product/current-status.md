---
language: "vi"
status: "active"
updated_at: "2026-07-16"
---

# Trạng thái hiện tại — Wave 0B conversation SQLite

Cowork GHC có Commercial UI, Cowork/Workspace, provider profiles, Skills CRUD và MS365 source foundation. Wave 0A (local SQLite + app lock + encrypted vault) đã land. Wave 0B chuyển conversation persistence sang SQLite.

## Current truth

| Capability | Status | Note |
|---|---|---|
| Cowork chat | WORKS — Wave 0A stabilize | Optimistic bubble + progressive streaming. Live attach gated; DevTools in Settings → Chung. |
| Workspace | PARTIAL | Text editing works; PDF/live refresh remain. |
| Provider profiles | WORKS — BASIC | `Lưu & kiểm tra` persists verification fingerprint; status bar shows `Đã kiểm tra` after success / relaunch. |
| Local database | WORKS — Wave 0A + 0B | Packaged: `%LOCALAPPDATA%\Cowork GHC\data\cowork-ghc.db`. Dev: `<repo>\.runtime\data\cowork-ghc.db`. |
| Local app authentication | WORKS — Wave 0A | First-run username/password + unlock; master key in memory only. |
| Conversations | WORKS — SQLite (Wave 0B) | Summaries/messages/provider snapshots/durable turns/attachment metadata + file-review refs in DB. Idempotent import from `conversations/` JSON → `.migrated-backup`; SQLite is sole source after import. No raw token deltas / SSE. |
| Skills CRUD | WORKS — BASIC | Currently Settings + full prompt injection; planned separate surface/on-demand. |
| MCP | FOUNDATION ONLY | In-memory registry, no mounted router/live adapter/UI. |
| OpenCode | PINNED 1.18.1 | Wave 2: server-contract matrix PASS vs 1.17.11/1.17.20; health ready ~61ms vs baseline 163ms. Live LLM stages remain provider-key gated. |
| MS365 | SOURCE PRESENT | Tokens migrate into the same encrypted vault after unlock. |
| Inspector | PARTIAL | Phase 1 planned. |
| Logging/telemetry | PARTIAL | Toggles exist; full contract pending. |

## Security direction

- No plaintext API/MS365/MCP secret in SQLite.
- Windows Credential Manager is migration source only; dependency removed after migration tests PASS.
- Local password unlocks an encrypted vault master key.
- Renderer never accesses database or secret bytes.
