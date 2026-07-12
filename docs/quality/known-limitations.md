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

## Session & multi-turn

- **Một OpenCode runtime session = một lượt** — sau terminal, Cowork GHC tạo runtime turn mới liên kết cùng conversation; không re-prompt session đã terminal (OpenCode trả 409).
- **Reuse** cùng OpenCode session chỉ khi `canPrompt === true` và session chưa terminal.
- **Context continuity** dùng khối transcript bounded (~12k ký tự), deterministic — không phải native OpenCode `/continue`; có thể cắt bớt lượt cũ khi vượt budget.
- **Một runtime execution active** — không chạy song song nhiều OpenCode session cho cùng conversation.
- Sau relaunch app, conversation gần nhất được chọn lại; transcript hiển thị ngay; không tự khởi động OpenCode cho đến khi user gửi tin.
- Trạng thái `completed_without_final_message` khi tool hoàn tất nhưng runtime không trả text cuối; UI dùng fallback tiếng Việt.
- Grace window ngắn (~120ms service, ~200ms UI) cho token sau `session.idle`.
- Template re-run / workflow replay chưa có.
- Rename/delete qua context menu (chuột phải) — chưa có menu riêng trong sidebar.

## Release

- L9 release verification đầy đủ chưa bắt đầu.
- Packaged live deny/cancel recovery trong **cùng** conversation: unit test + `conversation-finalization-packaged.mjs` (conversation riêng cho deny); chưa có journey live riêng cho deny→next-turn trong `multi-turn-packaged.mjs`.

## Tính năng chưa có

- Skills chưa available trong GUI người dùng cuối.
- Attachments/context input chưa available (`Tệp đã đọc` chỉ từ tool read/list thật).
- Web support vẫn `DEFERRED`.

## UX

- GUI hiện là usable POC quality.
- Chưa claim parity với Claude Cowork hoặc OpenWork.
- Một số empty/error/loading states cần polish trước release candidate.
