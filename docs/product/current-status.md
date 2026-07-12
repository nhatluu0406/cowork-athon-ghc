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
| Slice | Skills Foundation — Phase 1 |
| Feature commit | `97f53bf` — feat(skills): add local skill discovery and runtime integration |
| Implementation Agent | Cursor |
| Packaged journeys | `skills-foundation-packaged.mjs` A–J PASS (2026-07-12) |
| Regression | `npm run verify:release` PASS; `npm run package:win` PASS |
| Prior slices still PASS | Provider Readiness A–J; Attachment Honesty A–J |

## Latest Verified Slice Commits (prior)

| Commit | Meaning |
|---|---|
| `4f1e804` | Docs: provider readiness slice record. |
| `38a7347` | Provider readiness and functional UX preflight. |
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
- Skills Foundation Phase 1: service-owned discovery of bounded `SKILL.md` directories from
  shipped built-ins and the app-managed user-local Skills root; validation, deterministic refresh,
  persisted global-local enable/disable, bounded read-only preview, per-turn hash/version/source
  provenance, and instruction-context dispatch integration.
- Skills remain instruction-only. They do not execute code, grant filesystem/network/credential
  access, or bypass workspace guards, provider readiness, command/file permission, or keyring boundaries.

## Important Semantics

| Concept | Product meaning |
|---|---|
| Cowork conversation | Long-lived user-facing identity: transcript, workspace, provider/model, activity, and multiple runtime turns. |
| Runtime turn | One OpenCode session execution for one user turn. |
| Continuation after terminal | Cowork GHC creates a new linked runtime turn with bounded context; it does not claim native OpenCode continuation after terminal. |
| Attachment context | Read-only snapshot context for a turn; it never bypasses permission for mutation. |
| Dispatch preflight | UI plans final 12k-char dispatch before runtime starts; fail-fast when attachments cannot all fit; pending chips preserved. |
| Provider readiness | `locally_ready` means configuration is sufficient to attempt a turn; it does not claim endpoint connectivity until test or runtime proves it. |
| Skill enabled state | Global-local registry persists across relaunch; each dispatched user turn snapshots only the Skill IDs/name/version/source/hash/mtime actually used. |

## Phase A / B Status

**Phase A (Safety and Functional Honesty) — CLOSED** for packaged POC scope:

- Attachment dispatch honesty and secret-like blocking: PASS (`3cc4ba6`).
- Missing-credential and provider configuration preflight: PASS (this slice).
- Settings modal focus / empty-state continuation / narrow activity affordance: PASS (this slice).
- Packaged verification env hygiene (`ELECTRON_RUN_AS_NODE` sanitization): PASS.

Full L9 / release-candidate verification is **not** complete. Live streaming/tools/permissions/cancel
in one RC journey, native OS picker, and installed keyring round-trip remain open.

**Skills Foundation Phase 1 — PASS**:

- Discovery/validation, invalid-state UX, enable/disable, relaunch persistence: PASS.
- Live Skill influence, disable semantics, hash/version provenance after change: PASS.
- Shared dispatch-budget fail-fast, marker isolation, permission Deny, process cleanup: PASS.
- Not included: marketplace, MCP, executable plugins, cloud catalog/sync, Skill editor,
  URL installation, or workflow/template replay.

## Verification Still Incomplete

Full live packaged GUI verification has not passed as a single release-candidate journey.
The latest packaged pass used CDP automation and deterministic E2E seams for workspace/attachment
paths. It did not verify live streaming/tool/file/permission/cancel flows, native OS pickers,
installed keyring round-trip, or full release lifecycle in one pass.

## Next Implementation Slice

Next Agent: Cursor.

Recommended next slice:

```text
File Work Review and Before/After Diff
```

Do not start the next slice until Product Owner issues its brief. Do not start MCP,
marketplace/cloud, Attachments Phase 2, web/Next.js, or a workspace explorer.

## Useful Verification Commands

```powershell
npm run verify:release
npm run package:win
node tools/verify/provider-readiness-packaged.mjs
node tools/verify/skills-foundation-packaged.mjs
node tools/verify/attachment-honesty-packaged.mjs
node tools/verify/attachments-packaged.mjs
node tools/verify/multi-turn-context-packaged.mjs
node tools/verify/multi-turn-tool-packaged.mjs
```
