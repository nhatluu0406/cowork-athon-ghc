# Automated packaged UI capture (ER-013)

Drives the **packaged** `coworkghc.exe` over the Chrome DevTools Protocol and screenshots every
reachable surface/state, then stops the app and asserts no orphan process. This is the evidence base
for [`docs/quality/ui-ux-audit.md`](../../docs/quality/ui-ux-audit.md).

```bash
npm run package:win     # produce dist-app\win-unpacked\coworkghc.exe (ER-001) — prerequisite
npm run audit:ui        # launch it, capture, tear down
```

## How it works

Capture runs **in-process** inside the packaged shell, gated OFF by default and activated only when
`COWORK_GHC_UI_AUDIT=1` (`app/shell/src/audit/ui-capture.ts`). CDP-over-debug-port was tried first
but this Electron build rejects `--remote-debugging-port` ("bad option") and `app.commandLine
.appendSwitch` does not open the endpoint either, so the audit module uses Electron APIs directly:
`webContents.capturePage()` for screenshots and `executeJavaScript()` for navigation.

- `tools/ui-audit/capture.mjs` (zero deps) launches the exe with the audit flag + an **isolated**
  `COWORK_GHC_RUNTIME_ROOT` + an output dir, waits for the app to capture everything and quit
  itself, then aggregates results and asserts no orphan.
- Navigation uses stable selectors: rail `button[data-surface-id="…"]`, `.topbar__settings`,
  `.settings-surface__tab`, `.app-lock` (see `surface-registry.ts`, `topbar.ts`, `app-lock.ts`).
  Theme is forced via `document.documentElement[data-theme]`.

## Safety (audit mode)

- **Isolated data root** under `.runtime/ui-audit/<run-id>/` — never the real
  `%LOCALAPPDATA%\Cowork GHC` profile.
- **Synthetic throwaway account only** (user `audit`); `COWORK_GHC_ALLOW_ENV_IMPORT=0`, so no `.env`
  credentials are imported. Provider stays unconfigured → no cloud egress, no real API/MS365/MCP key.
- **Teardown is PID-scoped**: kills only the spawned tree and any `opencode.exe` PIDs *this run*
  created (snapshot/diff). It never touches a packaged instance the user already had open.

## Output (git-ignored: `reports/ui-audit/<run-id>/`)

- `screenshots/*.png` — one per surface/state/theme/viewport (1440×900; key surfaces also 1920×1080).
- `manifest.json` — per-shot metadata + automated checks.
- `environment.json`, `audit-log.txt`, `contact-sheet.html` (open this to review).

## Automated checks (exit non-zero on any failure)

renderer mounted · first-run lock shown · synthetic unlock succeeded · product rail interactive ·
per-shot selector present + non-white content · app self-quit (exit 0) · no orphan `coworkghc.exe` ·
no orphan `opencode.exe` · screenshots captured.

## Notes / limits

- Windows only (uses `tasklist`/`taskkill`). Requires a repackage after any shell change
  (the audit module ships inside the bundle, inert unless `COWORK_GHC_UI_AUDIT=1`).
- Viewports are clamped to the primary display's work area; `capturePage` grabs the on-screen
  client area, so a viewport larger than the display is captured at the clamped size.
- Captures the **renderer**; the native Windows titlebar overlay is drawn by the OS and is not part
  of a `capturePage` screenshot.
- Only PO-accepted images should be copied into `docs/demo/screenshots/`; the raw run output stays
  git-ignored.
