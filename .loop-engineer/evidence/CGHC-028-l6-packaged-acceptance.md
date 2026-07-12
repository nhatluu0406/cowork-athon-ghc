# CGHC-028 — L6 packaged acceptance (slices 5A–5F)

Date: 2026-07-12  
Verifier: `node tools/verify/l6-packaged.mjs`  
Target: `dist-app/win-unpacked/Cowork GHC.exe`  
Live inference budget: **3 successful** (PING + permission approve file + permission deny prompt)

## Root cause fixed (permission)

OpenCode v1.17.11 permission reply body is `{ reply: "once"|"always"|"reject" }`, not `{ response }` or `{ decision, scope }`.

Wiring added:

- `permission.asked` → `createPermissionBridge` → `ToolPermissionProxy` → `PermissionGate` → UI modal
- Live `opencode.json` policy: `*: ask` with read/list/glob/grep allow; bash/webfetch/websearch deny
- Event pump `onFrame` hook feeds the bridge before session demux

## Packaged journeys

| Slice | Result | Notes |
|---|---|---|
| 5A Approve | PASS | Real modal; file `cghc-l6-approve.txt` created after allow |
| 5A Deny | PASS | Real modal; `cghc-l6-deny.txt` not created after deny |
| 5B Clean profile | PASS | Isolated `--user-data-dir`; workspace → settings → keyring → session → stream |
| 5C Provider recovery | PASS | Delete credential → Vietnamese error; restore key → test success |
| 5D Interruption | PASS | Kill during stream; no orphans; relaunch not stuck running |
| 5E Lifecycle | PASS | `init.bat` OK; `stop.bat` safe when already stopped; `cli.mjs clean --yes` allowlist-only |
| 5F UX | PARTIAL | Step labels VI; provider errors VI; path tooltip; disabled start hints |

## Regression runs

- Run 1: PING streaming timeout (transient).
- Run 2: **PASS** `live_success=3`.

## Lifecycle notes

- `clean.bat --yes` via `cmd /c` hit a batch-label quirk; `node tools/app/cli.mjs clean --root . --yes` PASS.
- `start.bat` not spawned in l6-packaged (avoids duplicate GUI); defer double-click evidence to L9.

## Tests

- `service/tests/permission-bridge.test.ts` — 3 pass
- `service/tests/runtime-reply-adapter.test.ts` — reply body `{ reply }`
- `tools/verify/l6-packaged.mjs` — PASS

## Remaining (non-blocking for desktop POC)

- Template re-run / session resume packaged smoke (CGHC-028 bullet 5 backlog)
- Invalid-model / bad-base-URL UI legs (credential delete/recover covers PR7 surface)
- Full L9 scripted regression beyond l6-packaged.mjs
