---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Known limitations

## Activity & file changes

- Timeline dựa trên EV kinds quan sát được (`tool_call`, `file_mutation`, `step`, `progress`, `terminal`, `error`) — không hiển thị token model như tool.
- File-change panel chỉ liệt kê thay đổi từ `file_mutation` (tool write/edit hoàn thành), không quét toàn workspace.
- Preview tệp: văn bản bounded (64KB), từ chối binary/traversal/symlink escape; **không** có unified diff before/after cho file sửa trong slice này.
- Activity lịch sử không replay animation live khi mở lại conversation.
- OpenCode `permission.asked` / `permission.replied` không map sang timeline — quyền qua API Cowork + modal.

## Session

- **Tiếp tục** (cùng OpenCode session ID) chỉ khả dụng khi runtime session chưa terminal và service có thể `continueSession`. Sau relaunch app, thường cần **tạo phiên tiếp nối** để gửi prompt mới.
- POC vẫn **single-turn per OpenCode runtime session** — re-prompt cùng session sau terminal trả HTTP 409; UI tạo runtime session mới liên kết cùng Cowork conversation.
- Không hỗ trợ nhiều runtime session chạy song song.
- Template re-run / workflow replay chưa có.
- Rename/delete qua context menu (chuột phải) — chưa có menu riêng trong sidebar.

## Release

- L9 release verification đầy đủ chưa bắt đầu.
- Regression packaged đầy đủ (permission + file + interruption) không chạy mặc định sau mỗi thay đổi nhỏ — dùng `verify:release` + `session-management-packaged.mjs`.

## Tính năng chưa có

- Skills chưa available trong GUI người dùng cuối.
- Attachments/context input chưa available (`Tệp đã đọc` chỉ từ tool read/list thật).
- Web support vẫn `DEFERRED`.

## UX

- GUI hiện là usable POC quality.
- Chưa claim parity với Claude Cowork hoặc OpenWork.
- Một số empty/error/loading states cần polish trước release candidate.
