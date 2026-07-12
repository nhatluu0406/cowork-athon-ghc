# `.loop-engineer/` Manifest

Status: `MAINTENANCE_ONLY`

This directory is retained for historical provenance, evidence, and optional verification tooling.
It is not the default day-to-day product task system anymore.

## Active Sources Now

- Product status: `docs/product/current-status.md`
- Roadmap: `docs/product/productization-roadmap.md`
- Acceptance and limitations: `docs/quality/`
- Current architecture overview: `docs/architecture/system-overview.md`
- Active work state: Git history and current Git diff

## What This Directory Contains

| Path | Purpose |
|---|---|
| `state/project-state.yaml` | Historical machine state and L6 completion record. |
| `state/loops.yaml` | Historical loop records L0-L10. |
| `state/tasks.yaml` | Historical task records `CGHC-001` through `CGHC-028`. |
| `state/current-run.yaml` | Historical run record. |
| `evidence/` | Evidence for previous loop/task claims. Keep links intact. |
| `reports/` | Historical loop reports. |
| `checkpoints/` | Historical checkpoints. |
| `HANDOFF.md` | Maintenance-only handoff summary. |

## Allowed Use

```powershell
node tools/loop-engineer/cli.mjs verify
```

Use this to check that historical state still parses and evidence references remain consistent.

## Retired Use

Do not use `.loop-engineer` as the primary implementation queue unless explicitly requested.
Do not auto-run L7-L10. Do not delete or move evidence as part of this retirement.
