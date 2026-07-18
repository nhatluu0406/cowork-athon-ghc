---
language: "vi"
status: "active"
updated_at: "2026-07-17"
---

# Roadmap V2 — basic-first, one wave at a time

## WAVE 0A — Local database, app lock and encrypted credentials

- [x] Add SQLite adapter and migrations.
- [x] Implement first-run local account + unlock.
- [x] Implement wrapped vault master key and encrypted secret table.
- [x] Migrate provider and MS365 keys from Windows Credential Manager.
- [x] Move settings/provider profiles/verification state to SQLite.
- [x] Remove keyring dependency only after packaged migration PASS.

## WAVE 0B — Conversation/session persistence migration

- [x] Move conversation summaries/messages/provider snapshots to SQLite.
- [x] Preserve rename/delete/search/reopen behavior.
- [x] Store durable turn summaries, not raw token deltas.
- [x] Import existing `.runtime/conversations`.
- [x] Keep File Work Review snapshots on filesystem with DB references.
- [x] Remove legacy JSON writes after migration PASS.

## WAVE 1 — Chat, Provider UX, Tooltip, Sidebar, Brand and latency truth

- [ ] Refine user/assistant message surfaces.
- [ ] Keep tool/Skill/runtime internals out of visible transcript.
- [ ] Simplify provider actions and verified state.
- [ ] Fix tooltip clipping and sidebar spacing.
- [ ] Render real Cowork logo in topbar/taskbar identity.
- [ ] Benchmark one chat/create/modify turn by timing stage.
- [ ] Do not upgrade OpenCode until timing baseline exists.

## WAVE 2 — OpenCode compatibility + Kỹ năng & MCP Hub

- [x] Test OpenCode 1.18.1 compatibility; fallback target 1.17.20.
- [x] Add `Kỹ năng & MCP` rail surface below Cowork.
- [x] Remove Skills from Settings.
- [x] Remove Skill/MCP selectors from Cowork/Workspace composer.
- [x] Show active summary only in Cowork/Workspace.
- [x] Use OpenCode native Skill load-on-demand.
- [x] Add persistent MCP config and live adapter.
- [x] Phase 1 MCP: local/remote + static encrypted API headers, no OAuth.

## WAVE 3 — Provider model discovery

- [ ] Safe OpenAI-compatible `GET /models`.
- [ ] Searchable combobox.
- [ ] Manual model ID fallback.
- [ ] Cache/invalidate by target fingerprint.
- [ ] Never block save when discovery unsupported.

## WAVE 4 — Workspace PDF and live refresh

- [x] Packaged PDF preview. (Chromium PDFium; default no-toolbar + fit-to-width. Needed:
      `plugins:true`, `style-src 'unsafe-inline'`, and exempting `chrome-extension://` from the
      CSP header stamp so the built-in viewer keeps its own policy.)
- [x] Auto-refresh tree after verified mutation.
- [x] Auto-open created/modified file when safe (≤1 file per turn; never outside-workspace/secret/unsupported/over a dirty buffer).
- [x] Dirty-edit conflict UX (keep-mine + persistent overwrite warning / reload-from-disk warns of edit loss).
- [x] Explicit current-file context in companion chat.
- [x] Verified-delete of the open file clears the preview and blocks accidental recreate.
- [x] Code-file viewing: syntax highlight (highlight.js) + line numbers, read-only with an edit toggle.
- [x] Office preview (bounded follow-up): read-only multi-sheet `.xlsx` navigation (visible-sheet
      tabs, hidden sheets filtered, read-only).
- [x] Office preview — high-fidelity `.pptx` (packaged PO-observed 2026-07-17, incl. embedded images):
      read-only slide rendering (text/images/shapes/tables/charts/theme as HTML/SVG) via a local,
      CSP-safe engine (`@aiden0z/pptx-renderer`, Apache-2.0), prev/next + "Slide X / Y", fit-to-panel,
      degrades to a text-first fallback on failure. `.ppt` legacy unsupported; animation/macro/OLE/
      media/EMF not rendered; malformed/encrypted/>8 MiB → unsupported. No Office editor, no
      cloud/LibreOffice conversion, no full fidelity.

## WAVE 5 — Inspector Phase 1 (PO-observed 2026-07-17)

- [x] Kế hoạch. (Cowork-only pane; folded from normalized `plan` EV events.)
- [x] Hoạt động. (Normalized EV timeline; token/SSE/raw frames never reach the renderer.)
- [x] Tệp / File Work Review. (Reuses the one verified-mutation File Work Review engine.)
- [x] No raw runtime payloads. (Server-side EV mapper/reducer; renderer sees folded shapes only.)
- [x] Clear loading/error/empty states + persistence across reopen.

