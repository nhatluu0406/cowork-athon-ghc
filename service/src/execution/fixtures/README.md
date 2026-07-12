# Captured-frame fixtures (CGHC-024 / PR10)

This directory defines the **captured-frame test harness**: the honest mechanism for
replaying **real** OpenCode SSE frames through the production `createEvMapper` + EV reducer.

> **Status: NOT DONE.** This ships the FORMAT, LOADER, pin-GATE, and REPLAY mechanism only.
> `data/` contains **no fabricated frames** on purpose — real fixtures are captured from a
> live pinned OpenCode run **after** the product-owner token gate. Fabricating SSE frames
> here would be exactly the R4 hollow-green failure this task exists to prevent.

## Fixture format (`data/<scenario>.ndjson`)

NDJSON. **Line 1** is a header (`kind: "capture-meta"`); **every following line** is one raw
OpenCode `/event` envelope, verbatim off the wire (`kind: "frame"`).

```
{"kind":"capture-meta","scenario":"simple-chat","opencodePin":"v1.17.11","capturedAt":"…","sessionId":"ses_…","prompt":"…"}
{"kind":"frame","raw":{"type":"message.part.delta","properties":{"sessionID":"ses_…","delta":"Hi"}}}
{"kind":"frame","raw":{"type":"session.idle","properties":{"sessionID":"ses_…"}}}
```

Validated by `schema.ts` (`parseCapturedFrameFile`). A present-but-malformed fixture is a
hard error; an absent fixture is an honest `needs_capture` (never green-washed).

## MANIFEST — scenarios that MUST be captured

Defined in `manifest.ts` (`REQUIRED_CAPTURE_SCENARIOS`). Each entry pins the terminal state
and the EV kinds the replayed stream must contain:

| scenario     | expected terminal | must emit                          |
| ------------ | ----------------- | ---------------------------------- |
| `simple-chat`| `completed`       | `token`, `terminal`                |
| `tool-call`  | `completed`       | `tool_call`, `file_mutation`, `terminal` |
| `error`      | `errored`         | `error`, `terminal`                |
| `cancel`     | `cancelled`       | `terminal` (cancelled)             |

`completed` may come **only** from a real `session.idle` frame; `errored`/`cancelled` only
from a real `session.error`. This proves the EV7 "no fabricated completed" guarantee on real
bytes, not handcrafted ones.

## Pin gate (`gate.ts`)

`captureGateStatus(scenario)` ties fixtures to `OPENCODE_PIN` (`v1.17.11`):

- fixture absent → `needs_capture`
- fixture captured against a different pin → `needs_recapture`
- fixture present + pin matches → `ready`

Tests call the gate and **skip with the reason** when not `ready` (node:test counts it as
*skipped*, not passed). Bumping the pin (ADR 0001 upgrade gate) flips every fixture to
`needs_recapture` until re-captured.

## Capturing (opt-in, post-token)

See `tools/capture-frames/`. The capture tool connects to a live pinned `opencode serve`,
resolves the provider key from the credential store (never argv/env-persisted), records the
raw frames here, and **never** runs in the default test suite.
