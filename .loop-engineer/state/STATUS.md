# Cowork GHC - Status

> Human view synchronized from `.loop-engineer/state/*.yaml` on 2026-07-12.
> YAML remains canonical.

## Current State

- Phase: `L6_IN_PROGRESS`
- Loop: `L6` Implementation = `RUNNING`
- Gate: `PARTIAL`
- Operating mode: `LEAN`
- Active product slice: packaged service reachability resolved; next is packaged workspace picker (Slice 2)
- Do not start: `L7`
- Web / Next.js: `DEFERRED`

## Packaged POC Status

The packaged desktop POC is not complete and is not yet usable end-to-end.

Resolved in this checkpoint:

- Packaged service reachability blocker: `dist-app/win-unpacked/Cowork GHC.exe` starts the owned settings-only loopback service, polls authenticated `GET /v1/health` before logging `service_started`, and the reported `http://127.0.0.1:<port>` answers `401` without token (expected token-guarded boundary).
- Clean stop of the launched root PID leaves zero `Cowork GHC` / `opencode` processes and no loopback listener.

Still unverified in the package:

- Native folder picker click-through
- Provider/model settings UI
- Secure credential entry through Windows keyring
- DeepSeek test connection
- Live OpenCode session, streaming, permission/file-on-disk, and full stop/resume/clean journey

## Tasks

- `DONE`: 24
- `STALE`: 3 (`CGHC-008`, `CGHC-011`, `CGHC-019`)
- `IN_PROGRESS`: 1 (`CGHC-028`)

No task was newly completed in this checkpoint.

## Credential / API Status

- No DeepSeek credential was read, printed, logged, or used in this checkpoint.
- Live request budget remains unused.

## Focused Validation Run

- `node --import tsx --test app/shell/tests/wait-for-health.test.ts app/shell/tests/service-controller.test.ts app/shell/tests/lifecycle.test.ts app/shell/tests/tiered-start-service.test.ts` - PASS (19/19)
- `npm run package:win` - PASS
- Packaged verification on `dist-app/win-unpacked/Cowork GHC.exe` - PASS (`/v1/health` 401 without token; clean PID stop)

## Next Action

Resume Slice 2: verify the packaged native folder picker and workspace grant journey end-to-end. Do not start provider/model settings, credentials, DeepSeek, live OpenCode, or L7 until workspace selection is packaged-GUI verified.
