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
| Slice | Attachment Honesty and Secret-File Safety |
| Feature commit | `3cc4ba6` — fix(attachments): make dispatch inclusion explicit and block secret files |
| Implementation Agent | Cursor |
| Packaged journeys | `attachment-honesty-packaged.mjs` A–J PASS (2026-07-12) |
| Regression | `npm run verify:release` PASS; `npm run package:win` PASS |

## Latest Verified Slice Commits (prior)

| Commit | Meaning |
|---|---|
| `8df3d59` | Packaged L6 POC acceptance baseline. |
| `e40dada` | Multi-turn context isolation from assistant output. |
| `0fc1fa6` | Workspace text file attachments Phase 1. |
| `dbab729` | Localized Cowork GHC product plan. |

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

## Important Semantics

| Concept | Product meaning |
|---|---|
| Cowork conversation | Long-lived user-facing identity: transcript, workspace, provider/model, activity, and multiple runtime turns. |
| Runtime turn | One OpenCode session execution for one user turn. |
| Continuation after terminal | Cowork GHC creates a new linked runtime turn with bounded context; it does not claim native OpenCode continuation after terminal. |
| Attachment context | Read-only snapshot context for a turn; it never bypasses permission for mutation. |
| Dispatch preflight | UI plans final 12k-char dispatch before runtime starts; fail-fast when attachments cannot all fit; pending chips preserved. |

## Current Blockers Before Skills

1. Missing-credential preflight: packaged UI should fail fast with actionable recovery
   instead of entering unclear running/not-connected state.
2. Small UX/accessibility fixes that should travel with the next functional-honesty pass:
   settings modal focus placement; empty-state continuation controls reachable before a
   historical terminal conversation is selected; narrow/high-DPI activity visibility affordance.

Attachment dispatch-budget honesty and secret-like file blocking from Phase A are **resolved**
in the latest slice.

## Verification Still Incomplete

Full live packaged GUI verification has not passed as a single release-candidate journey.
The latest packaged pass used CDP automation and deterministic E2E seams for workspace/attachment
paths. It did not verify live streaming/tool/file/permission/cancel flows, native OS pickers,
installed keyring round-trip, or full release lifecycle in one pass.

## Next Implementation Slice

Next Agent: Cursor.

Recommended next slice:

```text
Provider Readiness and Functional UX Preflight
```

Scope:
- missing-credential preflight before runtime send;
- settings modal focus and empty-state continuation accessibility fixes if small enough;
- do not start Skills until Product Owner reprioritizes.

Do not start Skills, Attachments Phase 2, web/Next.js, or a workspace explorer until the
next slice is resolved or Product Owner changes priority.

## Useful Verification Commands

```powershell
npm run verify:release
npm run package:win
node tools/verify/attachment-honesty-packaged.mjs
node tools/verify/attachments-packaged.mjs
node tools/verify/multi-turn-context-packaged.mjs
node tools/verify/multi-turn-tool-packaged.mjs
```
