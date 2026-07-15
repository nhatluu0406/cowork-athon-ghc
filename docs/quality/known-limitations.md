---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Known limitations — redesign period

- Credentials still use Windows Credential Manager until Wave 0 migration passes.
- Conversations/settings remain JSON until SQLite migration passes.
- Local authentication is not implemented.
- OpenCode pinned to 1.18.1 after Wave 2 server-contract matrix PASS (fallback 1.17.20 also PASS). Live create/modify tooling latency still needs packaging + provider key follow-up.
- MCP registry is not persisted, not mounted as a product API and uses an unavailable default adapter.
- Enabled Skill content is still injected into each prompt until native on-demand migration.
- PDF/live Workspace refresh, Inspector Phase 1 and diagnostics remain pending.
- MCP OAuth is deferred because OpenCode-managed tokens would live outside Cowork's encrypted database.
