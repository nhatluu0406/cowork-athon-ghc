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

1. Resolved by docs consolidation: `docs/product/current-status.md` no longer uses a moving `HEAD hiện tại` field and instead lists latest verified slice commits.

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

- Keep active docs free of moving `HEAD hiện tại` wording.
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

## Packaged Interactive Verification

Date: 2026-07-12  
Verification mode: packaged Electron app rebuilt from `efccb60` with `npm run package:win`.  
Executable: `dist-app/win-unpacked/Cowork GHC.exe` (`LastWriteTime` 2026-07-12 19:38 local).  
Profile/workspace used: clean profile under `C:\tmp\cghc-ux-profile`, fixture workspace under `C:\tmp\cghc-ux-workspace`.  
Evidence: screenshots in `docs/product/product-ux-gap-audit-evidence/`.

Scope note: this pass directly observed the packaged renderer through CDP screenshots and DOM inspection. The environment variable `ELECTRON_RUN_AS_NODE=1` was present in the shell and caused initial launch/smoke attempts to exit; relaunching with that variable removed produced a working packaged UI. Live provider/model turns were not executed because live/paid LLM use was not confirmed during this pass.

### Evidence Index

- `01-clean-profile-launch.png` - clean profile shell, no workspace/model configured.
- `02-workspace-selected.png` - workspace selected via packaged E2E picker seam.
- `04-attachment-pending-chip.png` - valid attachment pending chip.
- `05-attachment-oversized-error.png` - oversized attachment error chip.
- `05b-attachment-unsupported-error.png` - unsupported `.png` attachment error chip.
- `05c-env-attachment-accepted.png` - `.env` file accepted as a valid attachment.
- `08-provider-settings-missing-credential.png` - settings modal with missing credential.
- `08b-missing-credential-send-error.png` - missing-credential send attempt left no clear error transition.
- `09-narrow-high-dpi-layout.png` - narrow/high-DPI layout after failed live-start state.
- `09b-activity-panel-collapsed.png` - activity panel collapsed state.

### Direct Observations

#### PGUI-001 - Packaged launch needs environment hygiene

- Classification: Medium
- Observation: Launch failed until `ELECTRON_RUN_AS_NODE` was removed from the shell environment. With the variable removed, packaged app opened, wrote startup trace, exposed CDP, and showed `Đã kết nối local service`.
- Reproduction steps: Build with `npm run package:win`; launch `Cowork GHC.exe` while `ELECTRON_RUN_AS_NODE=1`; then relaunch after removing that env var.
- Expected behavior: Packaged verification scripts should sanitize Electron-specific test env and reliably launch the packaged GUI.
- Actual behavior: `minimal-packaged-smoke.mjs` timed out waiting for local service because it inherited `ELECTRON_RUN_AS_NODE=1`; manual relaunch after removing it worked.
- Evidence: `01-clean-profile-launch.png`; startup trace contained `settings_only_ready` after env removal.
- Recommendation: Update packaged verification scripts/runbook to delete `ELECTRON_RUN_AS_NODE` before spawning packaged Electron. Application code change is not required unless the product wants a startup hard-assert.
- Timing: Now
- Verification source: Observed directly in packaged UI plus launch trace.

#### PGUI-002 - Clean profile shell is understandable but has a confusing continuation banner in empty state

- Classification: Medium
- Observation: Clean shell clearly shows service readiness, missing model/credential, missing workspace, workspace CTA, disabled send/attachment, and empty activity. However, the empty conversation area also contains the continuation banner text and button in DOM text even before any conversation history exists.
- Reproduction steps: Launch packaged app with clean profile and no workspace selected.
- Expected behavior: Empty state should only show first-run guidance; continuation controls should not be visible or screen-reader-reachable until a historical terminal conversation is selected.
- Actual behavior: Visual screenshot mainly reads correctly, but DOM text includes `Đây là lịch sử đã lưu...` and `Tiếp tục cuộc trò chuyện này` in the empty state.
- Evidence: `01-clean-profile-launch.png`.
- Recommendation: Treat as functional UX/a11y cleanup: ensure hidden continuation controls are not announced or reachable in first-run empty state.
- Timing: Before Release Candidate
- Verification source: Observed directly in packaged UI/DOM.

#### PGUI-003 - Workspace selection works through packaged seam; native folder dialog not verified

