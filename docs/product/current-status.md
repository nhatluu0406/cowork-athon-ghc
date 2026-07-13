---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# Current Status

Active product plan: [Cowork GHC Product Plan](./cowork-ghc-product-plan.md)

Do not use a moving `HEAD hiện tại` field here. Use the latest verified slice commits
and the current working tree instead.

## Latest Verified Slice

| Field | Value |
|---|---|
| Slice | File Work Review and Before/After Diff |
| Feature commit | `c81fbc4` — feat(files): add persistent before-after review |
| Implementation Agent | Cursor |
| Packaged journeys | `file-review-packaged.mjs` A–L — **PARTIAL** in this session (live agent file writes did not land on disk; `verify:release` PASS) |
| Regression | `npm run verify:release` PASS; `npm run package:win` PASS |
| Prior slices still PASS | Skills Foundation A–J; Provider Readiness A–J; Attachment Honesty A–J |

## Latest Verified Slice Commits (prior)

| Commit | Meaning |
|---|---|
| `1604761` | Skills packaged disable/deny recovery strengthened. |
| `97f53bf` | Skills Foundation feature. |
| `4f1e804` | Docs: provider readiness slice record. |
| `3cc4ba6` | Attachment honesty + secret-file safety. |

## Product State

Cowork GHC is a packaged Windows desktop POC (`poc-v0.1`). It is local-first,
workspace-centered, uses OpenCode as the current agent runtime, and supports a
replaceable LLM endpoint. DeepSeek is the current provider used for testing; it is not
a permanent product dependency.

Daily source of truth is Git plus active docs in `docs/product/`, `docs/quality/`,
`docs/architecture/`, and `AGENTS.md`. `.loop-engineer/` is maintenance-only provenance.

## Verified Baseline

- Local service lifecycle, workspace selection, provider/model settings, Windows keyring,
  OpenCode runtime, streaming, permissions, cancellation, provider recovery, and process
  cleanup have packaged POC evidence.
- Conversation persistence, multi-conversation sidebar, search, switch, rename/delete,
  relaunch restore, and linked multi-turn Cowork conversations have packaged/automated evidence.
- Context isolation is verified for new turns: bounded untrusted internal envelopes are not
  persisted or displayed as assistant output.
- Activity timeline, file-change panel, permission history, and bounded text file preview exist.
- **File Work Review**: service-owned bounded snapshot capture, deterministic unified diff,
  persisted review artifacts on conversation activity, attachment vs runtime-read separation,
  secret-like path redaction in review, hash-mismatch banner for stale historical snapshots,
  and activity-panel review surface (no universal Preview tab, no direct editor).
- Attachment Phase 1 plus honesty slice: workspace text files, dispatch preflight fail-fast,
  explicit inclusion metadata, secret-like filename blocking before read, activity wording
  `Đã đưa tệp vào ngữ cảnh`, and no raw attachment content in transcript.
- Provider readiness and Skills Foundation Phase 1 remain as previously verified.

## File Work Review Slice (this session)

### What shipped

- **Taxonomy**: `attachment_context`, `runtime_file_read`, `file_created`, `file_modified`,
  `file_deleted`, plus permission history outcomes; Vietnamese past-tense labels for terminal events.
- **Snapshots**: before/after capture at mutation time with SHA-256 hash, size, mtime, truncation flags.
- **Diff**: deterministic line-based unified diff with CRLF/LF normalization; binary metadata-only path.
- **Persistence**: `fileReviews` array on persisted activity snapshot survives relaunch.
- **Secret policy**: reuses `isSecretLikeAttachmentPath`; review shows
  `Nội dung bị ẩn vì file có thể chứa credential hoặc secret.` without raw content.
- **Skills**: file events inherit turn Skill provenance via existing turn metadata; Skills do not bypass permission.
- **UI**: activity right panel review (`Xem lại thay đổi`), copy relative path; open-file deferred.

### Limits (configured)