## WAVE 6 — Logging and local telemetry (PO-observed 2026-07-17)

- [x] Detailed local structured logs with rotation/redaction. (Rotating JSON-lines file sink under
      `data/logs`; every record scrubbed before disk; "Ghi log chi tiết" drives service debug logs.)
- [x] Local-only aggregate telemetry. (SQLite counters, migration id 3; fixed allowlist; toggle
      gates collection; counts structural facts only — no content/paths/prompts/credentials.)
- [x] Export/clear actions. (`/v1/diagnostics` + shell save-dialog IPC; redacted export bundle;
      per-target clear with confirmation in Settings → Chẩn đoán.)
- [x] No network telemetry. (No egress anywhere in the diagnostics modules.)
- [x] Diagnostics documentation and acceptance.

## WAVE 7 — Code Phase 1: Shared Workspace Multi-File Editor (code/tests/build PASS — packaged PO obs pending; ADR 0013)

Kiến trúc chốt **Hybrid**: `Code` là project/developer-centric, giữ surface riêng nhưng **dùng chung
hoàn toàn** backend với Workspace (một active workspace, `WorkspaceGuard`, `PermissionGate`,
`SessionService`, một OpenCode runtime). Không backend/session/runtime riêng cho Code.

- [x] Đổi product label "Claude Code" → "Code" (registry + rail + code-view + panel + onboarding + focused UI test).
- [x] Shared active workspace (dùng lại `settingsStore.activeWorkspace()`; không có store thứ hai).
- [x] Project explorer (dùng chung `mountWorkspaceNavigator`).
- [x] Multi-tab code editor với save/dirty/conflict (controller `mountCodeEditor` promote logic companion + `PUT /v1/workspace/file-content`).
- [x] Close/reopen tabs (đóng-khi-dirty có hộp thoại Lưu/Không lưu/Huỷ).
- [x] Workspace ↔ Code handoff (`Mở trong Code` / `Xem trong Workspace`).
- [x] Active-file làm Agent context (workspace-relative; không nhồi full-tree/nội dung).
- [x] Verified Agent mutation refresh (dùng lại File Work Review evidence; reload/xung đột/deleted).
- [x] Syntax highlighting (highlight.js, bỏ qua khi > 256 KiB).
- [x] Gỡ chip/nhãn hứa terminal/git/test.

Trạng thái: focused UI tests (68/68) + `npm run typecheck` + `npm run build:app` PASS. Còn lại
**packaged PO observation** (14 bước ở `docs/quality/demo-acceptance.md`) trước khi claim WORKS.

Deferred (không thuộc Phase 1): terminal/PTY; Git UI; debugger; language server phức tạp;
dev-server; runtime web preview; desktop app launch; extension marketplace. Đổi workspace khi Code
còn tab dirty sẽ **reset** (bỏ sửa chưa lưu) — như companion Workspace; pre-switch guard là việc sau.

Web/App preview taxonomy (ADR 0013): **File preview** (bounded local, có thể làm Later trong Code) ≠
**Runtime web preview** (dev-server/port, deferred) ≠ **Desktop app launch** (process riêng, deferred).

## WAVE 8 — Code Slice 1: Runtime web preview + UI redesign (code/tests/build PASS — packaged PO obs pending; ADR 0014)

Mở khoá phần **Runtime web preview** mà ADR 0013 defer. Giữ Hybrid (dùng chung
workspace/backend/session/permission với Cowork); **desktop app launch defer sang Slice 2**.

- [x] Thiết kế lại UI Code theo visual system Workspace (token `--cghc-*`, dark mode); bỏ hai tab
      "Phiên làm việc/Cách hoạt động" + onboarding tab; bố cục Explorer | Editor/Preview | Agent;
      chế độ **Code/Preview**; Output drawer (Output | Problems); panel Agent theo composer Cowork,
      thu gọn được; header gọn + workspace badge + runtime status.
- [x] Bounded process runner trong service (`runtime-preview/`): static loopback server (confined,
      no-command) + dev-server (`<pm> run <script>` allowlist + validate, env curated không secret,
      dò port, timeout, graceful-then-tree-kill, dọn khi đổi workspace/tắt service).
- [x] **Permission bắt buộc** cho mọi lần chạy lệnh dev-server (PermissionGate riêng, chạy chỉ trong
      `proceed` sau Allow; Deny/timeout không spawn); output redact + bounded; telemetry counters.
- [x] Nhúng bằng **WebContentsView hardened** (giữ CSP renderer, chỉ loopback, chặn remote-nav/
      popup/download/webview, no preload, session in-memory); IPC typed hẹp; ẩn dưới modal/Settings.
