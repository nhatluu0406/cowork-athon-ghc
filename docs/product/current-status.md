---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Trạng thái hiện tại — Wave 0A vault landed; Wave 0B next

Cowork GHC có Commercial UI, Cowork/Workspace, provider profiles, Skills CRUD và MS365 source foundation. Wave 0A (local SQLite + app lock + encrypted vault) đã land trên `feature/local-data-vault`. Conversation persistence vẫn JSON cho đến Wave 0B.

## Current truth

| Capability | Status | Note |
|---|---|---|
| Cowork chat | WORKS / NEEDS PERFORMANCE CHECK | Streaming/tool flow exists; measure stage latency before runtime change. |
| Workspace | PARTIAL | Text editing works; PDF/live refresh remain. |
| Provider profiles | WORKS — BASIC | Settings + profiles/verification mirrored in SQLite; secrets in encrypted vault. |
| Local database | WORKS — Wave 0A | `<userData>/cowork-ghc.db` via pinned `better-sqlite3` rebuilt for Electron ABI on `package:win`. |
| Local app authentication | WORKS — Wave 0A | First-run username/password + unlock; master key in memory only. |
| Conversations | WORKS — JSON | Wave 0B migrates to SQLite. |
| Skills CRUD | WORKS — BASIC | Currently Settings + full prompt injection; planned separate surface/on-demand. |
| MCP | FOUNDATION ONLY | In-memory registry, no mounted router/live adapter/UI. |
| OpenCode | PINNED 1.17.11 | Compatibility test planned for 1.18.1/1.17.20. Do not change in Wave 0A. |
| MS365 | SOURCE PRESENT | Tokens migrate into the same encrypted vault after unlock. |
| Inspector | PARTIAL | Phase 1 planned. |
| Logging/telemetry | PARTIAL | Toggles exist; full contract pending. |

## Security direction

- No plaintext API/MS365/MCP secret in SQLite.
- Windows Credential Manager is migration source only; dependency removed after migration tests PASS.
- Local password unlocks an encrypted vault master key.
- Renderer never accesses database or secret bytes.
