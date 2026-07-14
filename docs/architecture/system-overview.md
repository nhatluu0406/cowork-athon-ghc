---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Tổng quan kiến trúc

```text
Electron renderer
→ typed preload / shell bridge
→ loopback local application service
→ supervised OpenCode runtime
→ active provider profile / LLM endpoint
```

## Desktop shell

- Electron main process sở hữu BrowserWindow, native titlebar overlay, service/runtime lifecycle và allow-listed IPC.
- Renderer không có Node.js access trực tiếp.
- Commercial UI V3 dùng product rail, surface-specific layout, light/dark semantic tokens và native Windows controls.

## Local service

Service giữ business logic và boundary:

- workspace validation và file access;
- conversation persistence;
- provider profiles và connection testing;
- credential references;
- Skills catalog/CRUD;
- permission gate;
- runtime event mapping;
- File Work Review snapshots;
- settings/diagnostics.

Service bind loopback và dùng authenticated local boundary.

## Persistence / database

POC hiện không dùng SQL database.

- Conversation/index/settings/profile/Skill-enabled state: local JSON files, ghi atomically bằng temporary file + rename khi phù hợp.
- API secrets: Windows Credential Manager thông qua `@napi-rs/keyring`.
- Runtime/process identity: `.runtime` hoặc application profile data.
- Generated reports/screenshots không phải source of truth.

## Provider boundary

`ProviderProfileStore` quản lý nhiều profile secret-free. Credential được namespace theo profile ID trong keyring. Runtime resolver chuyển active profile thành OpenCode configuration.

Current provider UX:

- DeepSeek preset;
- custom OpenAI-compatible endpoint;
- explicit model ID;
- connection test/readiness.

Planned extension: call OpenAI-compatible `GET /models` when endpoint supports it, with manual model ID fallback. Discovery failure must not prevent manual configuration.

## Permission boundary

File mutation và command execution phải qua permission policy/gate. Composer exposes permission mode, but execution boundary remains authoritative.

Product invariant:

```text
assistant prose ≠ verified mutation
```

Create/modify success requires successful tool/mutation evidence and valid workspace confinement.

## Workspace boundary

- Native folder picker selects active workspace.
- Service validates and confines file access through realpath/workspace guard.
- Navigator lists bounded entries without unrestricted renderer filesystem access.
- Preview/edit behavior is extension- and size-bounded.
- Dirty editor content must not be overwritten by Agent refresh.

## Conversation / runtime turn

Cowork conversation is persistent user identity. OpenCode runtime sessions may be ephemeral per turn. Context handoff is bounded and never shown as visible transcript content.

## UI surface ownership

| Surface | Layout ownership |
|---|---|
| Cowork | conversation sidebar + conversation canvas + optional Inspector |
| Workspace | file tree + editor/preview + optional Cowork companion |
| Settings | settings navigation + content |
| D1–D4 / Code | full application surface |

Hidden Inspector or sidebar columns must never reserve space outside their owning surface.

## External integration boundaries

D1–D4 entries are stable mount points only until team code is merged. The production shell must not fake records, metrics, connectivity, or completed capability.
