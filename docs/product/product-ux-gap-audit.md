# Product UX Gap Audit

Date: 2026-07-12  
Mode: read-only independent audit  
HEAD reviewed: `4b626fa`

## 1. Executive Summary

Cowork GHC is in a credible packaged POC state, with conversation persistence, multi-turn linked runtime turns, activity/file-change presentation, permissions, provider recovery, and Attachment Phase 1 documented as verified.

No Critical or High blocker was found in Attachment Phase 1 path confinement or raw-content persistence. The main attachment risks are product-semantics gaps: the 12,000-character dispatch budget can silently omit otherwise valid attachments, and `.env` is currently an allowed attachment extension without an explicit secret/exfiltration warning.

GUI capability is functional POC quality, not release-candidate UX. The highest-value next work is not visual redesign; it is functional honesty: attachment budget visibility, clearer continuation/terminal states, file preview semantics, permission/file-change review, keyboard/accessibility pass, and packaged interactive verification.

## 2. Current Verified Product Capability

Verified or documented-current:
- Windows desktop packaged POC baseline `poc-v0.1`.
- Local service, workspace selection, provider/model, Windows keyring, OpenCode runtime, streaming.
- Conversation persistence, multi-conversation sidebar, search, switch, rename/delete via context menu.
- Multi-turn Cowork conversation through linked runtime turns; not native OpenCode continuation after terminal.
- Activity timeline, file-change panel, permission history, bounded text file preview.
- Attachment Phase 1: workspace text-file picker, pending chips, metadata persistence, untrusted transport envelope, no raw content in transcript.
- Known gaps: Skills not available in GUI, template replay missing, full before/after diff missing, folder/image/PDF/drag-drop attachments missing, full L9 release verification not complete.

## 3. Attachment Phase 1 Audit Findings

### Critical

No issue.

### High

No issue found in workspace escape, raw attachment persistence, or permission bypass.

### Medium

1. Silent dispatch-budget omission risk.

A file can pass the service limits of 32 KiB per file and 64 KiB per turn, but still fail to fit inside the 12,000-character shared dispatch budget. `augmentDispatchPrompt` marks `attachmentTruncated`, but the UI path does not surface that to the user. Metadata and activity can still say the file was attached/read even if content was omitted from the actual runtime prompt.

Impact: user trust and model behavior mismatch. The product may appear to have supplied context that the runtime never received.

Recommendation: before Skills, add visible send-time feedback: included files, omitted files, and reason. Do not record “read context” for an attachment omitted from dispatch, or record it as “selected but not sent.”

2. `.env` is in the attachment allowlist.

`service/src/workspace/attachment-limits.ts` allows `.env`. This is not a path-boundary bug, but it creates an easy accidental secret-to-provider path when a user attaches a workspace file.

Recommendation: Product Owner decision. Prefer block by default or require a strong confirmation for `.env`, `.pem`, `.key`, credential-like filenames, and files matching secret patterns.

### Low

1. File-level truncation flag is effectively unreachable in normal service behavior.

`readWorkspaceAttachment` rejects files larger than `maxFileBytes` before reading, then computes `truncated = buf.length > maxFileBytes`. With current flow, oversized files are rejected, not truncated. This is acceptable, but docs/UI should consistently call this “reject over 32 KiB,” not “truncate file to 32 KiB.”

### Documentation Only

1. `docs/product/current-status.md` says “HEAD hiện tại: 0fc1fa6,” but actual HEAD is `4b626fa`. If the intent is “attachment slice HEAD,” reword it.

2. Active docs say full L9 release verification has not started, while `.loop-engineer/evidence/CGHC-028-release-verification.md` records a PARTIAL L9/release-candidate verification. Active docs should distinguish “full L9 PASS not complete” from “no L9 evidence exists.”

### No Issue

- Workspace confinement: service-side validation and `assertRealPathInside` are used; picker is not trusted as the boundary.
- Symlink/reparse handling: realpath confinement is present.
- Binary validation: unsupported extensions and null bytes are rejected.
- Raw content persistence: conversation schema stores metadata only.
- Transport envelope isolation: attachment envelope is untrusted and artifact detection exists.
- Permission boundary: attachment read is context only; mutation still goes through permission flow.
- Historical continuation flow: packaged journeys include relaunch/continue semantics.

## 4. Relevant Legacy Requirements Found

### Still Relevant And Missing From Active Docs

- Durable local audit scope for Allow/Deny and provider/model changes should be explicitly stated in current docs. Code has in-memory/audit seams, but short active docs do not explain product-level audit expectations.
- Packaged interactive release gaps: installed artifact run, full GUI click-through, PR7 UI render, installed keyring round-trip, and chained packaged interactive smoke.

### Already Represented In Active Docs

- Workspace boundary and realpath confinement.
- Single OS-backed credential store.
- Web/Next.js deferred.
- OpenWork is reference only.
- Multi-turn is Cowork-linked runtime turns, not native OpenCode continuation.
- Skills are not yet GUI-available.

### Superseded By Current Architecture

