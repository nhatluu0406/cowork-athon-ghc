# Cowork GHC - Handoff

Updated: 2026-07-12 (reconciled with Git)

## Git anchor

- **HEAD:** `ff32d8087e54433a925d020075f5105c2f0f413e`
- **Slice 1:** `3856a84` — packaged service readiness + authenticated health verification
- **Slice 2:** `ff32d808` — packaged workspace picker, activation, persistence, relaunch restore, workspace switching
- Prior checkpoint referencing `bcffc9d`, unresolved service reachability, or partial workspace work is **superseded**.

## Current State

- Loop: `L6` Implementation = `RUNNING`
- Gate: `PARTIAL`
- Slice 1 packaged service lifecycle: **PASS**
- Slice 2 packaged workspace selection: **PASS** (`CGHC-008` **DONE**)
- Service reachability: **RESOLVED**
- Do not start `L7`
- Web remains `DEFERRED`
- No DeepSeek live request in packaged slices 1–2

## Verified (Packaged)

`dist-app/win-unpacked/Cowork GHC.exe`:

| Slice | Commit | Verified |
|---|---|---|
| Service lifecycle | `3856a84` | Settings-only service ready; authenticated health before `service_started`; clean PID stop |
| Workspace selection | `ff32d808` | Picker → grant → activate → persist → relaunch restore → workspace change |

Evidence:

- Slice 1: `.loop-engineer/evidence/CGHC-028-slice1-packaged-service-lifecycle.md`
- Slice 2: `.loop-engineer/evidence/CGHC-008-slice2-packaged-workspace.md`

## Still Unverified (Package)

- Provider/model settings UI (`CGHC-019`)
- Secure keyring credential entry (`CGHC-011`)
- DeepSeek test connection
- Live OpenCode session

## Precise Next Action

**Slice 3:** packaged provider/model settings + secure credential flow (`CGHC-011`, `CGHC-019`). No DeepSeek live calls until packaged GUI verified.
