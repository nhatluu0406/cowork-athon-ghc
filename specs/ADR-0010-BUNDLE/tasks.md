---
title: "ADR-0010-BUNDLE Task Breakdown"
---

# Tasks: ADR 0010 Remaining Work

## Phase 1: Stack Initialization Module

**T1.1 — Design `M365KGStackInitializer` class**
- Read: `service/src/knowledge/stack/stack-supervisor.ts`, `service/src/knowledge/stack/stack-roles.ts`
- Create: `service/src/knowledge/stack/stack-initializer.ts`
- Responsibility: one-time init on first provision (or when cluster/db is empty)
- Methods:
  - `isInitialized(): Promise<boolean>` — check `.runtime/m365kg-init.done` exists
  - `initialize(paths, secrets): Promise<void>` — run init steps:
    1. Postgres: shell out to `initdb -D <pgDataDir> --username=postgres` (or use `pg_ctl initdb`)
    2. Wait for Postgres to be startable
    3. Neo4j: run `neo4j-admin dbms set-initial-password <password>` in the Neo4j directory
    4. Start both, wait for ready
    5. Backend: determine how backend runs migrations (via `--migrate` flag? environment variable?) and run it
    6. Persist `.runtime/m365kg-init.done`
    7. Stop both (will be restarted later by normal supervisor)
- Notes: init is **destructive** (creates cluster from scratch) so guard with `isInitialized()` check

**T1.2 — Write unit tests for `stack-initializer.ts`**
- File: `service/tests/knowledge/stack-initializer.test.ts`
- Test cases:
  - First init returns false, after init returns true (idempotent)
  - Init creates `.runtime/m365kg-init.done` marker
  - Init failure cleans up partial state (no dangling marker)
  - Init with existing cluster skipped (safe to call multiple times)
  - (Optional) Mock shell-outs to `initdb`/`neo4j-admin` and verify calls

**T1.3 — Wire initializer into app startup**
- Read: `service/src/index.ts` (or wherever the Local Service bootstraps)
- Add: on startup, before launching the stack supervisor:
  ```
  const initializer = new M365KGStackInitializer(...)
  if (!await initializer.isInitialized()) {
    console.log("First launch: initializing M365KG stack...")
    await initializer.initialize(...)
  }
  const supervisor = new M365KGStackSupervisor(...)
  await supervisor.start()
  ```
- Update docs/current-status.md to note initializer is now wired

## Phase 2: Packaging & electron-builder Wiring

**T2.1 — Update electron-builder.yml for bundled stack**
- Read: `app/shell/electron-builder.yml`
- Decision point (already noted in ADR 0010): bundle zips in installer, or download at first run?
  - **Bundle in installer:** add `postgresql-*.zip`, `neo4j-*.zip`, `temurin-jre-*.zip` as `extraResources` (large installer, works offline)
  - **Download at first run:** leave zips out, provisioning logic downloads them on app first launch (smaller installer, requires network)
  - Assume "download at first run" for now (smaller, more flexible); toggle if different
- If bundle: update yml to include the three zips under `extraResources` + copy-to-data-dir logic
- If download: document that first launch will pause for provisioning (~10–30 seconds depending on network)
- Test: build (`npm run build:electron` or equivalent), verify packaged binary starts correctly

**T2.2 — Add first-launch UI feedback for provisioning**
- Read: `app/shell/src/windows/main.ts` (or equivalent main-process logic)
- During provisioning (first launch), show a splash screen or progress indicator (not just blank window)
- Message: "Initializing M365 Knowledge stack… (this may take a minute on first launch)"
- Once provisioning done, normal app startup continues
- (If minimal: just log to stderr; user can see in console if they opened dev tools)

**T2.3 — Test packaged build startup**
- Use release-verifier's approach:
  1. `npm run build:electron`
  2. Run the packaged `.exe` on Windows
  3. Verify: app window opens → stack initializes (if first run) → stack supervisor starts → app becomes interactive
  4. Document result in `docs/product/current-status.md`

