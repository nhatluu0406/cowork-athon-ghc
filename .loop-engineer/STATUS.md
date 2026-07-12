# Cowork GHC - Status

> Human view synchronized from `.loop-engineer/state/*.yaml` on 2026-07-12.
> YAML remains canonical.

## Current State

- Phase: `L6_IN_PROGRESS`
- Loop: `L6` Implementation = `RUNNING`
- Gate: `PARTIAL`
- Operating mode: `LEAN`
- Active product slice: Slice 2 workspace selection **DONE**; next is provider/model + credential settings (Slice 3)
- Do not start: `L7`
- Web / Next.js: `DEFERRED`

## Packaged POC Status

The packaged desktop POC is not complete end-to-end but two slices are verified.

Verified in package (`dist-app/win-unpacked/Cowork GHC.exe`):

- **Slice 1**: settings-only service reachability; authenticated health before `service_started`; clean PID stop.
- **Slice 2**: native workspace picker seam → grant → `setActiveWorkspace` persistence under `%APPDATA%/cowork-ghc/.runtime/settings.json` → relaunch restore → workspace change.

Still unverified in the package:

- Provider/model settings UI
- Secure credential entry through Windows keyring
- DeepSeek test connection
- Live OpenCode session, streaming, permission/file-on-disk, and full stop/resume/clean journey

## Tasks

- `DONE`: 25 (includes `CGHC-008`)
- `STALE`: 2 (`CGHC-011`, `CGHC-019`)
- `IN_PROGRESS`: 1 (`CGHC-028`)

## Credential / API Status

- No DeepSeek credential was read, printed, logged, or used in this checkpoint.

## Focused Validation Run

- `node --import tsx --test app/ui/tests/workspace-picker.test.ts app/ui/tests/service-client.test.ts app/shell/tests/preload-bridge.test.ts app/shell/tests/lifecycle.test.ts` — **20/20 PASS**
- `npm run package:win` — PASS
- `node tools/verify/slice2-workspace-packaged.mjs` — PASS

## Next Action

Slice 3: packaged provider/model settings + secure credential entry (`CGHC-011` / `CGHC-019` re-verify). Do not start DeepSeek live testing, OpenCode live session, or L7 until those UI flows are packaged-verified.
