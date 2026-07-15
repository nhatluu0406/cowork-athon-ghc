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

## Secret boundary

Local password derives a key-encryption-key using scrypt. A random vault master key is wrapped with AES-256-GCM. Provider/MS365/MCP secrets are encrypted with the vault master key. The master key exists only in memory after unlock.

## Runtime boundary

OpenCode remains a supervised exact pin. Runtime upgrade requires a server-contract matrix; it is not coupled to the database migration.

## Extension boundary

`Kỹ năng & MCP` is a separate product surface. Skills use native runtime load-on-demand; MCP server config and active state are service-owned. Cowork/Workspace only display active summaries.

## Conversation boundary

Persist user-visible messages and durable turn summaries. Raw streaming deltas stay transient. Conversation identity remains independent from ephemeral OpenCode session IDs.
