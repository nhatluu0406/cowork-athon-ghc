---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Cowork GHC Product Plan

Tai lieu nay la active product plan duy nhat cho Cowork GHC. Cac tai lieu cu
`cowork-ghc-scope-and-acceptance.md` va `cowork-ghc-master-plan.md` chi con la
lich su de doi chieu.

## 1. Product Vision

Cowork GHC la mot ung dung desktop Windows local-first cho nguoi dung lam viec
voi mot AI coworker trong workspace tren may cua minh. Nguoi dung chon mot thu
muc local, cau hinh LLM endpoint cua rieng minh, tro chuyen voi agent, va cho
phep agent doc hoac thay doi file khi can.

Gia tri cot loi la mot vong lap lam viec ro rang va co kiem soat: workspace la
trung tam, credential nam trong Windows keyring, moi hanh dong file/tool co
permission boundary, va UI phai noi trung thuc agent dang lam gi. Cowork GHC
cung lop trai nghiem voi Claude Cowork/OpenWork, nhung khong claim parity va
khong clone truc tiep bat ky san pham nao.

## 2. Product Principles

- Local-first: du lieu workspace va product state mac dinh nam tren may nguoi dung.
- Windows-first: packaged Windows desktop app la acceptance surface hien tai.
- Replaceable provider: DeepSeek chi la provider test hien tai; core flow khong
  phu thuoc vinh vien vao mot endpoint.
- Permission before mutation: doc context khong duoc bien thanh quyen sua/xoa file.
- Secure credential storage: provider keys nam trong Windows keyring, khong vao
  docs, logs, screenshots, transcript, localStorage, hay Git.
- Bounded context: prior turns va attachments di qua envelope untrusted co budget.
- Honest UI state: khong hien thi ready/done/read/sent neu state do chua duoc
  verified.
- Packaged acceptance: user-facing acceptance uu tien packaged app hon dev server.
- Sequential LEAN development: mot implementation Agent lam viec tren working tree
  tai mot thoi diem, slice nho, test tap trung.
- Git + docs la source of truth: commit la checkpoint, `.loop-engineer/` chi la
  provenance maintenance-only.

## 3. Current Verified Baseline

| Capability | Status | Evidence / note |
|---|---|---|
| Service lifecycle | Packaged verified | `poc-v0.1`; release regression and packaged smoke evidence exist. |
| Workspace selection | Packaged verified | Workspace picker/recent workspace implemented; latest audit used E2E picker seam, native picker still needs true manual pass. |
| Provider/model/keyring | Packaged verified, with UX gap | Windows keyring/provider recovery evidence exists; latest interactive pass found missing-credential preflight UX gap. |
| OpenCode runtime | Packaged verified | Current runtime is OpenCode; replaceable runtime endpoint remains architectural boundary. |
| Streaming | Packaged verified | Prior packaged evidence; latest UX pass did not run live streaming. |
| Permissions | Packaged verified, not latest-live verified | Allow/Deny and deny-next-turn packaged evidence exists; latest UX pass did not re-run permission modal live. |
| Cancellation | Packaged verified, not latest-live verified | Prior packaged acceptance; latest UX pass did not re-run cancel live. |
| Process cleanup | Packaged verified | No orphan Cowork/OpenCode process observed after latest packaged pass. |
| Conversations | Packaged verified | Persistence, sidebar, search, rename/delete via context menu documented. |
| Multi-turn context | Packaged verified | Cowork conversation links multiple OpenCode runtime turns; not native OpenCode continuation after terminal. |
| Context isolation | Packaged verified | `e40dada` and related packaged tests verify no wrapper leak in new flow. |
| Tool activity | Packaged verified, partially latest-live verified | Activity timeline exists; latest UX pass did not run live tool flow. |
| File changes | Automated verified and packaged verified, partial UX | File-change panel/current preview exists; full before/after diff not implemented. |
| Attachments Phase 1 | Packaged verified with blockers | Text files in workspace, chips, errors, metadata, no raw-content persistence; budget honesty and secret-like policy remain blockers. |
| Skills | Not started | GUI-visible capability is not available to end users. |
| Installer/release | Partially verified | Packaged POC exists; full installed artifact/keyring/native picker/live GUI release lifecycle not complete. |
| Web / Next.js | Deferred | Do not start now. |

## 4. Current Architecture

```text
Electron renderer
-> preload/shell bridge
-> local service
-> OpenCode runtime
-> replaceable LLM endpoint
```

