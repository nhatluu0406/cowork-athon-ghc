---
language: "vi"
status: "active"
updated_at: "2026-07-17"
---

# Demo acceptance

Chỉ đánh dấu khi thao tác chạy trên packaged Windows app. Unit test hoặc assistant prose không đủ làm bằng chứng.

## Core demo

- [ ] Launch vào New Chat sạch.
- [ ] Theme light/dark hiển thị đúng và native titlebar đồng bộ.
- [ ] Provider đã cấu hình và trạng thái verified hiển thị đúng.
- [ ] Chọn workspace demo.
- [ ] Gửi prompt chat và nhận streaming response đọc được.
- [ ] Permission mode là `Hỏi trước`.
- [ ] File create request hiển thị Permission đúng action/path.
- [ ] File chưa tồn tại trước Allow.
- [ ] `Cho phép một lần` tạo file thật, đúng nội dung.
- [ ] Yêu cầu modify rồi Deny; file không đổi.
- [ ] Assistant không hiển thị internal tool/Skill narration.
- [x] Workspace tự refresh/open file liên quan sau Agent mutation. (PO-observed 2026-07-16)
- [ ] Reopen conversation và relaunch giữ history/configuration.

## Provider demo

- [ ] Add custom OpenAI-compatible connection.
- [ ] Save key triggers safe connection verification.
- [ ] Valid status persists across Settings navigation/relaunch according to policy.
- [ ] Model discovery works when `/models` is supported.
- [ ] Manual model ID remains available when discovery fails or is unsupported.

## Workspace demo

- [x] Text/Markdown opens and edits safely.
- [x] Code files (.py/.css/.cpp/.js/.ts/…) open with syntax highlight + line numbers; "Sửa" edits then Lưu.
- [x] PDF renders in packaged app (Chromium PDFium; default no-toolbar + fit-to-width; PO-observed 2026-07-16).
- [ ] Image/DOCX/XLSX safe preview states are clear.
- [x] **PPTX high-fidelity preview (packaged; PO-observed 2026-07-17):** slides render as actual
      slides with **embedded images**, layout, tables and charts (not a text list); prev/next +
      "Slide X / Y" navigation works. (Malformed/`.ppt` unsupported states + no-remote-traffic are
      covered by automated tests; images required adding `img-src ... blob:` to the CSP.)
- [x] **XLSX multi-sheet (packaged; PO-observed):** selector switches sheets without reloading the
      Workspace.
- [x] Agent file update refreshes current file without overwriting dirty edits (keep-mine / reload-from-disk).
- [x] Verified delete of the open file clears the preview and cannot recreate it.
- Note: verified delete VIA THE AGENT is blocked upstream — the pinned OpenCode build exposes no
  delete tool (see known-limitations), so this journey is only observable when the delete is verified.

## Code Phase 1 demo (multi-file editor — ADR 0013)

Implementation + focused UI tests + `build:app` PASS; the boxes below are the remaining **packaged
PO observation** gate (check only on the packaged Windows app).

- [ ] Rail/surface hiển thị nhãn **`Code`** (không còn `Claude Code`); không có chip "Chạy test/Commit".
- [ ] Chọn workspace → mở Code → Project Explorer hiện cây tệp của **cùng** active workspace.
- [ ] Mở ba tệp code/text thành ba tab; chuyển tab giữ nguyên nội dung từng tab.
- [ ] Sửa hai tệp (nút "Sửa" → textarea), dirty indicator hiện trên tab.
- [ ] Ctrl+S (hoặc "Lưu") ghi tệp thật qua route file được guard; dirty được xoá.
- [ ] Đóng một tab còn sửa chưa lưu → hộp thoại Lưu / Không lưu / Huỷ hoạt động đúng.
- [ ] Từ Workspace dùng **"Mở trong Code"**; từ Code dùng **"Xem trong Workspace"** → đúng tệp,
      active workspace không đổi.
- [ ] Agent sửa một tệp đang mở (clean) → tab tự tải lại từ đĩa.
- [ ] Agent sửa một tệp đang mở (dirty) → banner xung đột, giữ bản đang sửa.
- [ ] Verified delete tệp đang mở → tab vào trạng thái "đã xóa", không recreate.
- [ ] Đổi workspace → tab Code reset đúng theo workspace mới.
- [ ] Quay lại Cowork chat → chat/transcript không regression.
- Note: PDF/Office/ảnh trong Code hiển thị trạng thái chỉ đọc + "Xem trong Workspace" (không dựng lại
  viewer). Terminal/Git/test runner/dev-server **không** thuộc Phase 1.

