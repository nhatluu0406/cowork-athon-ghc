# Cowork GHC — Project Instructions

Cowork GHC is a **desktop AI cowork product for Windows 11 local PC**. It is its own
product. OpenWork is a **research reference only** — never fork/clone/rebrand it.

## Release target & web scope

- The current release target is the **Windows desktop application** (local-first, packaged,
  stable runtime + workspace, complete UX). Finish desktop first.
- **Next.js / web application = `DEFERRED`** (see `docs/architecture/decisions/0007-web-application-deferral.md`).
  Do NOT install Next.js, do NOT create `apps/web`, do NOT add an active web loop, and do NOT build
  web-only auth/cloud/deployment/companion. Web activates only after the desktop POC reaches L9 `PASS`
  or on explicit product-owner request. Future web loops W0–W6 are a deferred proposal only, and must
  never make `/loop-engineer all` auto-run a web phase. The web epic is `CGHC-WEB-001` (backlog).

## Documentation language policy

- **Human-facing docs under `docs/` are written in Vietnamese** (product requirement, scope,
  acceptance, architecture, ADR, master plan, test strategy, security model, performance/integration
  plan, runbook, release checklist, verification report, retrospective). New `docs/` files use a
  Vietnamese body + Vietnamese headings; frontmatter carries `language: "vi"`.
- **Technical identifiers stay English**: file/folder names + slugs (kebab-case), frontmatter keys,
  enum values, Requirement/Task/Loop/ADR IDs, package/module/class/function/symbol names, API routes,
  event names, schema fields, commands, env vars, config keys, paths, tool/framework/product/protocol
  names. Do not hard-translate established technical terms when translation reduces clarity.
- **Machine/agent-facing files stay English** and are NOT translated: `CLAUDE.md`, `AGENTS.md`,
  `.agent-workflow/**`, `.claude/**`, `tools/loop-engineer/**`, `.loop-engineer/state/*.yaml`, JSON
  Schema, source/test/config. `STATUS.md`, `TASKS.md`, and product-owner reports use Vietnamese when
  it does not affect machine state; YAML/JSON remain the machine-readable source of truth.
- A translation with no semantic change is a `LANGUAGE_ONLY_CHANGE`: record old+new hash + reason,
  confirm Requirement/ADR IDs and acceptance meaning unchanged, attach review evidence. It must NOT
  auto-invalidate L1–L4. If translation surfaces a real ambiguity/conflict/meaning change, that is a
  semantic delta — invalidate only the genuinely-dependent loop, never the whole project.
- Full rule: `.claude/rules/documentation.md`. Do NOT mass-translate `docs/` in one pass or let it
  stall desktop work (task `CGHC-DOC-001`, planned in L5).

This file is short and stable. It is not the master plan and not a task tracker.
Machine state lives in `.loop-engineer/state/`. Loop/role definitions live in
`.agent-workflow/`. Read the full docs only when a task needs them.

## Source documents (read on demand, not by default)
- Research reference (OpenWork analysis): `docs/openwork-requirements-and-basic-design.md`
- Cowork GHC scope + acceptance (from L1): `docs/product/cowork-ghc-scope-and-acceptance.md`
- Cowork GHC implementation design (from L3): `docs/architecture/cowork-ghc-implementation-design.md`
- Canonical workflow / roles / loops: `.agent-workflow/`
- Reference source (read-only, never edited, never a build dependency): `.loop-engineer/source/openwork/`

## Architecture invariants
- UI is a client of a local application service bound to **loopback only**.
- Business logic is not in UI components; filesystem mutation goes through the
  execution/application boundary.
- **Permission is enforced at the execution boundary**, not just in the UI. Deny
  must actually prevent the action.
- One source of truth per state type. One session mechanism. One credential store.
- Provider abstraction is provider-neutral (no single-vendor lock-in).
- External integrations go through port/adapter seams.
- One owner/supervisor per child-process lifecycle; PID/port/runtime state is tracked
  consistently under `.runtime/`.

## Build / run / test commands
The app toolchain is chosen in L3 (Architecture). Until then, only the Loop Engineer
controller and lifecycle CLI exist:
- Controller status: `node tools/loop-engineer/cli.mjs status`
- Controller tests:  `node --test tools/loop-engineer/tests/*.test.mjs`
- Lifecycle (used by scripts): `node tools/loop-engineer/lifecycle.mjs <init|start|stop|clean|status>`

## Windows lifecycle scripts (double-click from Explorer)
- `scripts/init.bat`  — prepare local environment / dependencies (idempotent).
- `scripts/start.bat` — start Cowork GHC + local services.
- `scripts/stop.bat`  — stop only Cowork GHC processes gracefully.
- `scripts/clean.bat` — remove generated/downloaded data only (allowlist + confirm).
- See `scripts/README.md`. Each `.bat` self-locates project root via `%~dp0`, is a
  thin entry point that calls the neutral CLI, and returns honest exit codes.

## Coding rules (see `.claude/rules/`)
- Modular; no God services; no giant `utils`. Target < 250 lines/file; > 400 needs a
  reviewer-accepted reason. `.bat` files stay thin; complex logic goes to the CLI.
- TypeScript strict, avoid `any`, validate at network/IPC/process/persistence
  boundaries. Rust (if used): explicit errors, no panic on production paths.
- Never swallow errors; redact secrets before logging; no raw stack traces to users.

## Security invariants
- Secrets never appear in logs, errors, frontend state, or screenshots.
- No real API keys in browser local storage. Workspace boundary enforced; prevent
  path traversal. Audit important decisions locally.
- `clean.bat` must never delete source, `.git/`, docs, `.agent-workflow/`, `.claude/`,
  `.loop-engineer/state|checkpoints`, reference source, user workspace, or credentials.

## Git safety
- This project may not be a git repo yet — check before assuming. Never rewrite git
  history destructively. Never modify the reference source under `.loop-engineer/source/`.

## Definition of Done
A unit is DONE only when: acceptance met, related tests pass, independent review
complete (reviewer ≠ implementer), evidence exists under `.loop-engineer/evidence/`,
and no unresolved Critical/High findings. **Never claim completion without verification.**

## Orchestration — the `/loop-engineer` skill
This file is a thin adapter. The neutral source of truth is `.agent-workflow/` (workflow, roles,
loops, schemas) + `.loop-engineer/` (machine state). Handoff brief: `.loop-engineer/HANDOFF.md`.
Use `/loop-engineer` (see `.claude/skills/loop-engineer/SKILL.md`) to drive work.
- `/loop-engineer` alone == `status` (never auto-runs `next`).
- Loops are checkpoints, not periodic jobs: a COMPLETED+PASS loop with unchanged
  inputs returns `SKIPPED_ALREADY_VALID`.
- Bare bootstrap prompt == bootstrap-if-needed → verify → checkpoint → stop. It does
  not auto-run L1+.
- **Default operating mode is `LEAN`** (`.agent-workflow/workflow.yaml` → `operating_mode`): one Agent
  Lead, sequential, token-frugal; independent review only for security/architecture/release-critical/
  hard-to-test changes; review per slice/diff; checkpoint only at meaningful boundaries. FULL subagent
  fan-out (max 3 concurrent; 4 at large budget) is opt-in for genuinely parallel work.
- Reviewer must always differ from implementer.
- **Current: L6 `RUNNING`, gate `PARTIAL`; packaged acceptance NOT met; do NOT start L7.**
