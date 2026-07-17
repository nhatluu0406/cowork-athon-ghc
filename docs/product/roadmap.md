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

## WAVE 7 — Code Phase 1: Shared Workspace Multi-File Editor (PLANNED — ADR 0013)

Kiến trúc chốt **Hybrid**: `Code` là project/developer-centric, giữ surface riêng nhưng **dùng chung
hoàn toàn** backend với Workspace (một active workspace, `WorkspaceGuard`, `PermissionGate`,
`SessionService`, một OpenCode runtime). Không backend/session/runtime riêng cho Code.

- [ ] Đổi product label "Claude Code" → "Code" (item đầu tiên; registry + code-view + panel + onboarding + focused UI test).
- [ ] Shared active workspace (dùng lại `settingsStore.activeWorkspace()`).
- [ ] Project explorer (dùng chung navigator, hợp nhất state để không mount lệch).
- [ ] Multi-tab code editor với save/dirty/conflict (promote logic companion + `PUT /v1/workspace/file-content`).
- [ ] Close/reopen tabs.
- [ ] Workspace ↔ Code handoff (`Mở trong Code` / `Xem trong Workspace`).
- [ ] Active-file làm Agent context.
- [ ] Verified Agent mutation refresh (dùng lại File Work Review evidence).
- [ ] Syntax highlighting.
- [ ] Gỡ chip/nhãn hứa terminal/git/test cho tới khi runtime hỗ trợ.

Deferred (không thuộc Phase 1): terminal/PTY; Git UI; debugger; language server phức tạp;
dev-server; runtime web preview; desktop app launch; extension marketplace.

Web/App preview taxonomy (ADR 0013): **File preview** (bounded local, có thể làm Later trong Code) ≠
**Runtime web preview** (dev-server/port, deferred) ≠ **Desktop app launch** (process riêng, deferred).

## WAITING

- [ ] D1 Dispatch integration.
- [ ] D2 Microsoft 365 product acceptance.
- [ ] D3 Knowledge/RAG integration.
- [ ] D4 Gateway integration.

## DEFERRED

- [ ] MCP OAuth token ownership.
- [ ] Cloud/multi-user authentication.
- [ ] Full Office editing.
- [ ] Web/Next.js.
