# Cowork GHC - Loop Engineer Handoff

Updated: 2026-07-12

Status: `MAINTENANCE_ONLY`

## Meaning

`.loop-engineer/` now contains historical state, evidence, checkpoints, and optional verification
tooling. It is no longer the primary day-to-day product orchestration system.

Active project status and roadmap now live in:

- `docs/product/current-status.md`
- `docs/product/productization-roadmap.md`
- `docs/quality/poc-acceptance.md`
- `docs/quality/known-limitations.md`
- `docs/architecture/system-overview.md`

The canonical source for active work is Git plus those lightweight product documents.

## Current Baseline

- Current HEAD at retirement: `ead01e8` (`poc-v0.1`)
- Packaged acceptance commit: `8df3d59`
- Core packaged live-session tag: `poc-core-v0.1` at `c96b5b8`
- L6 Implementation: `COMPLETED`
- Gate: `PASS`
- `CGHC-028`: `DONE`
- Web: `DEFERRED`
- Do not auto-start `L7`

## What Remains Useful Here

- Historical evidence under `.loop-engineer/evidence/`
- Loop/task provenance under `.loop-engineer/state/`
- Optional consistency check:

```powershell
node tools/loop-engineer/cli.mjs verify
```

Future implementation agents do not need to read all evidence by default. Read evidence only when
auditing a previous claim or preparing a release-critical verification.

## Retired Behavior

- Do not run the old high-token `all`, `run`, `task`, or `slice` workflow unless explicitly requested.
- L7-L10 are not automatically executed through the old Loop Engineer workflow.
- Do not move or delete evidence files just to tidy the archive; existing links should keep working.

## Next Product Work

Next slice: `Release Gap Hardening`

Scope:

- Verify invalid credential recovery.
- Verify invalid model recovery.
- Verify invalid base URL recovery.
- Verify `start.bat` and `clean.bat` through Explorer-style invocation.
- Consolidate one non-live release regression command where practical.

After that: `Session Management and Resume`.
