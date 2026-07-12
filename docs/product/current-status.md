---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Trạng thái hiện tại của Cowork GHC

## Mốc Git

- `HEAD` hiện tại: pending commit `feat(activity): add tool timeline and file-change review`.
- Mốc trước: `72502f1` — `feat(session): add persistent conversation management and resume`.
- Mốc packaged POC: `8df3d59` — `test(release): complete packaged L6 acceptance`.

## Trạng thái POC

Cowork GHC đạt packaged desktop POC `poc-v0.1` cho Windows. Slice **Tool Activity and File-Change Presentation** vừa hoàn tất:
timeline hoạt động tiếng Việt từ EV stream thật, thẻ công cụ, lịch sử quyền (read-only), tóm tắt thay đổi tệp đã xác minh, xem trước tệp văn bản an toàn, và persistence activity khi mở lại cuộc trò chuyện.

Slice **Session Management and Resume** (trước đó) vẫn giữ nguyên: cuộc trò chuyện lưu trong user-data, sidebar, mở lại, đổi tên, tìm kiếm, xóa metadata, trạng thái gián đoạn, tạo phiên tiếp nối.

Trạng thái làm việc hằng ngày: Git + `docs/product/`, `docs/quality/`, `docs/architecture/`. `.loop-engineer/` chỉ `MAINTENANCE_ONLY`.

## Nguồn tín hiệu activity (trung thực)

| Tín hiệu | Nguồn |
|---|---|
| Tool call start/finish | OpenCode `message.part.updated` → EV `tool_call` |
| File create/edit/delete | EV `file_mutation` từ write/edit tool **đã hoàn thành** (không từ watcher hay claim của model) |
| Tiến độ / bước | EV `step`, `progress`, `plan` |
| Terminal (hoàn thành/hủy/lỗi) | EV `terminal` từ `session.idle` / `session.error` |
| Lỗi | EV `error` |
| Quyền (modal) | API `/v1/permission/*` — không từ OpenCode `permission.*` frames (bị bỏ qua ở mapper) |
| Lịch sử quyền | UI ghi từ quyết định thật qua modal |
| Xem trước tệp | Đọc workspace qua `GET /v1/workspace/file-preview` (biên workspace) |
| Model token | Chat stream — **không** hiển thị như tool activity |

## Semantics resume (trung thực)

| Hành vi | Hỗ trợ |
|---|---|
| **Mở lại** — transcript + activity lịch sử sau relaunch | Có |
| **Tiếp tục** — cùng OpenCode session ID khi chưa terminal | Có khi runtime còn sống |
| **Tạo phiên tiếp nối** — sau terminal | Có |

## Năng lực đã qua packaged verification

- Vòng đời local service, workspace, provider/model, keyring, OpenCode, streaming.
- Permission, cancellation, provider recovery, lifecycle scripts.
- Conversation persistence + multi-conversation UI.
- **Activity timeline + file-change panel + permission history + file preview API.**

## Slice khuyến nghị tiếp theo

**Attachments and context input** (roadmap §4).

## Lệnh kiểm tra nhẹ

```powershell
npm run verify:release
node tools/verify/activity-presentation-packaged.mjs
node tools/verify/session-management-packaged.mjs
```