The renderer owns the GUI, not filesystem mutation. The preload/shell bridge exposes
narrow desktop capabilities. The local service owns product logic, workspace guards,
conversation state, provider settings, and runtime orchestration. OpenCode is the
current agent runtime. The LLM endpoint is provider-replaceable.

A Cowork conversation is the long-lived product identity: transcript, workspace,
provider/model, activity, file-change and permission history. It may contain multiple
linked OpenCode runtime turns. When an OpenCode runtime session is terminal, Cowork
GHC creates a new linked runtime turn and sends bounded untrusted context; it does not
claim native OpenCode continuation after terminal.

## 5. Current UX Baseline

- Application shell: packaged Electron desktop shell with local service readiness and
  provider/model status.
- Conversation sidebar: persisted conversations, search, switch, context-menu rename/delete.
- Workspace selection: choose active workspace, show current/recent workspace.
- Provider settings: topbar model/status opens provider configuration and keyring state.
- Composer: prompt entry, send/cancel states, attachment button gated by workspace.
- Attachments: Phase 1 text-file chips, remove, oversized/unsupported error chips,
  metadata persistence.
- Activity panel: tool/activity timeline, permission history, file-change summary.
- Permission presentation: Allow/Deny modal exists from prior packaged evidence.
- File preview: bounded text preview for file-change/current content; no full diff.
- Historical continuation: saved conversation can be reopened and continued through a
  new linked runtime turn when needed.

The UI is functional POC quality. It is not release-candidate polish.

## 6. Known Product Gaps

- Attachment dispatch-budget honesty: UI does not show which accepted files were
  actually included, omitted, or truncated in the 12k dispatch prompt budget.
- Secret-like attachments: `.env` is accepted without warning; `.pem`, `.key`, and
  credential-like files need policy.
- Missing-credential preflight: latest packaged UI allowed send and entered an unclear
  running/not-connected state.
- Settings modal focus: modal opened with focus observed on `BODY`.
- Continuation controls in empty-state DOM: continuation wording exists in DOM before
  a historical terminal conversation is selected.
- Activity visibility at narrow/high-DPI: chat remains usable, but activity panel can
  effectively disappear without a clear access affordance.
- Live tool/file/permission GUI verification: not complete in latest interactive pass.
- Native picker: not directly verified in latest pass; deterministic E2E picker seam was used.
- Full before/after diff: not implemented.
- Skills: not available to end users.
- Full installer/release lifecycle: installed artifact, native picker, installed keyring,
  live streaming/tools/permissions/cancel/recovery/relaunch, high-DPI and keyboard pass
  are not all complete in one release-candidate pass.

## 7. Product Roadmap

### Phase A - Safety and Functional Honesty

Entry condition: current packaged POC baseline is clean and docs agree on next slice.

Work:
- attachment included/omitted budget presentation;
- secret-like file policy;
- missing credential preflight;
- clean terminal/error recovery;
- small settings and empty-state accessibility fixes.

Exit acceptance: packaged app shows honest attachment inclusion state, blocks or clearly
handles secret-like files, fails fast on missing credentials, and no longer exposes known
empty-state/focus confusion.

### Phase B - Skills Foundation

Entry condition: Phase A exits with packaged evidence.

Work:
- Skills data model;
- local Skills discovery;
- enable/disable;
- prompt/runtime integration;
- permissions and provenance;
- packaged verification.

Exit acceptance: at least one local Skill can be discovered, enabled, used in a packaged
journey, disabled, and audited/provenanced without marketplace or cloud scope.

### Phase C - File Work Review

Entry condition: Skills or baseline agent flow can perform meaningful file work.

Work:
- contextual preview;
- create/modify/delete presentation;
- before/after diff;
- attachment read versus runtime read distinction;
- audit visibility.

Exit acceptance: user can understand what file was read, created, modified, or deleted,
what changed, and which action was user-approved.

### Phase D - Context Expansion

Entry condition: product need is explicit and Phase A attachment honesty is complete.

Work, only as needed:
- folder context;
- PDF;
- image;
- Office document;
- drag-and-drop.

Exit acceptance: each added context type has bounded size/type validation, workspace
guarding, metadata semantics, and packaged verification. Do not build all by default.

### Phase E - Full Packaged Release Verification

Entry condition: release-candidate feature surface is frozen for a pass.

Work:
- live streaming;
- tools;
- permission approve/deny;
- cancellation;
- provider recovery;
- continuation;
- relaunch;
- installed keyring;
- process cleanup;
- native picker;
- high-DPI and keyboard pass.

