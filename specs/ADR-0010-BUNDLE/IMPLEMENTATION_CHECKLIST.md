---
title: "ADR-0010-BUNDLE Implementation Checklist"
document_type: "implementation-checklist"
---

# Implementation Checklist: ADR 0010 Remaining Work

**Spec:** `specs/ADR-0010-BUNDLE/spec.md`  
**Tasks:** `specs/ADR-0010-BUNDLE/tasks.md`  
**Status:** Implemented — code complete & unit-tested; Windows execution verification (T2.3/T3.3) PARTIAL, see Implementation Record  
**Assigned to:** speckit-implementer  
**Date:** 2026-07-13

---

## Pre-Flight Checklist

- [x] Spec is complete and acceptance criteria are clear (spec.md)
- [x] Tasks are broken down and sequenced (tasks.md, dependency graph shown)
- [x] No blocking decisions await approval (all in ADR 0010)
- [x] Code to read: `service/src/knowledge/stack/*`, `app/shell/electron-builder.yml`, Local Service entry point
- [x] Tests to write: `service/tests/knowledge/stack-initializer.test.ts`
- [x] Documentation to update: `E2E_TESTING_GUIDE.md`, `docs/product/current-status.md`

---

## Phase 1: Stack Initialization Module

### T1.1 — Design `M365KGStackInitializer` class

**Files to create:**
- `service/src/knowledge/stack/stack-initializer.ts`

**Acceptance criteria:**
- [x] `isInitialized(root: string): Promise<boolean>` — checks for `.runtime/m365kg-init.done` marker
- [x] `initialize(paths: StackPaths, secrets: StackSupervisorSecrets, root: string): Promise<void>`
  - [x] Runs `initdb` to create Postgres cluster in `paths.pgDataDir` (non-interactive, user=postgres)
  - [x] Waits for Postgres to be startable (TCP-connect readiness, reusing `stack-roles.ts`'s `postgresRole`)
  - [x] Runs `neo4j-admin dbms set-initial-password <password>` in Neo4j bin dir
  - [x] Starts both Postgres and Neo4j briefly to verify readiness
  - [x] Runs migrations: resolved by code inspection — the backend has no migration *tool*
        (`app/backend`'s own `wait-and-migrate.sh` applies plain `.sql`/`.cypher` files via
        `psql`/`cypher-shell` directly); the initializer does the same against the bundled binaries.
  - [x] Stops both processes (via `GenericChildSupervisor.stop()`, graceful-then-force)
  - [x] Writes `.runtime/m365kg-init.done` marker as a JSON file with timestamp
- [x] Destructor/cleanup on error: if init fails mid-way, logs clearly and leaves cluster in a clean state (either fully initialized or fully uninitialized) — on failure, temp supervisors are stopped and `pgDataDir` is removed (best-effort) so a retry starts clean; the marker is written LAST.
- [x] `npx tsc -b` passes (strict mode) — `--noEmit` is not this project's convention; `tsc -b` (composite build) is, and it's clean.

**Verification steps:**
- [x] Run `npm test` on `service/tests/knowledge/stack-initializer.test.ts` — 8/8 pass
- [x] Code review: independent `security-reviewer` pass run on the full diff (command-injection/secret-handling focus) — see this checklist's Implementation Record for the result.

---

### T1.2 — Write unit tests for `stack-initializer.ts`

**Files to create:**
- `service/tests/knowledge/stack-initializer.test.ts`

**Test cases:**
- [x] `isInitialized() returns false before init, true after`
- [x] `initialize()` creates `.runtime/m365kg-init.done` with a valid JSON timestamp
- [x] `initialize()` is idempotent — calling twice on same cluster is safe (second call returns early)
- [x] `initialize()` with a missing `paths.pgDataDir` creates it before running `initdb`
- [x] Init failure (e.g., port conflict, no disk space) cleans up any partial state — 2 scenarios
      (failure during Postgres, failure during Neo4j step) both verified
- [x] (Mock test) Verify shell-out commands are safe (SQL-escaped password, `neo4j-admin` argv never
      logged by the default `CommandRunner`, absolute-path validation rejects relative paths)

**Acceptance criteria:**
- [x] All tests pass — 8/8
- [x] At least 4 test cases covering happy path + failure modes — 8 total
- [x] No real Postgres/Neo4j/backend required (fakes or spies on shell calls)

---

### T1.3 — Wire initializer into app startup

**Files to modify:**
- `service/src/index.ts` (or wherever Local Service bootstraps; confirm by code inspection)

**Deviation (confirmed by code inspection, as the checklist itself invited):**
`service/src/index.ts` is a pure library barrel with no process bootstrap of its own — it is
imported in-process by `app/shell`; there is no separate "Local Service" process to wire into.
The REAL analogue of "app startup" for a supervised child-process stack is `app/shell/src/main.ts`
(the Electron main entry) — the same place `OpencodeSupervisor` itself is (partially) wired.
Per this project's existing convention for exposing `knowledge/*` submodules (`./knowledge/types`
in `package.json`, not re-exported from `src/index.ts`), a new `./knowledge/stack` export subpath
+ barrel (`service/src/knowledge/stack/index.ts`) was added instead — `service/src/index.ts`
itself is unmodified.

