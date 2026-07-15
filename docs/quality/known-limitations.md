---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Known limitations — redesign period

- Credentials still use Windows Credential Manager until Wave 0 migration passes.
- Conversations/settings remain JSON until SQLite migration passes.
- Local authentication is not implemented.
- OpenCode remains pinned to 1.17.11; latest compatibility is not yet proven.
- MCP registry is not persisted, not mounted as a product API and uses an unavailable default adapter.
- Enabled Skill content is still injected into each prompt until native on-demand migration.
- PDF/live Workspace refresh, Inspector Phase 1 and diagnostics remain pending.
- MCP OAuth is deferred because OpenCode-managed tokens would live outside Cowork's encrypted database.
