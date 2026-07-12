---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Current Status

Active product plan: [Cowork GHC Product Plan](./cowork-ghc-product-plan.md)

Do not use a moving `HEAD hiện tại` field here. Use the latest verified slice commits
and the current working tree instead.

## Latest Verified Slice Commits

| Commit | Meaning |
|---|---|
| `8df3d59` | Packaged L6 POC acceptance baseline. |
| `e40dada` | Multi-turn context isolation from assistant output. |
| `0fc1fa6` | Workspace text file attachments Phase 1. |
| `2ae1426` | Attachment documentation/state follow-up. |
| `efccb60` | Product UX gap audit added. |
| `6d89074` | Packaged GUI/UX gap verification documented. |

Last verification date: 2026-07-12.

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
- Attachment Phase 1 is packaged verified for workspace text files: picker/chip behavior,
  metadata persistence, workspace guard, binary/extension/size rejection, untrusted transport
  envelope, and no raw attachment content in transcript.

## Important Semantics

| Concept | Product meaning |
|---|---|
| Cowork conversation | Long-lived user-facing identity: transcript, workspace, provider/model, activity, and multiple runtime turns. |
| Runtime turn | One OpenCode session execution for one user turn. |
| Continuation after terminal | Cowork GHC creates a new linked runtime turn with bounded context; it does not claim native OpenCode continuation after terminal. |
| Attachment context | Read-only snapshot context for a turn; it never bypasses permission for mutation. |

## Current Blockers Before Skills

1. Attachment budget honesty: UI must show which accepted attachments are included,
   omitted, or truncated in the 12,000-character dispatch budget.
2. Secret-like file blocking: `.env`, `.pem`, `.key`, credential-like filenames/patterns
   should be blocked by default for MVP.
3. Missing-credential preflight: the packaged UI should fail fast with actionable recovery
   instead of entering unclear running/not-connected state.

Small UX/accessibility fixes that should travel with the blocker work:
- settings modal focus placement;
- empty-state continuation controls should not be DOM/screen-reader reachable before a
  historical terminal conversation is selected;
- narrow/high-DPI activity visibility needs a clear affordance if activity is hidden.

## Verification Still Incomplete

Full live packaged GUI verification has not passed as a single release-candidate journey.
The latest packaged UX pass used CDP screenshots/DOM inspection and deterministic E2E seams
for workspace/attachment paths. It did not verify live streaming/tool/file/permission/cancel
flows, native OS pickers, installed keyring round-trip, or full release lifecycle in one pass.

## Next Implementation Slice

Next Agent: Cursor.

Recommended next slice:

```text
Attachment Honesty and Secret-File Safety
```

Scope:
- included/omitted/truncated attachment presentation;
- 32 KiB/file, 64 KiB/turn, and 12k dispatch budget as separate gates;
- block secret-like attachments by default;
- missing-credential preflight if small enough to land with the same functional-honesty pass.

Do not start Skills, Attachments Phase 2, web/Next.js, or a workspace explorer until this
slice is resolved or Product Owner changes priority.

## Useful Verification Commands

```powershell
npm run verify:release
node tools/verify/multi-turn-context-packaged.mjs
node tools/verify/attachments-packaged.mjs
node tools/verify/multi-turn-tool-packaged.mjs
node tools/verify/conversation-finalization-packaged.mjs
node tools/verify/session-management-packaged.mjs
```
