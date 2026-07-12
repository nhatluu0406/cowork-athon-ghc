# Cowork GHC - Handoff

Updated: 2026-07-12

## Current State

- Current commit: pending (service reachability fix commit after `bcffc9d`)
- Working tree: partial Slice 2 renderer workspace wiring remains uncommitted
- Loop: `L6` Implementation = `RUNNING`
- Gate: `PARTIAL`
- Packaged service reachability blocker: **RESOLVED**
- Do not start `L7`
- Web remains `DEFERRED`

## Root Cause (Packaged Service Reachability)

The settings-only loopback service was started in-process correctly, but success was reported from socket bind alone. Startup trace markers such as `service_starting` and `controller_start_dispatched` appear **before** the settings-only listener exists (live launch is attempted first, then keyring-backed composition runs). Probing `/v1/health` during that window times out even though the eventual `settings_only_started` base URL is valid.

Fix: after bind, poll authenticated `GET /v1/health` with the per-launch token (`wait-for-health.ts`) before logging `settings_only_ready` / `service_started`.

## Verified In This Checkpoint

Packaged app `dist-app/win-unpacked/Cowork GHC.exe`:

- Electron `whenReady` completes; live launch falls back to settings-only when unconfigured
- Trace shows `settings_only_ready` then `settings_only_started` then `service_started: http://127.0.0.1:<port>`
- Unauthenticated `GET /v1/health` on the reported base URL returns **401** (expected token-guarded boundary)
- Listener owned by packaged main PID on `127.0.0.1:<ephemeral-port>`
- Root PID stop → zero `Cowork GHC` / `opencode` orphans; listener gone

Focused tests:

```powershell
node --import tsx --test app/shell/tests/wait-for-health.test.ts app/shell/tests/service-controller.test.ts app/shell/tests/lifecycle.test.ts app/shell/tests/tiered-start-service.test.ts
npm run package:win
```

## Files Changed (Service Reachability Commit)

- `app/shell/src/service/wait-for-health.ts` (new)
- `app/shell/tests/wait-for-health.test.ts` (new)
- `app/shell/src/main.ts`
- `app/shell/src/service/service-controller.ts`
- `app/shell/tests/service-controller.test.ts`
- `app/shell/src/lifecycle.ts`
- `.loop-engineer/state/*.yaml` + Markdown views + this handoff

## Still Uncommitted / Unverified

Renderer workspace wiring (not part of the reachability commit):

- `app/ui/src/service-client.ts`, `workspace-picker.ts`, `main.ts`, tests, `tsc-out/*`

Packaged GUI still unverified:

- Native folder picker
- Provider/model settings
- Secure keyring credential entry
- DeepSeek test connection
- Live OpenCode session

## Credential / Paid API

- No DeepSeek credential was accessed in this checkpoint.

## Precise Next Action

Verify packaged workspace picker end-to-end (`CGHC-008` re-verify) using `dist-app/win-unpacked/Cowork GHC.exe` once the renderer reaches `ready`. Do not start provider/model, credentials, DeepSeek, live OpenCode, or L7.