| Limit | Value |
|---|---|
| Max snapshot bytes | 64 KiB (`FILE_REVIEW_MAX_SNAPSHOT_BYTES`) |
| Max preview bytes | 64 KiB (`FILE_REVIEW_MAX_PREVIEW_BYTES`) |
| Max diff chars | 32 KiB (`FILE_REVIEW_MAX_DIFF_CHARS`) |
| Max diff lines per side | 500 (`FILE_REVIEW_MAX_DIFF_LINES`) |

### Verification

- `npm run verify:release` PASS (includes `service/tests/file-review.test.ts`, router test, activity-model updates).
- `npm run package:win` PASS.
- `node tools/verify/file-review-packaged.mjs` — harness added for journeys A–L; live-agent file-write
  steps did not complete in this verification environment (re-run in clean profile recommended).

Full L9 / release-candidate verification is **not** complete.

## Renderer Toolchain Slice (this session)

`app/ui` (the Cowork GHC renderer) now builds with React, executing the stack already named
in ADR 0008 §5 ("Electron + React", bundler/version choice deferred to the UI task) and the
`@cowork-ghc/ui` package description ("React/UI in later tasks"). This is a foundation slice
only — one representative module was converted end-to-end to prove the pattern; the remaining
~35 `app/ui/src` modules (including the `app-shell.ts` chat shell) are still vanilla
TypeScript/DOM and will convert one at a time in later slices.

### What shipped

- Toolchain: `react`/`react-dom` 19.2.7 (in `app/ui/package.json`), `@vitejs/plugin-react`
  ^4.7.0 + `@types/react`/`@types/react-dom` (root devDependencies, matching the
  `vite`/`typescript`/`electron` convention). Stayed on the monorepo's existing Vite 6 /
  TypeScript 5.7 pins rather than adopting newer majors.
- `app/ui/vite.config.ts` and `app/ui/tsconfig.json` updated for JSX (`react-jsx` runtime);
  all existing build invariants (`base: "./"`, `sourcemap: false`, loopback-only CSP) unchanged.
- Pilot conversion: `skills-panel.ts`'s `mountSkillsPanel` DOM builder replaced by a
  `SkillsPanel`/`SkillCard` React component (`app/ui/src/SkillsPanel.tsx`), with `skills-panel.ts`
  kept as a thin `createRoot`/`useImperativeHandle` shim so the existing call site in
  `app-shell.ts` needed no changes. Markup, classnames, and Vietnamese copy preserved 1:1.
- Tailwind/CVA/`cn()` and `@testing-library/react` deliberately deferred — not needed until a
  second component requires shared variant-driven styling.

### Verification

- `npm run typecheck` — no new errors (2 pre-existing errors in `knowledge-graph-view.ts` /
  `knowledge-settings.ts`, unrelated to this slice, confirmed present on the unmodified baseline).
- `app/ui` test suite (`npm test --workspace @cowork-ghc/ui`) — 185/188 runnable tests pass;
  the 3 failures are pre-existing, in `knowledge-e2e-timeout.test.ts` /
  `knowledge-e2e-unavailable.test.ts` (files untouched by this slice, confirmed via `git diff`
  against the baseline).
- `npm run build:renderer` — production Vite build succeeds, no sourcemaps emitted.
- `git diff --stat app/ui/src/app-shell.ts` — no changes (chat shell untouched).

## M365KG System-Test Environment (REQ-205 Phase 3, this session)

Added the environment/tooling for REQ-205's Phase 3 (Integration & E2E, `tasks.md` T3.1–T3.4),
previously blocked on "stack not running in this environment" (T0.4). New:

- `scripts/system-test/run.sh` — one command that starts the REAL M365KG stack with **no
  Docker anywhere**: real PostgreSQL (`initdb`/`pg_ctl`), real Neo4j (`neo4j`/`cypher-shell`),
  real Go backend, real Rust `llm-svc` — all built/run directly on the host — then runs backend
  `go test -tags=integration`, `llm-svc`'s `cargo test`, and the new
  `service/tests/knowledge/m365kg-integration.test.ts` (T3.1–T3.4) against it. The script does
  not install anything itself (no `apt-get`, no downloaded binaries) — it requires Postgres/Neo4j
  already installed and exits with clear instructions if not (see `E2E_TESTING_GUIDE.md`
  Prerequisites).
