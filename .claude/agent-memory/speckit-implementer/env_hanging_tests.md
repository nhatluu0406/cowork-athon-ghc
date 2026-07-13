---
name: env-hanging-tests
description: 3 service test files hang indefinitely in this sandbox, and ~22 more fail identically on the unmodified baseline — pre-existing, run targeted tests instead of the full glob
metadata:
  type: project
---

Running the full `service` workspace suite as one glob (`node --import tsx --test
"tests/**/*.test.ts"`, ~106 files) in this sandbox never completes: 3 files spawn a child
`node --import tsx <file>` process that never exits —

- `service/tests/compose-live-wiring.test.ts`
- `service/tests/live-launch.test.ts`
- `service/tests/session-live-run-e2e.test.ts`

These processes survive even after the parent `node --import tsx --test ...` runner is killed
(they don't share a process group with it in this shell setup) — killing the exact parent command
string is not enough; use `pkill -9 -f "node --import tsx"` to actually clear them, or they leak
across unrelated later Bash calls in the same session and consume CPU indefinitely.

Separately (unrelated to the hang), running the rest of the suite turns up ~22 test failures in
files like `workspace-attachment-read.test.ts` and `session-stream-hub.test.ts`. **Confirmed
pre-existing via `git stash`**: identical failures on the unmodified baseline, e.g.
`workspace-attachment-read.test.ts` fails the same 6/9 tests with or without a diff applied. Root
cause not investigated (likely a path/realpath handling difference specific to this container),
and out of scope to fix opportunistically.

**How to apply**: When validating a change to this repo's `service` workspace, do NOT run the full
`tests/**/*.test.ts` glob and expect a clean/complete result — it will hang. Instead: (1) run
`npx tsc -b` for full-package type coverage, (2) run the specific test file(s) for whatever you
changed, (3) run a few directly-adjacent files (e.g. everything under `tests/knowledge/` for
knowledge-module changes) to catch integration issues, and (4) if you need broader confidence, run
the full glob with an explicit exclude list for the 3 hanging files above, under a bounded
`timeout`. Confirmed 2026-07-13 during ADR 0010 stack-init/packaging implementation
(`specs/ADR-0010-BUNDLE/`). See [[env-packaging-limitation]].
