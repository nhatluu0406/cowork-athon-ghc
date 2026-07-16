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

## Settings / Skills / Inspector

- [ ] Provider actions are understandable without button clutter.
- [ ] Skills create/edit/delete/enable happy path works.
- [ ] Inspector Plan/Activity/File Review display useful data or intentional empty state.
- [ ] No tooltip clipping at titlebar or sidebar boundaries.
- [ ] No unnecessary page-level scrollbar at 1366×768.

## Not demo blockers

- File delete review.
- D1–D4 backend capability before team merge.
- Full Office-grade editing.
- Cloud multi-user authentication.
- Full RC/signing/updater.
