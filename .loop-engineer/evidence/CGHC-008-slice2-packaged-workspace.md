# CGHC-008 — Slice 2 packaged workspace selection

Date: 2026-07-12  
Verifier: Agent Lead (LEAN)  
Build: `dist-app/win-unpacked/Cowork GHC.exe`

## Root causes fixed

1. **Settings persistence path**: `SETTINGS_FILE_PATH` was resolved at import time via `app.getPath("userData")` before `app.whenReady()`. Deferred path resolution through a `prepare` hook in shell lifecycle so packaged writes land under `%APPDATA%/cowork-ghc/.runtime/settings.json`.
2. **Packaged verification path**: verify script expected `%APPDATA%/Cowork GHC` (productName) but Electron userData follows `package.json` `name` (`cowork-ghc`).

## Packaged flow observed

1. Launch packaged app → settings-only service ready (`service_started` after authenticated health poll).
2. Click **Chọn thư mục workspace** (CDP automation with `COWORK_GHC_E2E_WORKSPACE_ROOT` fixture bypass for native dialog).
3. Workspace validated + granted via loopback service; UI shows **Đang hoạt động:** path.
4. `settings.json` persisted `activeWorkspace.rootPath` under `%APPDATA%/cowork-ghc/.runtime/`.
5. Relaunch without picker env → workspace restored and revalidated in GUI.
6. Change to second fixture workspace → persisted and shown active.
7. Root PID stop → no `Cowork GHC.exe` / `opencode.exe` orphans.

## Focused tests (20/20 PASS)

```text
node --import tsx --test app/ui/tests/workspace-picker.test.ts app/ui/tests/service-client.test.ts app/shell/tests/preload-bridge.test.ts app/shell/tests/lifecycle.test.ts
```

## Packaged verify command

```text
npm run package:win
node tools/verify/slice2-workspace-packaged.mjs
```

Result: **PASS**
