---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Current Status

Active product plan: [Cowork GHC Product Plan](./cowork-ghc-product-plan.md)

Do not use a moving `HEAD hiện tại` field here. Use the latest verified slice commits
and the current working tree instead.

## Latest Verified Slice

| Field | Value |
|---|---|
| Slice | Provider Readiness and Functional UX Preflight |
| Feature commit | `38a7347` — fix(ui): enforce provider readiness before runtime start |
| Implementation Agent | Cursor |
| Packaged journeys | `provider-readiness-packaged.mjs` A–J PASS (2026-07-12) |
| Regression | `npm run verify:release` PASS; `npm run package:win` PASS |
| Prior slice still PASS | Attachment Honesty (`3cc4ba6`); `attachment-honesty-packaged.mjs` A–J |

## Latest Verified Slice Commits (prior)

| Commit | Meaning |
|---|---|
| `eaaab0c` | Docs: attachment honesty slice record. |
| `3cc4ba6` | Attachment honesty + secret-file safety. |
| `8df3d59` | Packaged L6 POC acceptance baseline. |
| `e40dada` | Multi-turn context isolation from assistant output. |

## Product State

Cowork GHC is a packaged Windows desktop POC (`poc-v0.1`). It is local-first,
workspace-centered, uses OpenCode as the current agent runtime, and supports a
replaceable LLM endpoint. DeepSeek is the current provider used for testing; it is not
a permanent product dependency.

Daily source of truth is Git plus active docs in `docs/product/`, `docs/quality/`,
`docs/architecture/`, and `AGENTS.md`. `.loop-engineer/` is maintenance-only provenance.

## Verified Baseline

- Local service lifecycle, workspace selection, provider/model settings, Windows keyring,
  OpenCode runtime, streaming, permissions, cancellation, provider recovery, and process
  cleanup have packaged POC evidence.
- Conversation persistence, multi-conversation sidebar, search, switch, rename/delete,
  relaunch restore, and linked multi-turn Cowork conversations have packaged/automated evidence.
- Context isolation is verified for new turns: bounded untrusted internal envelopes are not
  persisted or displayed as assistant output.
- Activity timeline, file-change panel, permission history, and bounded text file preview exist.
- Attachment Phase 1 plus honesty slice: workspace text files, dispatch preflight fail-fast,
  explicit inclusion metadata, secret-like filename blocking before read, activity wording
  `Đã đưa tệp vào ngữ cảnh`, and no raw attachment content in transcript.
- Provider readiness: centralized preflight blocks runtime turn when provider/model/credential/base URL
  is locally invalid; missing credential shows `Cần cấu hình khoá API trước khi bắt đầu` with settings CTA;
  local service and provider status are separate in topbar; settings modal focus trap; empty-state
  continuation controls removed from DOM until historical terminal conversation is selected; narrow
  activity mobile toggle; packaged child env strips `ELECTRON_RUN_AS_NODE`.

## Important Semantics

| Concept | Product meaning |
|---|---|
| Cowork conversation | Long-lived user-facing identity: transcript, workspace, provider/model, activity, and multiple runtime turns. |
| Runtime turn | One OpenCode session execution for one user turn. |
| Continuation after terminal | Cowork GHC creates a new linked runtime turn with bounded context; it does not claim native OpenCode continuation after terminal. |
| Attachment context | Read-only snapshot context for a turn; it never bypasses permission for mutation. |
| Dispatch preflight | UI plans final 12k-char dispatch before runtime starts; fail-fast when attachments cannot all fit; pending chips preserved. |
| Provider readiness | `locally_ready` means configuration is sufficient to attempt a turn; it does not claim endpoint connectivity until test or runtime proves it. |

## Phase A Status

**Phase A (Safety and Functional Honesty) — CLOSED** for packaged POC scope:

- Attachment dispatch honesty and secret-like blocking: PASS (`3cc4ba6`).
- Missing-credential and provider configuration preflight: PASS (this slice).
- Settings modal focus / empty-state continuation / narrow activity affordance: PASS (this slice).
- Packaged verification env hygiene (`ELECTRON_RUN_AS_NODE` sanitization): PASS.

Full L9 / release-candidate verification is **not** complete. Live streaming/tools/permissions/cancel
in one RC journey, native OS picker, and installed keyring round-trip remain open.

## Verification Still Incomplete

Full live packaged GUI verification has not passed as a single release-candidate journey.
The latest packaged pass used CDP automation and deterministic E2E seams for workspace/attachment
paths. It did not verify live streaming/tool/file/permission/cancel flows, native OS pickers,
installed keyring round-trip, or full release lifecycle in one pass.

## Next Implementation Slice

Next Agent: Cursor.

Recommended next slice:

```text
Skills Foundation
```

Do **not** start Skills until Product Owner explicitly reprioritizes or the next slice brief is issued.

Do not start Attachments Phase 2, web/Next.js, or a workspace explorer until the next slice is resolved.

## Useful Verification Commands

```powershell
npm run verify:release
npm run package:win
node tools/verify/provider-readiness-packaged.mjs
node tools/verify/attachment-honesty-packaged.mjs
node tools/verify/attachments-packaged.mjs
node tools/verify/multi-turn-context-packaged.mjs
node tools/verify/multi-turn-tool-packaged.mjs
```