**Changes:**
- [x] Import `M365KGStackInitializer`, `M365KGStackSupervisor` — via
      `@cowork-ghc/service/knowledge/stack` in `app/shell/src/service/m365kg-stack-launch.ts`
- [x] Before starting the supervisor: `m365kg-stack-launch.ts`'s `start()` checks
      `initializer.isInitialized()` and calls `initialize()` first when needed (same shape as the
      checklist's snippet, generalized behind test seams)
- [x] Catch init errors gracefully — `start()` never rejects; logs
      `m365kg_stack_start_failed: <message>` and leaves the feature degraded (skipped) for that run
- [x] Supervisor start follows initialization step
- [x] No changes to existing OpenCode supervisor logic — `lifecycle.ts`/`service-controller.ts`/
      `OpencodeSupervisor` are untouched; only `main.ts`'s composition is extended

**Acceptance criteria:**
- [x] `npx tsc -b` passes (no new type errors) — both `service/` and `app/shell/`
- [x] Existing tests still pass (`npm test`) — `main-bundle.test.ts`, `lifecycle.test.ts`,
      `service-controller.test.ts` reverified; see Implementation Record for the full-suite caveat
- [x] Code review: init errors are logged clearly (`m365kg_init_failed: <message>` in
      `stack-initializer.ts`; `m365kg_stack_start_failed: <message>` in `m365kg-stack-launch.ts`),
      never swallowed silently — always at least one log line per failure.

---

## Phase 2: Packaging & electron-builder Wiring

### T2.1 — Update electron-builder.yml for bundled stack

**Files to modify:**
- `app/shell/electron-builder.yml`

**Decision (from ADR 0010 Open Items):**
- Assume: **Download at first run** (provisioning downloads zips on app first launch)
- If bundling instead: add zips as `extraResources` and copy-to-data logic

**Changes:**
- [x] Downloading: documented in a new header comment (the Postgres/Neo4j/JRE/llm-svc/backend
      zips stay "download at first run" per the ADR; only this app's own small migration files are
      `extraResources`, since the initializer needs them before any download would even land)
- [x] N/A — not bundling the stack zips themselves (see above)
- [x] No changes to signing/notarization — confirmed unchanged
- [x] Build test: this repo's actual equivalent is `npm run build:app` (renders + bundles the
      shell) — succeeds. (`npm run package:win` — see Acceptance criteria below.)

**Acceptance criteria:**
- [x] electron-builder.yml is valid YAML — validated via `js-yaml` parse
- [ ] Build completes: `npm run package:win` produces a `.exe` — **FAILS in this sandbox**, but
      **confirmed pre-existing** (reproduces identically on the unmodified baseline via
      `git stash`): electron-builder's Windows-entry sanity check compares the `\`-separated main
      field against the asar's `/`-separated stored paths, which only reproduces when
      cross-building a Windows target from a non-Windows host. `npm run build:app` (everything
      before the final pack step) succeeds. See `docs/product/current-status.md`'s ADR 0010 Phase
      4 section.
- [x] Code review: the new `extraResources` entry's `from`/`to` paths reviewed — `from` is
      repo-root-relative (matches every other entry in this file), `to` matches
      `m365kg-stack-paths.ts`'s packaged `migrationsDir` resolution exactly (`m365kg-migrations`
      under `resourcesPath`).

---

### T2.2 — Add first-launch UI feedback for provisioning

**Files to modify:**
- `app/shell/src/windows/main.ts` (or equivalent main-process entry point; confirm by inspection)

**Deviation confirmed by inspection**: there is no `app/shell/src/windows/` directory in this
repo; the actual main-process entry point is `app/shell/src/main.ts`, which is where this was
wired.

**Changes:**
- [x] Detect first launch — `M365KGStackInitializer.isInitialized()` (checked inside
      `m365kg-stack-launch.ts`'s `start()`, called from `main.ts`'s `prepare()`)