Exit acceptance: one documented packaged journey distinguishes direct manual/native/live
observations from automation-only evidence and leaves no orphan processes.

### Phase F - Final UX Polish

Entry condition: functional states are honest and release-blocking UX gaps are closed.

Work:
- icons serving file/status/action recognition;
- minimal functional animation for streaming/tool/cancel/loading;
- spacing, typography, color;
- empty/loading/error state consistency.

Exit acceptance: polish improves comprehension without adding decorative motion or new
feature scope.

### Phase G - Distribution

Entry condition: release-candidate verification is green enough to package for users.

Work:
- installer;
- versioning;
- upgrade;
- uninstall;
- migration;
- release candidate.

Exit acceptance: install, upgrade, uninstall, keyring, workspace state, and cleanup behavior
are verified on Windows with no secret or user-data leakage.

## 8. Explicit Non-Goals

- Do not restore the full Loop Engineer workflow.
- Do not use default fan-out/subagents for implementation.
- Do not turn Cowork GHC into an IDE clone.
- Do not build a full workspace explorer before evidence shows product need.
- Do not add a universal Preview tab in MVP.
- Do not start web/Next.js now.
- Do not add cloud sync or multi-user mode.
- Do not build marketplace/cloud in Skills foundation.
- Do not inherit OpenWork features unless Cowork GHC product ownership explicitly accepts them.

## 9. Product Owner Decisions

| Decision | Current recommendation |
|---|---|
| Workspace explorer | Defer. Picker + recent workspace + activity/file preview are enough for MVP. |
| Separate Preview tab | Defer. Use contextual right-panel preview first. |
| Preview priority | Tool-created/modified files first; attachment input second; arbitrary workspace file preview last/defer. |
| `.env`, `.pem`, `.key`, credential-like files | Block by default for MVP; consider explicit override later. |
| Before/after diff | Required before release candidate; earlier if Skills increases file edits. |
| Template/workflow replay | Requires Product Owner decision; not a prerequisite for Skills foundation unless explicitly chosen. |
| User-visible durable audit | Requires Product Owner decision; local/internal audit expectation remains important. |

## 10. Development Operating Model

- One implementation Agent works on the tree at a time.
- Cursor is the next implementation Agent after this documentation handoff.
- Codex is used for review, audit, takeover, or verification when working tree is clean.
- Claude Code may be used for focused review, not broad fan-out.
- Git commit is the checkpoint; do not rely on checkpoint/task state in `.loop-engineer/`.
- Manual packaged observation overrides automated reports when they conflict.
- Large GUI polish is intentionally near the end, after functional truth is solid.
- Do not push remote unless the Product Owner asks.

## 11. Reconciliation of Older Claude Plans

| Requirement / theme from old plans | Classification | Active handling |
|---|---|---|
| Local Windows desktop app | Carried into active product plan | Product vision, principles, architecture, roadmap. |
| Workspace picker, recent workspace, path confinement | Carried into active product plan | Baseline + Phase E native picker verification; explorer deferred. |
| Permissioned file/tool actions | Carried into active product plan | Principle and Phase C/E verification. |
| Provider-neutral model with Windows keyring | Carried into active product plan | Principles, architecture, baseline, Phase E. |
| Conversation persistence and multi-turn | Already completed | Baseline notes Cowork linked runtime turns. |
| Streaming, cancellation, provider recovery | Already completed / partially latest-verified | Baseline preserves prior packaged evidence; Phase E requires full latest live pass. |
| Tool activity and file mutations | Already completed / still planned for review quality | Existing panel plus Phase C diff/audit improvements. |
| Local audit events | Still planned | Product Owner decision for user-visible durable audit; audit visibility in Phase C. |
| Skills / runtime extension | Still planned | Phase B, without marketplace/cloud. |
| MCP/plugins | Deferred | Not in next Skills foundation unless Product Owner prioritizes. |
| Template/workflow replay | Requires Product Owner decision | Explicit open decision. |
| Folder/image/PDF/Office/drag-drop context | Deferred | Phase D only when product need is explicit. |
| Web/Next.js | Deferred | Explicit non-goal now. |
| Remote/multi-user/cloud/enterprise | Obsolete for current product | Non-goal. |
| Loop Engineer L1-L10 execution model | Superseded | Git + docs + LEAN single-agent model replaces it. |
| VS-01..VS-15 task graph | Superseded | Active roadmap phases A-G replace old task graph. |
| OpenWork as source spec | Superseded | Research reference only, not source of truth. |
| Full IDE-style workspace explorer | Deferred | Not recommended before RC. |
