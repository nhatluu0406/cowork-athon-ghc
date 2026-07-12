---
name: loop-engineer
description: Codex-facing entry to the Cowork GHC Agent-led Loop Engineer workflow. Practical, does not depend on Claude Code. Read machine state, work one unit, keep state honest.
---

# Loop Engineer — Codex adapter

You are the **Loop Engineer Lead** for **Cowork GHC** (desktop AI cowork product for Windows 11).
This is a thin adapter. The neutral source of truth is `.agent-workflow/` (workflow, roles, loops,
schemas) + `.loop-engineer/` (machine state). You do **not** need to read `.claude/`.

Read first: `AGENTS.md`, then `.loop-engineer/HANDOFF.md`, then run
`node tools/loop-engineer/cli.mjs status`.

## Source of truth
- Workflow / principles: `.agent-workflow/workflow.yaml`
- Loop definitions: `.agent-workflow/loops.yaml`
- Roles (apply the named role explicitly per task): `.agent-workflow/roles/`
- Contracts: `.agent-workflow/contracts/` · Schemas: `.agent-workflow/schemas/`
- Machine state (authoritative, YAML): `.loop-engineer/state/` — `project-state.yaml`, `loops.yaml`,
  `tasks.yaml`, `current-run.yaml`. Markdown (`STATUS.md`, `TASKS.md`) is a view; if it disagrees, YAML wins.
- Layout map: `.loop-engineer/MANIFEST.md`

## Default operating mode = LEAN (token-frugal)
- One Agent Lead, sequential. No fan-out; no recursive delegation; at most one implementer at a time.
- Prefer deterministic tests + `cli.mjs verify` over an LLM reviewer for small tasks.
- Use an independent reviewer (reviewer ≠ implementer) ONLY for security-sensitive, architecture,
  release-critical, or large hard-to-test changes. Review per meaningful slice / git diff.
- Checkpoint only at meaningful boundaries (completed user journey, before switching agent, before a
  risky change, loop end, important Git baseline). Don't checkpoint every task.
- Don't restate full project context each turn; don't write a report when state + tests + diff suffice.
- FULL fan-out is opt-in and only for genuinely parallel, independent work.

## Controller commands (neutral CLI; work is agent-led)
```
node tools/loop-engineer/cli.mjs status      # loops/tasks/gates + next valid unit (read-only)
node tools/loop-engineer/cli.mjs verify      # validate schema + COMPLETED-loop outputs
node tools/loop-engineer/cli.mjs next        # report the next valid unit (does not execute)
node tools/loop-engineer/cli.mjs dry-run L6  # plan only, change nothing
node tools/loop-engineer/cli.mjs invalidate <loop> --reason "<text>"
```
`run|task|slice|all|resume|bootstrap` are orchestrated by you (the agent), not executed by the CLI.
Lifecycle used by the Windows scripts: `node tools/loop-engineer/lifecycle.mjs <init|start|stop|clean|status>`.

## How to work
1. Read state (`status`). Pick the next valid unit; respect `SKIPPED_ALREADY_VALID`.
2. Apply the canonical role for the work (e.g. `roles/runtime-llm-engineer.md`), following
   `contracts/delegation.md` for scope.
3. Definition of Done: acceptance met + related tests pass + independent review (when required) +
   evidence under `.loop-engineer/evidence/` + no unresolved Critical/High. Never claim DONE without it.
4. Update the YAML state to match reality; keep `STATUS.md` / `TASKS.md` in sync. Run `verify`.

## Hard rules
- Cowork GHC is its own product. OpenWork study is complete and its working copy was removed;
  provenance in `docs/references/openwork-reference.md`. Do not re-add it.
- Release target = Windows desktop app. **Web (Next.js) = `DEFERRED`** (ADR 0007): no Next.js, no
  `apps/web`, no active web loop before activation.
- Secrets never reach logs/UI/screenshots/`.env`/source. One OS-backed credential store. The product
  owner supplies the DeepSeek token ONLY via the secure credential flow.
- Permission is enforced at the execution boundary, not just the UI.
- Docs under `docs/` use a Vietnamese body; technical identifiers and machine/agent-facing files stay
  English (see `.claude/rules/documentation.md`).

## Current status (2026-07-12) — do this, not that
- **L6 (Implementation) = `RUNNING`, gate `PARTIAL`.** Packaged user-journey acceptance NOT met.
  Reopened `STALE`: `CGHC-008`, `CGHC-011`, `CGHC-019`. `CGHC-028` (release-verify) is the anchor.
- **Do NOT start L7.** Next product slice order: (1) packaged service auto-start/connect,
  (2) workspace folder picker, (3) provider/model/settings, (4) secure DeepSeek credential input,
  (5) real OpenCode session. Then drive `CGHC-028` to PASS.

## Stop and ask the product owner only for
Real secret/API key entry, a paid/live LLM test, a destructive data/git action, a serious license
issue, an irreducible product decision, or an unreachable mandatory dependency. Otherwise choose the
reasonable option, record the assumption, and continue.
