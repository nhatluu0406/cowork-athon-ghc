---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Trạng thái hiện tại — storage/runtime redesign pending

Cowork GHC có Commercial UI, Cowork/Workspace, provider profiles, Skills CRUD và MS365 source foundation. Trước feature expansion tiếp theo, dự án sẽ thực hiện local-data redesign và runtime compatibility theo Roadmap V2.

## Current truth

| Capability | Status | Note |
|---|---|---|
| Cowork chat | WORKS / NEEDS PERFORMANCE CHECK | Streaming/tool flow exists; measure stage latency before runtime change. |
| Workspace | PARTIAL | Text editing works; PDF/live refresh remain. |
| Provider profiles | WORKS — BASIC | Metadata/settings JSON; secrets currently Windows Credential Manager. |
| Local database | NOT IMPLEMENTED | Planned SQLite source of truth. |
| Local app authentication | NOT IMPLEMENTED | Must precede encrypted DB credentials. |
| Conversations | WORKS — JSON | Planned SQLite migration. |
| Skills CRUD | WORKS — BASIC | Currently Settings + full prompt injection; planned separate surface/on-demand. |
| MCP | FOUNDATION ONLY | In-memory registry, no mounted router/live adapter/UI. |
| OpenCode | PINNED 1.17.11 | Compatibility test planned for 1.18.1/1.17.20. |
| MS365 | SOURCE PRESENT | Credential storage must migrate with common vault. |
| Inspector | PARTIAL | Phase 1 planned. |
| Logging/telemetry | PARTIAL | Toggles exist; full contract pending. |

## Security direction

- No plaintext API/MS365/MCP secret in SQLite.
- No Windows Credential Manager after migration acceptance.
- Local password unlocks an encrypted vault master key.
- Renderer never accesses database or secret bytes.