## Code Slice 1 demo (runtime web preview + UI redesign — ADR 0014)

Code/tests/`build:app` PASS; các ô dưới là **packaged PO observation** còn lại (chỉ tích trên
packaged Windows app). Desktop app launch **không** thuộc slice này (Slice 2).

- [ ] Surface Code: không còn hai tab "Phiên làm việc/Cách hoạt động"; bố cục Explorer | Editor/
      Preview | Agent; header gọn + workspace badge + runtime status; light/dark khớp Workspace.
- [ ] Panel Agent dùng composer kiểu Cowork, gửi vào cùng phiên; thu gọn/mở lại được.
- [ ] **Static:** mở workspace có `index.html` → chế độ Preview → Chạy → trang tĩnh hiển thị nhúng.
- [ ] **Dev server:** dự án frontend → Chạy → hộp thoại **Cho phép/Từ chối** hiện đúng lệnh + cwd;
      Cho phép → dev server chạy, phát hiện localhost, trang hiển thị trong app.
- [ ] **Deny:** Từ chối → không có tiến trình nào chạy; trạng thái trung thực.
- [ ] **Restart sau crash:** dừng/giết dev server → Khởi động lại hoạt động.
- [ ] **Port đã bị chiếm / lệnh sai / package manager thiếu / package.json hỏng** → trạng thái lỗi
      rõ ràng, không crash renderer, không giả "running".
- [ ] **Đổi workspace khi preview đang chạy** → tiến trình bị dừng, preview reset theo workspace mới.
- [ ] **Đóng Cowork GHC** khi preview đang chạy → xác nhận **không còn tiến trình con** (tree-kill).
- [ ] Output log hiển thị (đã redact); Output | Problems chuyển tab được.
- [ ] Không điều hướng ra remote origin / không popup / không download từ trang preview.
- [ ] Agent sửa code của dự án đang preview → làm mới/không mất dirty đúng như multi-file editor.
- Note: nhúng bằng WebContentsView (giữ CSP renderer). Desktop app launch là Slice 2.
- **Acceptance Slice 1 (tự động, đã chạy trên máy này):** test tiến trình **thật**
  (`service/tests/runtime-preview-real-process.test.ts`, Windows-only) dựng thật
  `cmd.exe → npm → node → cháu`, rồi kiểm chứng: đạt `running` với **env curated** (rớt provider/vault
  secret, giữ PATH + steering), **redact** token/Authorization/URL-userinfo trong Output, **stop
  không để mồ côi** (cả cây bị taskkill), và script crash → `failed`. Bộ test này **phát hiện một lỗi
  mồ côi thật** (graceful-kill riêng `cmd.exe` bỏ mồ côi cây con) và lỗi đã được **sửa** (tree-first
  termination). Fixtures cho các bước PO ở trên: xem `po-fixtures/` (README kèm bảng ánh xạ).
  Các ô [ ] còn lại vẫn cần **PO quan sát trên packaged app** (render, dialog, Task Manager).

## Settings / Skills / Inspector

- [ ] Provider actions are understandable without button clutter.
- [ ] Skills create/edit/delete/enable happy path works.
- [x] Inspector Plan/Activity/File Review display useful data or intentional empty state. (PO-observed 2026-07-17; Cowork-only; no raw runtime payloads.)
- [ ] No tooltip clipping at titlebar or sidebar boundaries.
- [ ] No unnecessary page-level scrollbar at 1366×768.

## Diagnostics (Wave 6; PO-observed 2026-07-17)

- [x] Logging: enable "Ghi log chi tiết", perform activity, log size grows; Export writes a file via
      the native save dialog; Clear resets the size.
- [x] Telemetry: enable "Telemetry cục bộ", perform activity, counters increment; Export; Clear resets
      them; disabling telemetry stops new counts.
- [x] Export safety: the exported JSON holds only aggregate counters + logging status — no API keys,
      prompts, document content, paths, or raw runtime events.

## Not demo blockers

- File delete review.
- D1–D4 backend capability before team merge.
- Full Office-grade editing.
- Cloud multi-user authentication.
- Full RC/signing/updater.
