---
status: accepted
updated_at: 2026-07-16
---

# Kỹ năng & MCP surface

## Navigation

Product-rail item directly below Cowork:

```text
Kỹ năng & MCP
```

Skills removed from Settings. Settings remains:

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

- Built-in and user-local via the filesystem Skill catalog (one product Skill system).
- Extension Skill registry is deprecated.
- Create/edit/delete user Skill; enable/disable; built-in read-only.
- OpenCode native Skill discovery/load-on-demand: skill roots + allowlist written into `opencode.json` (`skills` array + `permission.skill`); full prompt injection removed.

## MCP Phase 1

- Local stdio or remote URL (SSRF-validated).
- Static header/API key in encrypted vault (`mcp:<id>:header`).
- Add/edit/remove; enable/disable; health reachability probe.
- No OAuth.

## Cowork/Workspace composer

Read-only chip:

```text
N Kỹ năng · M MCP
```

Click navigates to the hub surface — no Skill/MCP selector drawer.