- Classification: No issue for current packaged seam; Not verified for native dialog
- Observation: Clicking workspace selection with `COWORK_GHC_E2E_WORKSPACE_ROOT` selected the fixture workspace. The UI displayed a shortened path, active full path, and recent workspace entry. No UI implied that sidebar was a file explorer.
- Reproduction steps: Launch with fixture workspace seam; click `Chọn thư mục workspace...`.
- Expected behavior: Workspace context becomes visible; send remains disabled until prompt text; attachment becomes enabled once workspace is active.
- Actual behavior: Expected behavior observed. Long-ish Windows path is shortened in the top workspace label and full path appears in workspace section.
- Evidence: `02-workspace-selected.png`.
- Recommendation: No minimal workspace explorer before RC. Picker + recent workspace + activity/file preview are enough for MVP navigation. Native folder dialog still needs a true manual installed-app pass.
- Timing: Defer workspace explorer
- Verification source: Observed directly in packaged UI through E2E picker seam; native OS dialog not verified.

#### PGUI-004 - Settings discoverability is acceptable, but modal focus is weak

- Classification: Medium
- Observation: Provider/model status in topbar is discoverable; clicking opens settings. Missing credential is clear (`Khoá API: Chưa cấu hình`). After opening via click, active focus remained on `BODY` in the observed DOM rather than moving into the modal.
- Reproduction steps: Click topbar model/status button.
- Expected behavior: Modal opens and focus moves to a close button, title, provider selector, or first meaningful control.
- Actual behavior: Settings modal opens with useful content, but focus was not placed inside the modal.
- Evidence: `08-provider-settings-missing-credential.png`.
- Recommendation: Add a focused keyboard/accessibility pass for settings modal focus placement and close/escape behavior.
- Timing: Before Release Candidate
- Verification source: Observed directly in packaged UI/DOM.

#### PGUI-005 - Attachment valid/error chips are functional but under-inform budget semantics

- Classification: Confirmed by packaged UI
- Observation: Valid `.txt` attachment shows a chip (`violet.txt`) and remove button. Oversized and unsupported files show error chips with useful tooltip/title messages. No chip shows size, per-turn total, dispatch inclusion, or whether a selected file will fit into the 12k outbound prompt budget.
- Reproduction steps: Relaunch with fixture attachment paths for `violet.txt`, `oversized.txt`, and `fake.png`; click attachment button.
- Expected behavior: Valid and invalid attachment state is visible; error reasons are clear; dispatch budget caveat is surfaced before send.
- Actual behavior: Valid/error chip behavior works, but dispatch inclusion is not visible.
- Evidence: `04-attachment-pending-chip.png`, `05-attachment-oversized-error.png`, `05b-attachment-unsupported-error.png`.
- Recommendation: Keep chip pattern, add explicit included/omitted/budget feedback before or at send time.
- Timing: Before Skills
- Verification source: Observed directly in packaged UI.

#### PGUI-006 - `.env` attachment is accepted without warning

- Classification: Medium
- Observation: A fake `.env` file with a non-real credential-like value was accepted as a valid attachment. The chip displayed only `.env`; no warning or confirmation was shown.
- Reproduction steps: Relaunch with `COWORK_GHC_E2E_ATTACHMENT_PATH=C:\tmp\cghc-ux-workspace\.env`; click attachment button.
- Expected behavior: Secret-like filenames should be blocked by default or require explicit confirmation.
- Actual behavior: `.env` is accepted like ordinary text. The fake secret content did not appear in visible DOM before send.
- Evidence: `05c-env-attachment-accepted.png`.
- Recommendation: Block secret-like files by default for MVP, with a possible future explicit override. Minimum block/warn set: `.env`, `.pem`, `.key`, credential-like filenames, and common secret-value regex hits.
- Timing: Now
- Verification source: Observed directly in packaged UI.

#### PGUI-007 - Dispatch-budget omission is confirmed, but still code-only for model behavior

- Classification: Confirmed by code path; still not sent live in packaged UI
- Observation: Using the same `augmentDispatchPrompt` code path, two accepted 9k text attachments produce a dispatch with `attachmentTruncated=true`; only `budget-a.txt` is included and `budget-b.txt` is omitted. Current packaged UI has no visible indication of this.
- Reproduction steps: Assemble dispatch from `budget-a.txt` and `budget-b.txt` through `app/ui/src/attachment-context.ts`.
- Expected behavior: UI should state which attachments were included, omitted, or truncated before the model sees the prompt.
- Actual behavior: Code marks truncation, but current UI does not surface it.
- Evidence: no screenshot; command output recorded `includesA=true`, `includesB=false`, `markerCount=1`, `attachmentTruncated=true`.
- Recommendation: Do not record or imply `Đã đọc` for omitted attachment content. Show per-file inclusion state.
- Timing: Before Skills
- Verification source: Inferred from code; not sent live.

#### PGUI-008 - Missing-credential send can enter an unclear running/not-connected state

