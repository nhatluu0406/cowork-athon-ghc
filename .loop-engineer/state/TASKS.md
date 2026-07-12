# Cowork GHC - Tasks

> Human view synchronized from `.loop-engineer/state/tasks.yaml` on 2026-07-12.
> `tasks.yaml` remains canonical.

## Summary

- `DONE`: 24
- `STALE`: 3
- `IN_PROGRESS`: 1
- Newly completed in this checkpoint: none

## Active / Reopened Tasks

| ID | Capability | Status | Current note |
|---|---|---|---|
| `CGHC-008` | workspace-picker-validate | `STALE` | Packaged service reachability is resolved. Uncommitted renderer work persists `settings.activeWorkspace` after grant; packaged native folder-picker click-through remains unverified. |
| `CGHC-011` | add-credential-test-connection | `STALE` | Service connector evidence remains valid. Packaged secure credential entry and DeepSeek test connection remain unverified. |
| `CGHC-019` | model-config-switch | `STALE` | Backend/model-switch evidence remains valid. Packaged provider/model settings UI remains unverified. |
| `CGHC-028` | release-verification | `IN_PROGRESS` | Packaged settings-only service reachability verified (`/v1/health` 401 without token; authenticated health polled before `service_started`). Full packaged POC journey still unverified. |

## Done Tasks

`CGHC-001`, `CGHC-002`, `CGHC-003`, `CGHC-004`, `CGHC-005`, `CGHC-006`, `CGHC-007`, `CGHC-009`, `CGHC-010`, `CGHC-012`, `CGHC-013`, `CGHC-014`, `CGHC-015`, `CGHC-016`, `CGHC-017`, `CGHC-018`, `CGHC-020`, `CGHC-021`, `CGHC-022`, `CGHC-023`, `CGHC-024`, `CGHC-025`, `CGHC-026`, `CGHC-027`.

## Next Product Slice

Packaged workspace picker verification (`CGHC-008` re-verify). Do not proceed to provider/model settings, credentials, DeepSeek, or live OpenCode until that passes in `dist-app/win-unpacked/Cowork GHC.exe`.