- Old Loop Engineer L0-L10 workflow as active source of truth.
- OpenWork remote/multi-user/web assumptions.

### Obsolete / No Longer Needed

- Restoring Loop Engineer workflow.
- Treating checkpoint/task-state as live product requirement.

### Unclear — Requires Product Owner Decision

- Whether templates/workflow replay should precede Skills.
- Whether debug/audit UI is MVP or post-RC.
- Whether arbitrary workspace file explorer belongs in Cowork GHC.

## 5. GUI And Functional UX Gaps

### Missing Product Capability

- Skills tab is visible but disabled.
- No folder/image/PDF/Office/drag-drop attachment support.
- No full before/after diff for modified files.
- No template/workflow replay.
- No packaged interactive smoke covering the full renderer path.

### Functional UX Issue

- Attachment budget inclusion is not visible.
- Historical terminal state and “continue this conversation” exist, but should be clearer in sidebar/status.
- File preview only covers current text content for file changes; deleted/binary/missing are handled, but no diff.
- Rename/delete via right-click prompt is functional but not discoverable.
- Provider/settings are discoverable via topbar/model button, but first-run guidance still needs polish.
- Panel collapse exists, but persistence/resize ergonomics are unclear.

### Information Architecture Issue

- “Tệp đã đọc” mixes attachment context and tool reads. That may be acceptable, but should distinguish “attached by user” vs “read by runtime/tool.”
- Activity, permission history, file output, and preview are in the right panel; this is likely enough for MVP. A separate Preview tab is not yet justified.

### Accessibility Issue

- Permission modal has strong focus/ARIA handling.
- Main shell needs a focused keyboard pass: sidebar navigation, context-menu alternatives, panel collapse, attachment chip remove, activity file preview, and settings modal.
- Streaming/status announcements should avoid noisy per-token live-region behavior.

### Visual Polish Only

- Icons and animation should wait until functional states are honest.
- Use icons for file type/status where they improve scanning; avoid decorative motion.

### Not Recommended / Scope Creep

- Full arbitrary workspace explorer now. It risks turning Cowork GHC into an IDE clone and expands security/UX scope.
- Separate universal preview tab now. Right-panel contextual preview is enough for MVP.

## 6. Feature Versus Polish Classification

Feature/product:
- Attachment budget honesty.
- Secret-file attachment warning/block.
- Diff before/after.
- Packaged interactive GUI verification.
- Skills enablement.
- Keyboard/accessibility pass.

Functional UX:
- Continuation/terminal clarity.
- Sidebar rename/delete affordance.
- Activity read-source distinction.
- Panel resize/collapse behavior.

Visual polish:
- Icon set refinement.
- Micro-animation for streaming/tool activity/cancel only.
- Final spacing/color/type polish.

Defer:
- IDE-style file explorer.
- Arbitrary workspace file preview.
- Marketplace/cloud capabilities.
- Web/Next.js.

## 7. Prioritized Recommendations

### Now

- Fix active docs HEAD wording.
- Clarify L9 status as “partial evidence exists; full L9 PASS incomplete.”
- Document 32 KiB/file, 64 KiB/turn, and 12k dispatch as separate gates.
- Decide `.env`/secret-like attachment policy.

### Before Skills

- Surface which attachments were actually included in dispatch.
- Distinguish attachment-read from tool-read in activity.
- Add keyboard/discoverability improvements for conversation actions.
- Add functional file preview/diff decision.

### Before Release Candidate

- Run packaged interactive GUI smoke through renderer.
- Verify installed artifact/keyring path.
- Verify PR7 provider errors render correctly in packaged UI.
- Add accessibility pass for shell, sidebar, composer, permission modal, settings, activity panel.

### Final Polish

- Icons for file type/status/action.
- Minimal animations for streaming, tool activity, cancellation.
- Visual spacing, color, and typography cleanup.

### Defer

- Full workspace explorer.
- Preview arbitrary workspace files.
- Web app.
- Remote/multi-user/cloud sync.

## 8. Explicit Non-Goals

- No Loop Engineer workflow restoration.
- No subagent fan-out.
- No web/Next.js.
- No OpenWork feature inheritance unless explicitly product-owned.
- No IDE clone.
- No broad filesystem browser in MVP.

## 9. Open Product Owner Decisions

1. Should `.env` and credential-like files be blocked, warned, or allowed as intentional user context?
2. Is template/workflow replay required before Skills?
3. Should audit history be user-visible in MVP or only internal/local evidence?
4. Is a minimal workspace explorer needed, or are picker + activity preview enough?
5. Should file preview prioritize attachment input, tool-created/modified files, or arbitrary workspace files?

## 10. Suggested Next Three Product Slices

1. Attachment honesty and safety slice: dispatch-budget UI, included/omitted metadata, secret-file policy.
2. Functional UX hardening slice: continuation/sidebar/activity/preview/keyboard pass without redesign.
3. Release-candidate verification slice: packaged interactive GUI smoke, installed artifact/keyring, PR7 UI, resume, permission allow/deny.
