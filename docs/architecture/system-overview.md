---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Tổng quan kiến trúc V2

```text
Electron renderer
→ typed preload
→ loopback local application service
→ SQLite repositories + encrypted secret vault
→ supervised OpenCode runtime
→ provider / MCP / workspace
```

## Data boundary

SQLite at `<userData>/cowork-ghc.db` becomes the source of truth for local user, settings, provider profiles, encrypted secret records, conversations/messages, Skill state and MCP config.

Skill files and workspace files remain on filesystem. File Work Review binary/text snapshots remain filesystem artifacts with DB references.

Local diagnostics (Wave 6) are local-only with no network egress: structured logs are rotating JSON-lines files under `data/logs` (every record scrubbed by the secret scrubber before it is written), and aggregate telemetry is a bounded name→value counter table in the same SQLite database (a fixed allowlist; the enable toggle gates collection). Export goes through the `/v1/diagnostics` router (a redacted JSON bundle) and the shell's save-dialog IPC — the renderer never chooses a write path.

## Secret boundary

Local password derives a key-encryption-key using scrypt. A random vault master key is wrapped with AES-256-GCM. Provider/MS365/MCP secrets are encrypted with the vault master key. The master key exists only in memory after unlock.

## Runtime boundary

OpenCode remains a supervised exact pin. Runtime upgrade requires a server-contract matrix; it is not coupled to the database migration.

## Extension boundary

`Kỹ năng & MCP` is a separate product surface. Skills use native runtime load-on-demand; MCP server config and active state are service-owned. Cowork/Workspace only display active summaries.

## Conversation boundary

Persist user-visible messages and durable turn summaries. Raw streaming deltas stay transient. Conversation identity remains independent from ephemeral OpenCode session IDs.

## Surface boundary (Workspace ↔ Code)

`Workspace` (file/document-centric) and `Code` (project/developer-centric) are **two renderer surfaces over one shared backend** (ADR 0013). Both use the same `settingsStore.activeWorkspace()`, the same `WorkspaceGuard`, workspace-relative file APIs, the guarded direct-save route, the `PermissionGate`, File Work Review + verified evidence, the `SessionService`, and the single supervised OpenCode runtime. `Code` has **no** backend/session/runtime/guard/permission-gate of its own; all its file I/O goes through the loopback service token-guarded client (no generic IPC, no renderer `fs`, per ADR 0009). There is no terminal, dev-server, or embedded web preview.

Code Phase 1 (ADR 0013) adds a renderer-only multi-tab editor controller (`mountCodeEditor`) over that same shared backend: it reads with `readWorkspaceFileContent` and saves with the guarded direct-save route `PUT /v1/workspace/file-content` (the exact routes the Workspace companion uses), reuses File Work Review verified-mutation evidence for refresh/conflict/deleted handling, and feeds only the active file's workspace-relative path into the shared Agent session as context. Non-text kinds hand off to the Workspace companion rather than duplicating a viewer.
