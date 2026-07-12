---
name: loop-engineer
description: Maintenance-only access to Cowork GHC historical Loop Engineer state and optional verification tooling.
---

# Loop Engineer Skill

Status: `MAINTENANCE_ONLY`.

The old high-token loop/task orchestration workflow is no longer the default way to develop Cowork GHC.
Active work now starts from `docs/product/current-status.md`, `docs/product/productization-roadmap.md`,
the relevant architecture or quality document, and the current Git diff.

Use this skill only when explicitly requested for `.loop-engineer` state, evidence, provenance, or
verification. Prefer `node tools/loop-engineer/cli.mjs verify` for maintenance checks. Do not start
`L7` automatically, and do not run the old `all`, `run`, `task`, or `slice` flow unless explicitly
requested. Web / Next.js remains `DEFERRED`.

Historical skill text below is retained for provenance.

You are the **Loop Engineer Lead** for Cowork GHC. This skill drives the Agent-led
workflow defined in `.agent-workflow/` with machine state in `.loop-engineer/state/`.
Always read state via the controller before acting:
`node tools/loop-engineer/cli.mjs status`.

## Prime directives
- Cowork GHC is its own product; OpenWork is research reference only (study complete; working copy
  removed — provenance in `docs/references/openwork-reference.md`). Do not re-add it as a dependency.
- Default operating mode is **LEAN** (see below): one Agent Lead, sequential, token-frugal.
- Loops are checkpoints/migrations, not periodic jobs. A COMPLETED loop whose gate
  PASSed, whose outputs exist, and whose input fingerprints are unchanged returns
  `SKIPPED_ALREADY_VALID`. Do not re-run without cause (see `.agent-workflow/loops.yaml`).
- Never claim DONE without acceptance + tests + independent review + evidence.
- Reviewer must differ from implementer. In FULL mode max 3 concurrent agents (4 at large budget).
- Current: L6 `COMPLETED`, gate `PASS`; packaged POC baseline is `poc-v0.1`. Loop Engineer is
  `MAINTENANCE_ONLY`; do not auto-start L7. Handoff: `.loop-engineer/HANDOFF.md`.
- Stop and ask the user only for: real secrets/keys, paid live tests, destructive
  data/git actions, serious license issues, irreducible product decisions, or an
  unreachable mandatory dependency. Otherwise choose, record the assumption, continue.

## Commands
```text
/loop-engineer                 # == status (never auto-runs next)
/loop-engineer status          # read-only: loops, tasks, blockers, gates, scripts, next valid command
/loop-engineer bootstrap       # run/repair L0 scaffold, then verify + checkpoint + stop
/loop-engineer plan            # show the plan / next units without executing
/loop-engineer next            # run exactly ONE next valid unit, then stop
/loop-engineer run L3          # run a loop selector: L3 | L3-L5 | L2,L4,L7
/loop-engineer task CGHC-042   # run one task through its full lifecycle
/loop-engineer slice VS-05     # run one vertical slice
/loop-engineer verify          # validate state + evidence against gates
/loop-engineer resume          # resume from the last checkpoint
/loop-engineer all             # run only READY/STALE/retryable-FAILED units; checkpoint each; stop on gate/blocker
/loop-engineer dry-run L5      # show planned units, agents, files, tests, cost, risks — change nothing
```

## Options (defaults in bold)
```text
--execution=**solo**|subagents|team   # LEAN default = solo; subagents/team = FULL mode (opt-in)
--parallel=**1**|2|3|4                 # LEAN default = 1; up to 3 (4 at large budget) only in FULL mode
--budget=small|**normal**|large
--stop-after=<loop-id>
--stop-on=**gate**|failure|blocker|never
--plan-only
--no-live-llm
--force-review
--force
```

## Command semantics
- **status** — read-only; changes no source. Show completed/stale/running loops,
  running/blocked tasks, blockers, gates, evidence, Windows-scripts status, and the
  next valid command(s).
- **next** — pick one unit in this order: IN_PROGRESS task → VERIFY task → REVIEW
  task → READY task with satisfied deps → READY loop. Skip COMPLETED-and-valid. Do
  not chain to the following unit afterward.
- **run** — only the requested selector. First check prerequisites, fingerprints,
  git, gate, agents, and mutable files. If already COMPLETED+valid: `SKIPPED_ALREADY_VALID`.
- **all** — only READY/STALE/retryable-FAILED/unfinished; never re-runs valid
  COMPLETED/DONE. Checkpoint after each loop; stop at blocker/gate-fail/secret-needed/
  destructive-op/unpermitted-live-LLM; resume from checkpoint; bounded retry; never loops forever.
- **dry-run** — change nothing; show planned loops/tasks, agents, mutable files,
  tests, cost, risks, and stop conditions.

## Operating mode — LEAN is default
Default is **LEAN** (`.agent-workflow/workflow.yaml` → `operating_mode`), token-frugal:
- One Agent Lead, sequential. No fan-out by default; at most one implementer at a time.
- Do NOT spawn an LLM reviewer for small tasks — prefer deterministic tests + `cli.mjs verify`.
- Independent reviewer ONLY for: security-sensitive, architecture, release-critical, or large
  hard-to-test changes. Review per meaningful slice / git diff, not per tiny task.
- Checkpoint only at meaningful boundaries (completed user journey, before switching agent, before a
  risky change, loop end, important Git baseline) — not after every task.
- Don't repeat full project context each prompt; don't write a report when state + tests + diff suffice.

FULL mode (subagent fan-out) is opt-in for genuinely parallel, independent work.

## Execution modes
- **solo** (LEAN default) — sequential; one Agent Lead; few files.
- **subagents** (FULL, opt-in) — independent context and/or independent reviewer; parallel
  independent tasks (max 3 concurrent; 4 at large budget).
- **team** — only with ≥2 independent workstreams, direct agent-to-agent need, no file
  conflicts, platform support, and accepted token cost. Otherwise fall back to
  subagents/worktrees.

## Bootstrap-if-needed (bare prompt behavior)
If the Loop Engineer infrastructure is missing/invalid: run L0, verify, mark
`L0=COMPLETED` on gate pass, checkpoint, then STOP. Do not auto-run L1+. If L0 is
already complete and valid: return `SKIPPED_ALREADY_VALID`, show status, stop.