- [~] Show a splash screen or progress message — **deliberately the checklist's own explicitly-
      sanctioned "minimal" branch** ("If minimal: just log to stderr; user can see in console if
      they opened dev tools"), not a dedicated splash `BrowserWindow`: structured lifecycle-log
      lines (`m365kg_stack_first_launch_initializing`, `m365kg_stack_initialized`,
      `m365kg_stack_started`) via the existing `writeLifecycleLog` channel, visible via
      `View > Toggle Developer Tools` — same channel the Cowork service itself already uses for
      its own startup. A renderer-visible splash/progress bar was judged out of proportion for an
      additive, optional feature and was not built — flagged here rather than silently skipped.
  - [ ] Hide main window until provisioning complete — NOT done (see above); the main window's
        own existing "not connected, retry" surface is unaffected by M365KG's state.
  - [x] Effectively "minimize/defer the splash" branch taken outright, by design.
- [x] Log provisioning steps to console — via `writeLifecycleLog` (same file/console sink `main.ts`
      already uses for the Cowork service's own lifecycle)
- [ ] On error: dedicated error dialog — NOT done; error is logged (see above) but no
      `dialog.showErrorBox` is shown. M365KG is additive and degrades silently rather than
      interrupting the user; a dialog was judged unnecessary for a background/optional feature.

**Acceptance criteria:**
- [~] First launch: user sees a message that the app is initializing — in the lifecycle log, not
      the main window (see deviation above)
- [x] Second launch: normal startup (no re-init) — `isInitialized()` short-circuits `initialize()`
- [x] Code review: `void m365kgStackLaunch.start()` in `main.ts`'s `prepare()` is fire-and-forget
      (never awaited), so provisioning/init cannot block the main window's creation.

---

### T2.3 — Test packaged build startup

**Manual verification (not automated code, but a verification checklist):**
- [ ] Build: produces a runnable Windows `.exe` — blocked by T2.1's pre-existing sandbox packaging
      limitation (see above); never reached this step.
- [ ] First run on Windows machine — **NOT EXECUTED**: no Windows OS, no Wine, in this sandbox.
- [ ] Second run (relaunch) — **NOT EXECUTED**, same reason.
- [ ] Cleanup test: `clean.bat` removes provisioned stack — **NOT EXECUTED**, same reason. (No
      change was made to `clean.bat`'s allowlist in this session; `<userData>/m365kg-stack/` and
      `.runtime/m365kg-*` would need a follow-up check against that allowlist before GA.)

**Acceptance criteria:**
- [ ] First-run init completes without errors — **UNVERIFIED** (no real Windows run)
- [ ] Second run is fast (no re-provisioning) — **UNVERIFIED** (logic is unit-tested; not
      execution-verified against a real packaged binary)
- [ ] No orphaned processes after app close — **UNVERIFIED**; the `stop()` composition in
      `main.ts` is code-reviewed and its contract is unit-tested (`m365kg-stack-launch.test.ts`),
      but not exercised against a real child process.

**Result: PARTIAL.** See `docs/product/current-status.md`'s ADR 0010 Phase 4 section for the full,
itemized disclosure of what is and is not verified, and why.

---

## Phase 3: Documentation & Verification

### T3.1 — Update E2E_TESTING_GUIDE.md

**Files to modify:**
- `E2E_TESTING_GUIDE.md`

**Changes:**
- [~] Prerequisites section: **NOT removed** — deliberate deviation. That section documents
      installing Postgres/Neo4j on a DEV/CI machine for `scripts/system-test/run.sh`
      (REQ-205 Phase 3 system-testing), a genuinely different stack from the packaged desktop
      app's own bundled one; removing it would break real, still-needed guidance. Instead, a new
      section explicitly disambiguates the two (see below).
- [x] Added new "First Launch (packaged desktop app) vs. this guide's system-test environment"
      section:
  - [x] "On first app launch, M365KG stack is provisioned and initialized automatically."
  - [x] "This takes roughly 30–60 seconds on first run; subsequent launches are fast" (via the
        `.runtime/m365kg-init.done` marker)
- [x] Testing flow (T3.1–T3.4 in that guide): unaffected/unchanged — those describe the DEV/CI
      system-test scenarios (`m365kg-integration.test.ts`), which remain accurate as-is; the new
      section makes explicit that they are a *different* stack from the bundled one.
- [x] Kept system-test instructions as-is (`scripts/system-test/run.sh` still valid for dev/CI
      testing) — required by this task's own instructions, honored.

**Acceptance criteria:**
- [x] Document is accurate to the new bundled behavior (for the packaged app) while the
      system-test section remains accurate for its own (different) purpose
- [~] "No stale references to 'start postgres manually'" — the system-test Prerequisites section
      still instructs installing Postgres/Neo4j, by design (see deviation above); no reference to
      manually starting Postgres/Neo4j for the *packaged app* exists or ever did.
- [x] Code review: clarity/completeness — self-reviewed for internal consistency between the new
      section and the rest of the (unmodified) guide.

---

### T3.2 — Update current-status.md & tasks.md

**Files to modify:**
- `docs/product/current-status.md`
- `specs/REQ-205-COWORK-001-m365-cowork-integration/tasks.md`

**Changes:**
- [x] In `current-status.md`: added new section "ADR 0010 Phase 4: Stack Init & Packaging (this
      session, 2026-07-13)"
  - [x] Lists `M365KGStackInitializer`, the 3 new `app/shell` modules, `electron-builder.yml`
        updates, and the T2.2 first-launch-feedback deviation
  - [x] Notes the packaged-build first-run init step (~30–60s) and its verification status
- [x] In REQ-205 `tasks.md`: Phase 3 note updated with "ADR 0010 bundling: DONE (init + packaging
      wired)", cross-linked to `current-status.md`

