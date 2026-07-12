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
- **Context continuity** dùng envelope nội bộ bounded (~12k ký tự), đánh dấu untrusted — không phải native OpenCode `/continue`; có thể cắt bớt lượt cũ khi vượt budget.
- Transcript cũ có thể chứa wrapper leak từ slice trước; `stripTransportArtifacts` dọn khi hiển thị/persist mới và loại khỏi context tương lai — **không** rewrite hàng loạt history cũ.
- **Một runtime execution active** — không chạy song song nhiều OpenCode session cho cùng conversation.
- Sau relaunch app, conversation gần nhất được chọn lại; transcript hiển thị ngay; không tự khởi động OpenCode cho đến khi user gửi tin.
- Trạng thái `completed_without_final_message` khi tool hoàn tất nhưng runtime không trả text cuối; UI dùng fallback tiếng Việt.
- Grace window ngắn (~120ms service, ~200ms UI) cho token sau `session.idle`.
- Template re-run / workflow replay chưa có.
- Rename/delete qua context menu (chuột phải) — chưa có menu riêng trong sidebar.

## Release

- Full L9 / release-candidate verification PASS is incomplete. Partial packaged evidence exists, but the latest interactive UX pass did not complete live streaming/tool/file/permission/cancel/provider-recovery/native-picker journeys in one release-candidate run.
- Packaged live deny→next-turn recovery trong **cùng** conversation: **PASS** — `multi-turn-tool-packaged.mjs`.

## Attachments (Phase 1 + honesty)

- **Workspace text file attachments: verified** — `.txt`, `.md`, `.json`, source text phổ biến; max 32KB/tệp, 64KB tổng/turn; dispatch budget 12k ký tự chung với prior-turn context.
- **Dispatch preflight: verified** — `planDispatchPrompt` fail-fast khi attachment không fit budget cuối; pending chips giữ nguyên; metadata `inclusionStatus` trên message; activity dùng `Đã đưa tệp vào ngữ cảnh` (không claim `đã đọc` trước dispatch).
- **Secret-like files: blocked by default** — `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `credentials.json`, `service-account*.json`, `.npmrc`, `.pypirc`; kiểm tra trước khi đọc nội dung; không override trong slice này.
- **Folder attachments: not started**
- **Image/PDF/document parsing: not started**
- **Drag-and-drop: not started**
- Đính kèm chỉ cấp **read context snapshot** — không bypass permission sửa/xóa file.
- Raw file content và envelope nội bộ (`<<<CGHC_UNTRUSTED_ATTACHMENT_CONTEXT>>>`) không persist trong transcript.
- Không claim bảo vệ tuyệt đối trước prompt injection trong file đính kèm — chỉ envelope untrusted + yêu cầu user hiện tại được ưu tiên.

## Tính năng chưa có

- Skills chưa available trong GUI người dùng cuối.
- `Tệp đã đọc` trong activity gồm cả attachment context (Phase 1) và tool read/list thật.
- Web support vẫn `DEFERRED`.

## UX

- GUI hiện là usable POC quality.
- Chưa claim parity với Claude Cowork hoặc OpenWork.
- Một số empty/error/loading states cần polish trước release candidate.