- `service/tests/knowledge/m365kg-integration.test.ts` — gated behind
  `M365KG_INTEGRATION_TESTS=1` (skipped, not failed, by default `npm test`). No fakes/mocks/proxy:
  T3.3/T3.4 send real `SIGTERM`/`SIGSTOP`/`SIGCONT` to the real backend process's PID.
- `.github/workflows/system-test.yml` — installs PostgreSQL (Ubuntu's own package) and Neo4j
  (Neo4j's own signed apt repo) on the runner, disables their systemd auto-start, then runs the
  same `scripts/system-test/run.sh` on changes under `app/backend/`, `app/llm-svc/`,
  `service/src/knowledge/`, `service/tests/knowledge/`.
- `E2E_TESTING_GUIDE.md` rewritten (v2.1) to match current paths/ports and the Docker-free setup
  (v1.0 referenced the removed `Frontend/` app and stale `backend`/`llm-svc` paths; v2.0 still
  used `docker compose` for Postgres/Neo4j).
- Repaired `.github/workflows/test.yml` (was pointing at removed `src/Frontend`; now runs
  `app/ui`'s actual `typecheck`/`test` scripts). Deleted `.github/workflows/onnx-integration.yml`
  (tested a Go ONNX embedder subsystem that no longer exists — ONNX moved entirely into the Rust
  `llm-svc`, already covered by `cargo test`).
- `docker-compose.yml` (root) is untouched and still used by `app/backend`'s own pre-existing
  `scripts/smoke-test.sh`/integration tests (REQ-204, out of scope here) — only this new
  system-test environment stopped depending on it.

**Not yet independently confirmed PASS**: the authoring environment had neither Docker daemon
access nor PostgreSQL/Neo4j installed, so `scripts/system-test/run.sh` could not actually be
executed end-to-end here. `npx tsc --noEmit` and a plain `node --import tsx --test` pass on the
new test file (confirms it type-checks and skips cleanly with the flag unset) — that is NOT the
same as a real-stack PASS. Whoever runs this next with PostgreSQL + Neo4j + Go + Rust + Node
installed should record the result in `tasks.md`'s Phase 3 section and here.

## ⚠️ REQ-205 D2 Reversed: M365KG Stack Now Bundled, Not External (this session)

**Product Owner (DungPham) reversed D2** (2026-07-13, same day as the original sign-off) — Cowork
GHC will **bundle and self-provision** PostgreSQL + Neo4j + the Go backend + `llm-svc` as child
processes it manages, instead of requiring the user to run an external stack. Full rationale,
license review, and design: **`docs/architecture/decisions/0010-m365kg-stack-bundling.md`**
(source of truth) + `specs/REQ-205-COWORK-001-m365-cowork-integration/spec.md` D2'.

**Built and unit-tested this session** (no real Windows binary executed — see caveats):
- `service/src/runtime/generic-child-supervisor.ts` + `generic-runtime-state.ts` +
  `generic-readiness.ts` + `generic-lifecycle-wait.ts` + `generic-supervisor-errors.ts` — a
  role-agnostic single-child supervisor extracted from `OpencodeSupervisor`'s proven skeleton
  (ADR 0004), reused instead of writing 4 near-duplicate classes. Adds a Windows `taskkill /PID
  <pid> /T /F` force-kill path (ADR 0004's own prescribed, previously-unimplemented fallback) —
  relevant because Neo4j's `neo4j.bat console` spawns a `java.exe` child of its own.
- `service/src/knowledge/stack/provisioning.ts` — download+SHA-256-verify+extract, with a
  zip-slip defense (`assertExtractionConfined`, symlink-aware realpath check) that has direct
  test coverage (a fake malicious symlink is rejected).
- `service/src/knowledge/stack/sources.ts` — pinned/resolved download sources, **checked live
  against the real vendor endpoints while authoring this** (not guessed): Neo4j Community
  5.26.28 (`dist.neo4j.org` + live-fetched `.sha256` sibling), Temurin JRE 21 (Adoptium API,
  inline checksum), PostgreSQL 16.14 (EDB, confirmed-live URL — **no vendor checksum exists for
  this artifact**, disclosed as a real gap, not hidden).
- `service/src/knowledge/stack/stack-roles.ts` + `stack-supervisor.ts` — composes 4 supervisors
  (Postgres/Neo4j/llm-svc start concurrently; backend starts only once all three are ready; stop
  is the exact reverse; a partial-start failure stops the already-started siblings — no orphans).
- 23 new unit tests across the above (`service/tests/generic-child-supervisor.test.ts`,
  `service/tests/knowledge/stack-*.test.ts`), all passing; `npx tsc -b` clean (no new errors
  beyond the pre-existing 2 in `knowledge-graph-view.ts`/`knowledge-settings.ts`).

**NOT done / explicitly out of scope this session** (flagged, not silently skipped):
- **Zero execution against real Postgres/Neo4j/Windows** — the authoring sandbox has no Windows,
  no Postgres/Neo4j installed, and no ability to run `Expand-Archive`/`taskkill`/a `.bat` file.
  `stack-roles.ts`'s exact bin subpaths/CLI flags are a strong first draft from each project's
  documented Windows layout, not execution-verified.
- **Neo4j license is NOT confirmed** — research surfaced it may be AGPLv3 + additional
  commercial-use terms, not plain GPLv3 as an earlier draft of ADR 0010 assumed. **This blocks
  GA bundling** until someone reads the actual `LICENSE` file inside the 5.26.28 Windows zip and
  gets a legal/PO sign-off. See ADR 0010 Open Items.
- **electron-builder / packaging wiring not touched** — deliberately: editing
  `app/shell/electron-builder.yml` untested, with no way to verify the packaged build still
  works, risked breaking an already-working pipeline for no verified benefit. The ADR documents
  the first-run-download-vs-bundled-in-installer choice as an open item for whoever does this
  with real Windows packaging access.
- **One-time initialization** (Postgres `initdb`, Neo4j `neo4j-admin dbms set-initial-password`,
  running backend DB migrations against the bundled Postgres) is not yet implemented — the
  current modules assume an already-initialized cluster/database exists at the configured paths.
- No RAM/CPU benchmarking of the bundled JVM (Neo4j) on a representative end-user machine.

## ADR 0010 Phase 4: Stack Init & Packaging (this session, 2026-07-13)

Closes the two items the prior session flagged as NOT done above: one-time initialization, and
electron-builder/packaging wiring. Implemented from `specs/ADR-0010-BUNDLE/` (speckit-implementer).

**Built and unit-tested this session** (no real Postgres/Neo4j/Windows binary executed — same
caveat as the prior session; see below):

- `service/src/knowledge/stack/stack-initializer.ts` — `M365KGStackInitializer`. `isInitialized()`
  checks `.runtime/m365kg-init.done`; `initialize()` runs `initdb` (non-interactive, via a
  short-lived `--pwfile`, never a CLI arg), briefly starts the bundled Postgres (reusing
  `stack-roles.ts`'s `postgresRole` + the existing `GenericChildSupervisor`) to bootstrap the
  `m365kg` role+database and apply `app/backend/migrations/*.sql` (skipping `*.down.sql`, filename
  order) via `psql`, then sets the Neo4j initial password and applies the one `*.cypher` migration
  via `cypher-shell` the same way, then writes the marker LAST — so any failure leaves either no
  marker + a removed `pgDataDir` (clean retry) or a marker + a fully migrated cluster, never
  something in between. `service/src/knowledge/stack/stack-supervisor.ts`,
  `stack-roles.ts`, `provisioning.ts`, `sources.ts` — **untouched**, per this task's constraint.
  New `service/src/knowledge/stack/index.ts` barrel + a `./knowledge/stack` `package.json` export
  entry (mirroring the existing `./knowledge/types` entry) expose it to `app/shell`.
- `service/tests/knowledge/stack-initializer.test.ts` — 8 tests, all against fakes (an injectable
  `CommandRunner` for every shell-out, an injectable supervisor factory reusing
  `generic-supervisor-fakes.ts`'s `FakeGenericChild`): idempotent guard, `pgDataDir` auto-create,
  initdb-before-migrate-before-neo4j ordering, migration file selection (skip `*.down.sql`,
  filename order), SQL-escaping of the bootstrap password, two distinct mid-flight-failure/cleanup
  scenarios (no orphaned temp child, `pgDataDir` removed, no dangling marker), and absolute-path
  validation. `npx tsc -b` clean (service workspace).
- `app/shell/src/service/m365kg-stack-paths.ts` — run-mode-aware path resolver (packaged:
  `userData`/`resourcesPath`; dev: repo tree), mirroring `packaged-paths.ts`'s existing OpenCode
  resolver exactly.
- `app/shell/src/service/m365kg-stack-secrets.ts` — generates (CSPRNG) and persists the Postgres/
  Neo4j/JWT secrets once to a `0600` `.runtime/m365kg-secrets.json`, reusing them on every later
  launch (a fresh secret on relaunch would desync from the already-initialized cluster's real
  password). Internal service-to-service secrets, not a user-facing provider credential — does not
  go through the OS keyring, per the checklist's own suggested resolution for this open question.
- `app/shell/src/service/m365kg-stack-launch.ts` — orchestrates provisioning-check →
  (secrets →) init-if-needed → supervisor start, and the reverse on stop. `start()` **never
  rejects**: M365KG is an additive feature, and a failure here (including "stack not provisioned
  yet" — the download step itself is a separate, not-yet-wired piece, out of this task's scope)
  must never block or crash the primary Cowork/OpenCode chat experience.
- `app/shell/src/main.ts` — wired non-blockingly in `prepare()` (never delays the main window);
  `stop()` is composed into the existing `runShellLifecycle` quit path so the bundled child
  processes are torn down on quit alongside the Cowork service, with **no changes to
  `lifecycle.ts`/`service-controller.ts`** (existing, already-tested files). 18 new unit tests
  across the 3 new shell modules; `npx tsc -b` clean (shell workspace);
  `app/shell/tests/main-bundle.test.ts` (asserts the packaged CJS bundle inlines every
  `@cowork-ghc/*` import) still passes unchanged against the new imports.
- `app/shell/electron-builder.yml` — adds `app/backend/migrations` as `extraResources` →
  `m365kg-migrations` (small SQL/Cypher text this app ships itself, read by the initializer in a
  packaged build; NOT the downloaded Postgres/Neo4j/JRE/llm-svc/backend binaries themselves, which
  stay "download at first run" per the ADR's own open item — documented in a new header comment).
  YAML validated (`js-yaml` parse). `npm run build:app` succeeds.
- `E2E_TESTING_GUIDE.md` — new "First Launch (packaged desktop app) vs. this guide's system-test
  environment" section, since the rest of that guide (manually-installed Postgres/Neo4j,
  `scripts/system-test/run.sh`) is for a DEV/CI test machine and is a **different stack** from the
  packaged app's own bundled/self-provisioned one — this was clarified rather than removing the
  system-test Prerequisites (still correct for its own purpose).
- `specs/REQ-205-COWORK-001-m365-cowork-integration/tasks.md` — Phase 3 note updated: "ADR 0010
  bundling: DONE (init + packaging wired)", cross-linked to this section.

**Verification performed**:
- `npx tsc -b` — clean in both `service/` and `app/shell/` (no new errors).
- `service/tests/knowledge/stack-initializer.test.ts` — 8/8 pass.
- `app/shell/tests/m365kg-stack-{paths,secrets,launch}.test.ts` — 12/12 pass.
- `app/shell/tests/main-bundle.test.ts`, `lifecycle.test.ts`, `service-controller.test.ts` — all
  still pass (packaging-bundle invariant + quit-path contract unaffected).
- `npm run build:app` (renderer + shell) — succeeds.
- Full `service` + `app/shell` regression suites were attempted but NOT fully clean in this
  sandbox for reasons **confirmed pre-existing and unrelated to this change** (verified via
  `git stash` against the unmodified baseline): 3 test files
  (`compose-live-wiring.test.ts`, `live-launch.test.ts`, `session-live-run-e2e.test.ts`) hang
  indefinitely in this environment, and ~22 tests in unrelated files (e.g.
  `workspace-attachment-read.test.ts`, `session-stream-hub.test.ts`) fail identically with or
  without this session's diff applied — a sandbox/environment characteristic (e.g. path/realpath
  handling), not a regression introduced here. Not investigated further — out of this task's scope.

**NOT done / explicitly out of scope this session** (flagged, not silently skipped):
- **`npm run package:win` (`electron-builder --win`) fails in THIS sandbox** with `Application
  entry file "app\shell\dist\main.cjs" ... does not exist` — an electron-builder sanity check that
  compares the Windows-style (`\`) main-entry path against the asar's stored (`/`) paths, tripped
  specifically by cross-building a Windows target from this Linux host (no Windows/Wine here).
  **Confirmed pre-existing**: reproduces identically on the unmodified baseline (same error, same
  stack trace, before any file in this session's diff existed). Earlier "`npm run package:win`
  PASS" notes in this document were evidently recorded in a different (Windows/WSL-backed)
  session environment, not this one. `npm run build:app` (the pre-packaging build) and the YAML
  validation both succeed here; only the final `electron-builder --win` pack step is blocked by
  this host.
- **The provisioning download step is still not wired to `m365kg-stack-launch.ts`** —
  `provisioning.ts`'s download+extract flow (a separate, larger piece: network calls, a progress
  UI, retry policy) is out of this task's declared non-scope. `createM365KGStackLaunch`'s default
  `isProvisioned` check will therefore see an empty `stackRoot` on every real run today and log
  `m365kg_stack_skip_not_provisioned` — the M365KG feature stays dormant (safely, not crashing)
  until that follow-up piece exists and actually populates `<userData>/m365kg-stack/`.
- **T2.2 first-launch UI feedback is the checklist's own explicitly-sanctioned "minimal" branch**:
  structured lifecycle-log lines only (visible via `View > Toggle Developer Tools`, same channel
  the Cowork service already uses), not a dedicated splash window or renderer-visible progress
  bar — deliberate, to avoid a much larger, unrequested renderer/IPC surface for an additive
  feature. A follow-up could route this through `getBootstrap()` if the PO wants an in-window
  indicator later.
- **T2.3 / T3.3 packaged first-run + second-run smoke test — NOT EXECUTED.** This sandbox has no
  Windows OS, no Wine, and (per the item above) cannot even complete the Windows packaging step
  itself; a real Postgres/Neo4j/Go/Rust Windows binary was never run. **Result: PARTIAL** — every
  layer up to (and not including) an actual packaged Windows launch is implemented and unit-tested;
  the manual "run the `.exe`, watch first-launch provisioning, verify `/health`, relaunch, verify
  fast second launch" checklist items in `specs/ADR-0010-BUNDLE/IMPLEMENTATION_CHECKLIST.md` T2.3/
  T3.3 are unverified and need a real Windows machine (or a WSL/Windows-backed environment,
  matching this project's own established pattern for exactly this class of verification gap).
- Neo4j license confirmation (flagged in the prior session) remains open — unchanged by this
  session's work.

## Next Implementation Slice

Next Agent: Cursor.

Recommended next slice after File Work Review packaged PASS:

```text
Minimal Workspace Navigator
```

Do not start the next slice until Product Owner issues its brief.

## Useful Verification Commands

```powershell
npm run verify:release
npm run package:win
node tools/verify/file-review-packaged.mjs
node tools/verify/skills-foundation-packaged.mjs
node tools/verify/attachment-honesty-packaged.mjs
node tools/verify/provider-readiness-packaged.mjs
```

```bash
# REQ-205 Phase 3 — real M365KG stack system test (requires Docker, Go, Rust, Node)
./scripts/system-test/run.sh
```
