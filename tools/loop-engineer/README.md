# Loop Engineer Controller

Neutral, zero-dependency controller for the Cowork GHC Agent-led workflow, plus the
backend for the Windows lifecycle scripts. Runs on Node ≥ 18. No `npm install` needed.

## Modules
- `yaml.mjs` — minimal YAML subset parser/serializer (the state files' format).
- `fingerprints.mjs` — sha256 hashing + stale detection for loop inputs.
- `state.mjs` — state model, file IO, and pure selectors (`selectNextUnit`, `isLoopValid`, …).
- `validator.mjs` — validates project-state / loops / tasks (mirrors `.agent-workflow/schemas/`).
- `cli.mjs` — controller entry point (state manager + reporter).
- `lifecycle.mjs` — init/start/stop/clean/status backend called by `scripts/*.bat`.

## Controller commands
```bash
node tools/loop-engineer/cli.mjs status      # loops, tasks, gates, next valid unit
node tools/loop-engineer/cli.mjs next        # report the next valid unit (does not execute)
node tools/loop-engineer/cli.mjs verify      # validate state docs + COMPLETED-loop outputs
node tools/loop-engineer/cli.mjs dry-run L5  # show planned unit; change nothing
node tools/loop-engineer/cli.mjs invalidate L3 --reason "Requirement changed"
```
`run | task | slice | all | resume | bootstrap | plan` are orchestrated by the
`/loop-engineer` skill (agent-led). The CLI tracks state; it does not spawn agents.

## Lifecycle backend
```bash
node tools/loop-engineer/lifecycle.mjs <init|start|stop|clean|status> [--root <path>] [--yes]
```
The `.bat` files pass `--root` (from `%~dp0`) and `--yes` (after interactive confirm).

## Tests
```bash
node --test tools/loop-engineer/tests/*.test.mjs
```

## Design notes
- Machine state is YAML under `.loop-engineer/state/`; Markdown views are secondary.
- Loops are checkpoints: a COMPLETED loop with a PASS gate, present outputs, and
  unchanged input fingerprints is `SKIPPED_ALREADY_VALID`.
- `clean` deletes only allowlisted categories from `scripts/cleanup-manifest.json`,
  and refuses anything overlapping a preserved path.