- [x] Active preview URL vào Agent context (loopback URL, không nội dung trang).

Trạng thái: focused UI + service tests + `npm run typecheck` + `npm run build:app` PASS. Còn lại
**packaged PO observation** (xem `docs/quality/demo-acceptance.md`) trước khi claim WORKS.

Deferred (Slice 2): **Desktop app launch** (build/launch process riêng, status/output, stop/restart)
— dùng lại runner + permission + tree-kill. Terminal/PTY, Git UI, debugger, LSP vẫn defer.

## WAVE 9 — Code Slice 2: Desktop app launch (code/tests/build PASS — packaged PO obs pending; ADR 0015)

Mở khoá phần **Desktop app launch** mà ADR 0013/0014 defer. **Tái dùng runner Slice 1** (không tạo
process manager thứ hai): tách `terminateChildTree` dùng chung; `runtime-app/` là AppService mỏng
trên cùng spawner/output-buffer/launch-policy/permission-gate/WorkspaceGuard.

- [x] Contracts `runtime-app` (kind Electron; status stopped/building/starting/running/failed/
      stopping; detect/state/output/start-input).
- [x] `app-detector` trung thực: chỉ nhận **Electron** (dependency `electron` + script chạy);
      malformed/no-script/không-Electron → `unsupported` kèm lý do.
- [x] `app-service`: build|run state machine, readiness theo thời gian (running = tiến trình còn
      sống qua cửa sổ readiness), launch **cửa sổ/tiến trình riêng** (không nhúng), stop/restart
      **tree-kill không mồ côi**, dọn khi đổi workspace/tắt service; **permission bắt buộc** mỗi
      Build/Run (chỉ chạy trong `proceed` sau Allow; Deny/timeout không spawn); cwd confined; env
      curated không secret; output redact + bounded.
- [x] Router `/v1/runtime-app/*` token-guarded + wiring compose-service/compose-live/types; telemetry
      counters `app_*` (bảng generic, không migration).
- [x] UI: selector **Web / Ứng dụng** (chỉ hiện ở Preview), pane app (Build/Run/Stop/Restart +
      trạng thái + elapsed + Output drawer dùng chung), confirm Allow/Deny mỗi Build/Run; app-shell
      wiring + reset khi đổi workspace.
- [x] Tests: detector (7) + service lifecycle/permission/security (15) + **real-process** (3, dựng
      thật cmd→npm→node→cháu: env curated, redaction, tree-kill không mồ côi, build/crash) + UI (6).

Trạng thái: focused UI + service tests + `npm run typecheck` + `verify-fast` + `npm run build:app` +
`npm run package:win` PASS; **không có test service/UI mới thất bại** (branch == baseline `main`).
Còn lại **packaged PO observation** (xem `docs/quality/demo-acceptance.md`) trước khi claim WORKS.

Deferred: terminal/PTY, Git UI, debugger, LSP; app không phải Electron; mở "thư mục đầu ra"
(chưa có safe shell contract).

## WAITING

- [x] D1 Dispatch integration — wired into main (pairing + board + gate); `start.bat` bật cho demo.
      Live phone round-trip chưa quan sát (WIRED — LIVE DEVICE UNVERIFIED).
- [ ] D2 Microsoft 365 product acceptance.
- [x] D3 **Local** Knowledge Base + Graph MVP — **kho tri thức thống nhất theo active Workspace**
      (SQLite FTS5 + deterministic graph; provenance badge + bộ lọc nguồn; chỉ 2 tab `Kho tri thức`/
      `Đồ thị`, không tab nguồn; code+tests+build PASS, **data-rich packaged acceptance PASS** qua UI
      audit 21/21 / 33 ảnh với seed workspace cô lập — index/list/search/graph/prune/clear, 2026-07-18).
      Microsoft 365 = nguồn bổ sung tương lai với
      readiness trung thực (không fake data/network); contracts sẵn sàng ingest vào cùng kho.
      Deferred: embeddings/semantic (needs `llm-svc`, LF-3), PDF text, external M365KG/Neo4j path,
      MS365 ingestion thật.
- [ ] D3 M365 Knowledge Graph (PR #13) — **bảo tồn ở branch `experimental/m365-knowledge-graph`**
      (tag `m365-kg-pr13-integration-2026-07`), default OFF, không start trong packaged app. Blocker:
      source `llm-svc` vắng mặt + chưa orchestration/package verification. Exhibition Knowledge dùng
      **SQLite Local KB** ở trên (`feature/local-knowledge-mvp`).
- [ ] D4 Gateway integration.

## DEFERRED

- [ ] MCP OAuth token ownership.
- [ ] Cloud/multi-user authentication.
- [ ] Full Office editing.
- [ ] Web/Next.js.