## Phase 3: Documentation & Verification

**T3.1 — Update E2E_TESTING_GUIDE.md for bundled stack**
- Original guide was for "real stack running separately" (T0.4)
- Update to reflect bundled approach:
  - No need to pre-run Postgres/Neo4j manually
  - App first launch will provision & init automatically
  - For developers: init is idempotent, safe to rerun in test scenarios

**T3.2 — Update current-status.md & tasks.md**
- Mark ADR 0010 Phase 1–3 **system-test environment work** as complete (already done)
- Add new ADR 0010 Phase 4 (init+packaging) section documenting this work
- Cross-link ADR 0010 with the new bundling decision

**T3.3 — Smoke test: e2e packaged startup**
- Build & run packaged app on Windows
- First launch: verify provisioning + init runs
- Verify M365KG endpoints respond (`/health`, `/api/stats/overview`)
- Re-launch: verify init is skipped (idempotent), normal startup is fast
- Report PASS/PARTIAL/FAIL in docs/current-status.md

## Dependency Graph

```
T1.1 (design initializer)
  ↓
T1.2 (test initializer)
  ↓
T1.3 (wire into app startup)
  ↓
T2.1 (electron-builder.yml) — can be parallel to T1.3
  ↓
T2.2 (first-launch UI feedback)
  ↓
T2.3 (test packaged build)
  ↓
T3.1, T3.2, T3.3 (documentation, verification)
```

## Open Questions (for implementer)

1. **Postgres initialization:** does `initdb` require a password flag, or should the user be prompted? (Assume: use a default or derived from stack secrets, non-interactive)
   - **Resolved (2026-07-13)**: non-interactive, via a short-lived `--pwfile` (never a CLI arg, never logged), written from `secrets.pgPassword` and deleted immediately after `initdb` runs. See `stack-initializer.ts`'s `runInitdb`.
2. **Backend migrations:** how does the backend run migrations? (via `--migrate` CLI? `DATABASE_URL` env var + `sqlc` tool? Check `app/backend/` for migration strategy)
   - **Resolved (2026-07-13)**: the Go backend has no built-in migration runner/tool — `app/backend/migrations/*.sql` (+ one `*.cypher`) are plain files, applied via `scripts/wait-and-migrate.sh`'s own precedent (`psql`/`cypher-shell` directly) in the existing Docker-based dev flow. `stack-initializer.ts` does the same against the bundled binaries: `psql -f <file>` per `*.sql` (skip `*.down.sql`, filename order), `cypher-shell -f <file>` for the one `*.cypher`.
3. **Neo4j initial password:** where should the password come from? (Assume: from stack secrets, or generate a random one and store in `.runtime/m365kg-neo4j-password.txt`)
   - **Resolved (2026-07-13)**: reuses `StackSupervisorSecrets.pgPassword` (no dedicated Neo4j field exists, and `stack-supervisor.ts` was not modified to add one — see `stack-initializer.ts`'s `setNeo4jInitialPassword` doc comment). Generated once by `app/shell/src/service/m365kg-stack-secrets.ts` and persisted to `.runtime/m365kg-secrets.json` (mode 0600) rather than the suggested `.runtime/m365kg-neo4j-password.txt` — one file for both secrets, not two.
4. **Error recovery:** if init fails halfway (e.g., Postgres init succeeds but Neo4j fails), should we clean up partial state, or let the user retry?
   - **Resolved (2026-07-13)**: clean up. Any failure stops whichever temp Postgres/Neo4j supervisor was still running and removes `pgDataDir` (best-effort, logged) so the NEXT `initialize()` call starts from a genuinely empty state — `initdb` itself refuses to run against a non-empty directory, so "let the user retry into the same half-initialized dir" would just fail again with a confusing error. The `.runtime/m365kg-init.done` marker is written last, so it never exists for a partial init.
