# CGHC-028 Slice 4 — Packaged OpenCode live session

Date: 2026-07-12  
Verifier: `node tools/verify/slice4-session-packaged.mjs`  
Target: `dist-app/win-unpacked/Cowork GHC.exe`

## Scope

One minimal packaged live session through the product GUI:

1. Settings-only boot (no OpenCode until explicit user action)
2. Workspace + provider/model restore from prior onboarding
3. `Bắt đầu phiên` → `connectLive` → pinned OpenCode **v1.17.11** spawn
4. Session create + prompt + streaming EV output
5. Safe workspace file action (`cghc-fixture.txt` with `CGHC_SLICE4_OK`)
6. Clean shutdown — no owned Cowork GHC / OpenCode orphans

## ENOENT root cause (historical)

Pre-bootstrap-fix automatic live boot resolved `binPath` to `app.asar/.../node_modules/opencode-ai/bin/opencode.exe` (missing in packaged layout) → spawn `ENOENT`. Current fix: packaged `binPath` from `resources/opencode/opencode.exe` via `resolvePackagedPaths`; boot is settings-only; live only on explicit `connectLive`.

## Runtime decision

**Bundle** pinned OpenCode **1.17.11** via electron-builder `extraResources` → `resources/opencode/opencode.exe`. No download at runtime; no PATH/global dependency.

## Live inference budget

- Provider connectivity (`/v1/models`): already PASS (Slice 3)
- OpenCode inference requests this slice: **2 successful** (PING stream + fixture file action)
- Retries: 0

## Result

**PASS** — streaming observed; fixture file verified on disk; lifecycle trace shows `live_ready`; no orphan processes after exit.