**Acceptance criteria:**
- [x] Status doc is up-to-date and accurate (includes the sandbox limitations honestly, per this
      project's own established documentation convention)
- [x] No dangling references to "external stack" — D2 reversal to D2' was already recorded in
      `spec.md` in a prior session; this session's additions are consistent with D2'
- [x] Clear marker: "ADR 0010 bundling: DONE" present in both `current-status.md` and REQ-205
      `tasks.md` (init + packaging code is wired; real-Windows execution verification is the
      explicitly-flagged remaining gap — see T2.3/T3.3)

---

### T3.3 — Smoke test: packaged startup

**Execution:**
- [ ] On Windows machine with no pre-existing M365KG stack — **NOT EXECUTED, no Windows machine
      available in this session's environment** (a plain Debian sandbox; `npm run package:win`
      itself does not complete here — see T2.1/T2.3). Steps 1–8 below are therefore unverified:
  1. [ ] Run packaged `.exe` for the first time
  2. [ ] Observe: provisioning splash or message appears
  3. [ ] Wait for completion (~30–60s)
  4. [ ] Verify: app becomes responsive
  5. [ ] Query M365KG: `/health` or `/api/stats/overview` returns 200 OK
  6. [ ] Close app cleanly
  7. [ ] Reopen app: verifies init is skipped (second launch is fast)
  8. [x] Document result in `docs/product/current-status.md` with date — done (this entry, dated
        2026-07-13, records PARTIAL and why, in lieu of a tester-observed PASS/FAIL)

**Acceptance criteria:**
- [ ] First-run provisioning + init: **PARTIAL** — code implemented + unit-tested; not
      execution-verified against a real packaged Windows binary in this environment
- [ ] Second run (no re-init): **PARTIAL** — same reason
- [ ] No orphaned processes: **PARTIAL** — same reason
- [x] Result documented in current-status.md — recorded as PARTIAL with full rationale, dated
      2026-07-13, under "ADR 0010 Phase 4"

---

## Final Handoff Checklist

Before marking ADR 0010 bundling as COMPLETE:

- [x] T1.1: initializer module complete & type-checks
- [x] T1.2: unit tests pass (≥4 cases) — 8 cases
- [x] T1.3: wired into app startup, existing tests still pass
- [~] T2.1: electron-builder.yml updated; YAML valid; `npm run build:app` succeeds; the final
      `electron-builder --win` pack step fails — **confirmed pre-existing sandbox limitation**
- [~] T2.2: first-launch feedback shipped via the lifecycle log (checklist's own sanctioned
      "minimal" branch), not a splash window — deviation disclosed
- [ ] T2.3: packaged build tested on Windows — **NOT EXECUTED** (no Windows/Wine in this sandbox)
- [x] T3.1: E2E_TESTING_GUIDE.md updated
- [x] T3.2: current-status.md & tasks.md updated
- [x] T3.3: smoke test result documented — **PARTIAL**, with full rationale
- [ ] All files committed & PR ready for review — commits pending user confirmation of branch
      target (see Implementation Record)

**Overall: ADR 0010 bundling code is COMPLETE and unit-tested; Windows execution verification
(T2.1's pack step, T2.3, T3.3) is the one remaining, clearly-scoped gap, blocked on sandbox
platform access rather than missing implementation.**

---

## Notes

- **Open questions** from tasks.md: implementer should answer in code/comments during execution
- **License**: PostgreSQL + Neo4j terms still apply; see ADR 0010 for details
- **Backwards compatibility**: no changes to existing REQ-205 Phase 1–3 code; new init is additive
- **Timeline**: estimate 8–16 hours depending on backend migration discovery + Windows testing
