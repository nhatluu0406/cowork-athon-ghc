# L1 — Reference Source Delta (doc commit → checked-out HEAD)

Computed after deepening the shallow clone so the doc commit became reachable.

- Doc generated at: `00190e5020476478576ad21c66c1abc20d756677`
- Checked-out HEAD: `1897f9f38ee35338bdb99a993ea07c5c9cd9b827`
- Live `origin/dev` has since advanced to `bb24134` (informational; our checkout stays pinned at 1897f9f).
- Commits between doc and HEAD: **11**

## Files changed by area (00190e5..1897f9f)
| Area | Files changed | In Cowork GHC POC scope? |
|------|---------------|--------------------------|
| `ee/apps` (enterprise "Den" cloud) | 75 | No — OUT_OF_SCOPE (cloud gateway/control-plane is a later integration) |
| `evals` | 25 | No — OUT_OF_SCOPE |
| `ee/packages` | 8 | No — OUT_OF_SCOPE |
| `packages/docs` | 7 | No (docs) |
| `apps/app` (UI) | 5 | Yes — relevant, small churn |
| `apps/desktop` (Electron shell) | 4 | Yes — relevant, small churn |
| `apps/server` | 0 | Yes — **unchanged** |
| `apps/orchestrator` | 0 | Yes — **unchanged** |
| `scripts`, `pnpm-lock.yaml`, `packages/types` | 1 each | Minor |

## Structural claims (present at HEAD)
`apps/app`, `apps/desktop`, `apps/server`, `apps/orchestrator`, `ee`, `packages`, `.opencode` all present.

## Conclusion for L1 classification
The churn since the doc is overwhelmingly in the enterprise cloud (`ee/`) and `evals`,
which are OUT_OF_SCOPE for the Cowork GHC local-PC POC. The POC-relevant surface
(local server, orchestrator, desktop shell, UI) is stable. → Classification is
**VALID_WITH_GAPS** (structurally valid for POC use; gaps are commit-drift and
uncovered enterprise-area changes, both out of POC scope).
