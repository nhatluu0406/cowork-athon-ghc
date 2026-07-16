---
status: accepted
date: 2026-07-15
---

# ADR 0007 — Local SQLite database and encrypted secret vault

## Context

Cowork GHC previously persisted settings/conversations as JSON and stored provider/MS365
credentials in Windows Credential Manager. The product direction requires one local database
for application state and local authentication, without Windows Credential Manager as the
long-term credential home.

Electron 33 embeds Node 20, so the built-in `node:sqlite` module is unavailable in the current
shell runtime.

## Decision

Use a service-owned SQLite database at:

```text
<Electron userData>/cowork-ghc.db
```

Use a pinned `better-sqlite3` adapter in the service/main process (no ORM).

Secrets are encrypted before insertion:

- password-derived key: `crypto.scrypt` (N=16384, r=8, p=1);
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
Wave 0B stores conversations / messages / runtime turns / attachment metadata / file-review *references* in SQLite; workspace files and review snapshot bodies remain on the filesystem. Legacy `conversations/` JSON is imported idempotently then renamed to `.migrated-backup`.

## Migration

1. Create DB and schema.
2. Import non-secret JSON state into SQLite; rename file to `.migrated-backup`.
3. After user creates/unlocks local account, import keyring credentials into encrypted vault.
4. Verify target records (decrypt round-trip).
5. Delete old keyring entries only after explicit successful migration.
6. Remove `@napi-rs/keyring` dependency/packaging after migration tests PASS.

## Consequences

Positive:

- transactional search/rename/delete foundation;
- one schema version;
- local user ownership;
- encrypted secret storage;
- simpler backup/export.

Costs:

- native SQLite addon must be packaged for Electron;
- password reset without recovery loses encrypted secrets;
- migration requires focused Windows packaged acceptance.

## Acceptance (Wave 0A)

- [x] SQLite adapter + explicit migrations at `<userData>/cowork-ghc.db`.
- [x] First-run local username/password setup + unlock.
- [x] Wrapped vault master key + encrypted `secrets` table.
- [x] Settings / provider profiles / verification state in SQLite.
- [x] Provider + MS365 secret migration with verify-then-delete and rollback on failure.
- [x] Renderer never receives DB handle, password verifier, vault key, or raw secret.
- [x] Focused storage/auth/credential tests PASS.
- [x] Packaged native SQLite loads under Electron ABI (`rebuild:native:electron` +
  `app.asar.unpacked/.../better_sqlite3.node`; verified by `npm run verify:native-sqlite`).
- [ ] Operator: packaged setup → provider key → relaunch → unlock.
