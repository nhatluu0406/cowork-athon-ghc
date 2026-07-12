# CGHC-028 Slice 1 packaged service lifecycle evidence

Date: 2026-07-12
Scope: Packaged `win-unpacked` baseline and Slice 1 service-lifecycle fix.

## Root Cause Found

- The current shell environment had `ELECTRON_RUN_AS_NODE=1`, causing Electron executables launched from scripts/Codex to run as Node and exit before Electron `app` APIs were available.
- The root package `main` path used forward slashes (`app/shell/dist/main.cjs`), while the Windows-built asar resolved the entry as `app\shell\dist\main.cjs`.
- The root manifest did not declare the build/test devDependencies used by scripts, so `npm install` could prune Electron/electron-builder/tsx/TypeScript/Vite from `node_modules`.
- The app lifecycle CLI still checked for stale `app/shell/dist/main.js` instead of the actual `main.cjs`.

## Changes Verified

- Root `package.json` now declares the build/test devDependencies and uses `app\shell\dist\main.cjs` as the packaged Electron entry.
- `tools/app/commands.mjs` now checks the `main.cjs` dev fallback and scrubs `ELECTRON_RUN_AS_NODE` from spawned Electron children.
- Packaged build produced:
  - `dist-app/win-unpacked/Cowork GHC.exe`
  - `dist-app/Cowork GHC-0.0.0-setup.exe`
  - `dist-app/Cowork GHC-0.0.0-portable.exe`
- Asar metadata verified `main: app\shell\dist\main.cjs`; `app\shell\dist\main.cjs` extracts successfully.

## Runtime Verification

- Launched rebuilt packaged `dist-app/win-unpacked/Cowork GHC.exe` with `ELECTRON_RUN_AS_NODE` removed.
- Result: packaged app stayed alive.
- Process tree: one owned Electron app process with renderer/utility child processes.
- Loopback listener: `127.0.0.1:11109`, owned by the packaged app main process.
- Public route probe:
  - `GET /health` returned 404, as expected.
  - `GET /v1/health` returned 401 without the per-launch token, proving the service boundary is token-guarded.
- OpenCode child: not started in this baseline because no workspace/provider/credential is configured; this is the intended settings-only onboarding service path.
- Cleanup: stopped the launched packaged app by PID; no `Cowork GHC.exe`, Electron, or OpenCode processes remained; the loopback listener was gone.

## Focused Tests

- `npm run typecheck`
- `node --import tsx --test app/shell/tests/main-bundle.test.ts app/shell/tests/preload-bundle.test.ts tools/app/tests/app-cli.test.ts`
- `npm run package:win` with repo-local Electron/electron-builder caches.

## Remaining Acceptance Gap

Slice 1 is only partially complete for the final POC: packaged app now boots and starts/connects to the onboarding loopback service, but the live service restart into OpenCode after workspace/provider/credential configuration is not yet verified through the packaged GUI. Do not mark `CGHC-028` or L6 complete.
