---
status: proposed
updated_at: 2026-07-15
---

# Kỹ năng & MCP surface

## Navigation

Add one product-rail item directly below Cowork:

```text
Kỹ năng & MCP
```

Remove Skills from Settings. Settings remains:

- Nhà cung cấp
- Chung
- Tài khoản
- Chẩn đoán

## Surface layout

```text
Header: Kỹ năng & MCP                         Active summary

Tabs: [Kỹ năng] [MCP]

Left list/filter | Detail/editor
```

## Skills

- Built-in and user-local.
- Create/edit/delete user Skill.
- Enable/disable.
- Built-in read-only.
- Active state persisted in SQLite.
- OpenCode native Skill discovery/load-on-demand replaces full prompt injection.

## MCP Phase 1

- Local stdio or remote URL.
- Static header/API key secret in encrypted vault.
- Add/edit/remove.
- Enable/disable.
- Health and tool count.
- No OAuth in Phase 1.

## Cowork/Workspace composer

Read-only chip:

```text
2 Kỹ năng · 1 MCP
```

No selector/dropdown. Click navigates to the full surface.