- Classification: High functional UX
- Observation: With workspace selected and no credential, the composer allowed typing and send was enabled. After clicking send, later narrow-layout capture showed a draft conversation, `Đang xử lý`, service status `Chưa kết nối`, and footer detail `Shell chưa cung cấp base URL hoặc token.` No clear inline provider/credential recovery error appeared in transcript or activity.
- Reproduction steps: In clean profile with workspace selected and missing credential, type `Hello without credential`, click `Gửi`, then inspect shell after the failed transition.
- Expected behavior: Missing credential should fail fast with actionable settings recovery and leave the composer/session in a terminal usable state.
- Actual behavior: UI moved into an unclear in-progress/disconnected state.
- Evidence: `08b-missing-credential-send-error.png`, `09-narrow-high-dpi-layout.png`.
- Recommendation: Treat missing credential as a preflight readiness blocker before creating/running a conversation, or surface a terminal error with a direct settings action and recovery.
- Timing: Now
- Verification source: Observed directly in packaged UI.

#### PGUI-009 - Narrow/high-DPI layout hides the activity panel rather than compressing all columns

- Classification: Low
- Observation: At a narrow viewport with high-DPI emulation, sidebar and chat remain usable; right panel measured as zero-width / absent. Panel collapse control still changes state when present, but the narrow state needs a clearer user affordance if activity is hidden.
- Reproduction steps: Apply CDP device metrics `900x650`, `deviceScaleFactor=1.5`; capture layout; click activity collapse.
- Expected behavior: Narrow layout should prioritize chat while preserving an obvious way to view activity.
- Actual behavior: Chat gets priority, activity appears unavailable/zero-width in the measured layout.
- Evidence: `09-narrow-high-dpi-layout.png`, `09b-activity-panel-collapsed.png`.
- Recommendation: Before RC, decide whether narrow desktop needs a visible activity toggle/drawer. This is functional only if common laptop/DPI sizes hide activity without recovery.
- Timing: Before Release Candidate
- Verification source: Observed directly in packaged UI/DOM.

### Old Finding Status

| Prior finding | Status after packaged pass | Notes |
|---|---|---|
| Attachment dispatch-budget omission | Partially confirmed | Code path confirmed; not sent to live model. UI still does not expose included/omitted files. |
| `.env` allowed without warning | Confirmed by packaged UI | Fake `.env` accepted; no warning. |
| File-level truncation unreachable | Still code-only inference | Oversized file is rejected with error chip; no truncation observed. |
| HEAD wording in current-status | Superseded | Docs consolidation removed the moving HEAD field and lists verified slice commits instead. |
| L9 status wording | Superseded | Docs consolidation now states that partial packaged evidence exists while full L9 / release-candidate PASS is incomplete. |
| Workspace explorer not recommended | Confirmed by packaged UI | Workspace/attachment flows can start without explorer; no evidence that explorer is needed before RC. |
| Preview tab not recommended | Not verified for live file changes | No live tool/file preview flow was run; defer decision until live file-change flow is verified. |
| Rename/delete discoverability | Not verified | No persisted multi-conversation/live terminal flow was completed in this pass. |

### Product Decisions From This Pass

1. Minimal workspace explorer before RC: No. Defer. Current workspace picker/recent workspace/activity model is enough for MVP, and an explorer risks IDE-clone scope.
2. Separate Preview tab: No for now. Defer until live file-change preview is observed; right-panel contextual preview remains the smallest MVP surface.
3. Preview priority: tool-created/modified file preview first; attachment input preview second; arbitrary workspace file preview last/defer.
4. Before/after diff: before RC if file modification remains a core user-facing workflow; before Skills only if Skills will increase autonomous file edits.
5. `.env` and secret-like attachment policy: block by default now, with later explicit override if Product Owner wants power-user behavior.
6. Functional UX before Skills: attachment budget honesty, secret-file blocking, missing-credential preflight, settings modal focus, clearer hidden/continuation state.
7. Visual polish to leave until final: icons beyond file/status clarity, decorative animation, color/spacing refinement.
8. Next slice: Attachment honesty and safety remains the best next slice, with missing-credential preflight folded into release-gap hardening if it is small.

### Not Verified In This Pass

- Native OS folder picker and native OS file picker, because packaged E2E seams were used for deterministic fixture paths.
- Live streaming response, tool create/modify/delete, permission approve/deny, cancellation during live run, continuation after terminal run, invalid key/model/base-URL recovery, and historical activity after live file changes. These require confirmed live provider usage and should be run in a bounded live pass.
- Permission modal screenshot and file preview screenshot, because no live tool/file flow was executed.
