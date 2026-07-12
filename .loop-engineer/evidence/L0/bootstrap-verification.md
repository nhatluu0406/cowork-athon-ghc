# L0 Bootstrap — Verification Evidence

Date: 2026-07-10 · Run: RUN-0001 · Result: **PASS**

## Environment
- OS: Windows 11 Pro (10.0.26200). Not a git repository (no history at risk).
- Toolchain: node v24.15.0, npm 11.17.0, python 3.11.8, cargo 1.96.1, git 2.52.0.
- Reference source cloned to `.loop-engineer/source/openwork/` (branch `dev`, HEAD
  `1897f9f38ee35338bdb99a993ea07c5c9cd9b827`). Analysis doc generated at `00190e5`
  (HEAD ≠ doc commit → L1 delta required).

## Gate checks
| Check | Result | How verified |
|-------|--------|--------------|
| Required files exist | PASS | `verify-l0.mjs` [1]: 37 required paths present |
| Canonical roles (10) + agent adapters (9) | PASS | `verify-l0.mjs` [2]: all present; adapters have `name`+`description` frontmatter |
| JSON valid (schemas, manifest, settings, package) | PASS | `verify-l0.mjs` [3]: all parse |
| YAML valid (workflow, loops, state) | PASS | `verify-l0.mjs` [4]: all parse via controller yaml module |
| Controller runs | PASS | `cli.mjs status` and `cli.mjs verify` → verify: PASS (exit 0) |
| Controller unit tests | PASS | `node --test tools/loop-engineer/tests/*.test.mjs` → 34 pass / 0 fail |
| Four .bat exist | PASS | init/start/stop/clean present in `scripts/` |
| .bat self-locate project root (CWD-independent) | PASS | `stop.bat` run from `C:\...\Temp` printed correct root; exit 0 |
| .bat honest exit codes | PASS | init=0, start=3 (NOT_READY), stop=0, clean cancel=0, clean --yes=0, missing-node=9 |
| start/stop no fake success | PASS | `start` reports NOT_READY (exit 3) — runtime not built yet |
| No unsafe overwrite of existing files | PASS | `.claude/settings.json` and existing skills untouched |
| No reference-source edits | PASS | openwork HEAD unchanged (`1897f9f`) after full run |
| clean preserves protected paths | PASS | after `clean.bat --yes`: source, docs, .git, .agent-workflow, .claude, .loop-engineer state/evidence, reference source, CLAUDE.md, AGENTS.md, tools, scripts all intact |
| cleanup-manifest safety invariant | PASS | `verify-l0.mjs` [5]: no cleanable path overlaps a preserved path |

## Commands (reproduce)
```bash
node --test tools/loop-engineer/tests/*.test.mjs      # 34 pass
node tools/loop-engineer/cli.mjs status
node tools/loop-engineer/cli.mjs verify               # verify: PASS
node tools/loop-engineer/lifecycle.mjs start          # exit 3 (NOT_READY, honest)
```

## Scope note
L0 is scaffold only — no Cowork GHC feature code was written. The application runtime,
UI, and providers are designed and built in later loops (L3+). `start.bat` therefore
honestly reports NOT_READY rather than faking success.
