# Cowork GHC - Loop Engineer Status

Status: `MAINTENANCE_ONLY`

`.loop-engineer/` is retained for historical state, evidence, checkpoints, and optional verification.
It is no longer the primary product workflow.

Active status now lives in:

- `docs/product/current-status.md`
- `docs/product/productization-roadmap.md`
- `docs/quality/poc-acceptance.md`
- `docs/quality/known-limitations.md`

Current baseline:

- `HEAD`: `ead01e8` (`poc-v0.1`)
- L6: `COMPLETED`
- Gate: `PASS`
- Do not auto-start `L7`
- Web / Next.js: `DEFERRED`

Optional check:

```powershell
node tools/loop-engineer/cli.mjs verify
```
