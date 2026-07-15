---
status: proposed
date: 2026-07-15
---

# ADR 0007 — Local SQLite database and encrypted secret vault

## Context

Cowork GHC currently persists settings/conversations as JSON and stores provider/MS365 credentials in Windows Credential Manager. The product direction now requires one local database for application state and local authentication, without Windows Credential Manager.

Electron 33 embeds Node 20, so the built-in `node:sqlite` module is unavailable in the current shell runtime.

## Decision

Use a service-owned SQLite database at:

```text
<Electron userData>/cowork-ghc.db
```

Use a pinned `better-sqlite3` adapter in the service/main process.

Secrets are encrypted before insertion:

- password-derived key: `crypto.scrypt`;
- random vault master key;
- wrapped master key: AES-256-GCM;
- secret records: AES-256-GCM with unique nonce and AAD;
- decrypted master key held only in memory after unlock.

No renderer database access and no plaintext secret in DB, logs, diagnostics, exports or backups.

## Initial schema

```text
schema_migrations
app_meta
local_users
vault_keys
secrets
settings
provider_profiles
provider_verifications
conversations
messages
runtime_turns
conversation_attachments
file_review_refs
skill_state
mcp_servers
mcp_secret_refs
```

## Conversation policy

Persist user-visible messages and durable summaries. Do not persist raw token deltas or the entire SSE stream.

## Migration

1. Create DB and schema.
2. Import non-secret JSON state.
3. After user creates/unlocks local account, import keyring credentials into encrypted vault.
4. Verify target records.
5. Delete old keyring entries only after explicit successful migration.
6. Rename old JSON state to `.migrated-backup` for one version; remove in later cleanup.

## Consequences

Positive:

- transactional search/rename/delete;
- one schema version;
- local user ownership;
- encrypted secret storage;
- simpler backup/export.

Costs:

- native SQLite addon must be packaged for Electron;
- password reset without recovery loses encrypted secrets;
- migration requires focused Windows packaged acceptance.
