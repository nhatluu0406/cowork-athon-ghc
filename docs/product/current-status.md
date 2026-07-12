---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Trạng thái hiện tại của Cowork GHC

## Mốc Git

- `HEAD` hiện tại: pending commit `fix(session): finalize tool-using conversations correctly`.
- Mốc trước: `899a555` — `feat(activity): add tool timeline and file-change review`.
- Mốc packaged POC: `8df3d59` — `test(release): complete packaged L6 acceptance`.

## Trạng thái POC

Cowork GHC đạt packaged desktop POC `poc-v0.1` cho Windows. Slice **Conversation finalization** vừa sửa lỗi release-critical: cuộc trò chuyện có tool/permission không còn kẹt `Đang xử lý` với bubble trống; phản hồi cuối đến từ stream OpenCode, fetch session sau terminal, hoặc fallback tiếng Việt trung thực.

Slice **Tool Activity and File-Change Presentation** (trước đó) vẫn giữ nguyên.

Trạng thái làm việc hằng ngày: Git + `docs/product/`, `docs/quality/`, `docs/architecture/`. `.loop-engineer/` chỉ `MAINTENANCE_ONLY`.

## Nguồn phản hồi cuối (trung thực)

| Nguồn | Khi nào |
|---|---|
| Stream EV `token` / `message.part.delta` | Phản hồi stream trong lúc chạy |
| `message.part.updated` (text committed) | OpenCode chỉ gửi snapshot text sau tool |
| `GET /v1/session/{id}` sau terminal | Text chưa có trên stream khi `session.idle` |
| Fallback UI | `Tác vụ đã hoàn tất nhưng runtime không trả về phản hồi cuối.` — không gán là output model |

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
- **Conversation finalization** — tool turn kết thúc với text hoặc fallback; spinner dừng.

## Slice khuyến nghị tiếp theo

**Attachments and context input** (roadmap §4).

## Lệnh kiểm tra nhẹ

```powershell
npm run verify:release
node tools/verify/conversation-finalization-packaged.mjs
node tools/verify/activity-presentation-packaged.mjs
node tools/verify/session-management-packaged.mjs
```
