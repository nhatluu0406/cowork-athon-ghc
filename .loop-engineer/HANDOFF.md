# Cowork GHC - Handoff

Updated: 2026-07-12 (Slice 3 packaged PASS)

## Git anchor

- **HEAD:** `e99c3b1`
- **Slice 1:** `3856a84` — packaged service readiness + authenticated health verification
- **Slice 2:** `ff32d808` — packaged workspace picker, activation, persistence, relaunch restore, workspace switching
- **Slice 3:** `e99c3b1` — packaged provider/model settings + Windows keyring credential + bounded DeepSeek test connection
- Prior checkpoint referencing partial provider/credential work is **superseded**.

## Current State

- Loop: `L6` Implementation = `RUNNING`
- Gate: `PARTIAL`
- Slice 1 packaged service lifecycle: **PASS**
- Slice 2 packaged workspace selection: **PASS** (`CGHC-008` **DONE**)
- Slice 3 packaged provider/credential: **PASS** (`CGHC-011`, `CGHC-019` **DONE**)
- Service reachability: **RESOLVED**
- Do not start `L7`
- Web remains `DEFERRED`
- OpenCode live session: **not started**

## Verified (Packaged)

`dist-app/win-unpacked/Cowork GHC.exe`:

| Slice | Scope | Verified |
|---|---|---|
| Service lifecycle | `3856a84` | Settings-only service ready; authenticated health before `service_started`; clean PID stop |
| Workspace selection | `ff32d808` | Picker → grant → activate → persist → relaunch restore → workspace change |
| Provider + credential | Slice 3 commit | DeepSeek preset, model persist, keyring store, test connection, relaunch restore without `.env` |

Evidence:

- Slice 1: `.loop-engineer/evidence/CGHC-028-slice1-packaged-service-lifecycle.md`
- Slice 2: `.loop-engineer/evidence/CGHC-008-slice2-packaged-workspace.md`
- Slice 3: `.loop-engineer/evidence/CGHC-011-slice3-packaged-provider-credential.md`

## Still Unverified (Package)

- Live OpenCode session + streaming + permission/file-on-disk journey
- Full stop/resume/clean packaged acceptance (L9)

## Precise Next Action

**Slice 4:** OpenCode live session integration (bounded). Do **not** start L7 until full packaged POC journey is met.
