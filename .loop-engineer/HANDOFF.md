# Cowork GHC - Handoff

Updated: 2026-07-12

## Current State

- Loop: `L6` Implementation = `RUNNING`
- Gate: `PARTIAL`
- Slice 2 (packaged workspace selection): **DONE** (`CGHC-008`)
- Do not start `L7`
- Web remains `DEFERRED`

## Root Causes Fixed (Slice 2)

1. **Settings not on disk**: `SETTINGS_FILE_PATH` used `app.getPath("userData")` at import time. Fixed by deferring `resolvePackagedPaths` to a `prepare` hook after `app.whenReady()` in shell lifecycle.
2. **False verify failure**: packaged verify looked for `%APPDATA%/Cowork GHC` but Electron userData is `%APPDATA%/cowork-ghc` (package `name`).

## Verified (Packaged)

`dist-app/win-unpacked/Cowork GHC.exe`:

- Service ready → workspace picker → grant + activate → persist `settings.json`
- Relaunch restores and revalidates workspace
- Change to second workspace persists
- Clean stop (no Cowork/OpenCode orphans)

Evidence: `.loop-engineer/evidence/CGHC-008-slice2-packaged-workspace.md`

## Still Unverified (Package)

- Provider/model settings UI
- Secure keyring credential entry
- DeepSeek test connection
- Live OpenCode session

## Precise Next Action

Slice 3: packaged provider/model settings + secure credential flow (`CGHC-011`, `CGHC-019`). No DeepSeek live calls until packaged GUI verified.
