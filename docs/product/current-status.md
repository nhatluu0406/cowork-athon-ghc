---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Trạng thái hiện tại của Cowork GHC

## Mốc Git

- `HEAD` hiện tại: pending commit `test(session): verify multi-turn tool recovery`.
- Mốc trước: `d3d836e` — `fix(session): make multi-turn conversations reliable`.
- Mốc packaged POC: `8df3d59` — `test(release): complete packaged L6 acceptance`.

## Trạng thái POC

Cowork GHC đạt packaged desktop POC `poc-v0.1` cho Windows. Slice **Multi-turn conversation reliability** vừa sửa lỗi release-critical: gửi tin nhắn thứ hai (và tiếp theo) trong **cùng Cowork conversation** hoạt động ổn định; identity conversation giữ nguyên; mỗi lượt có thể dùng OpenCode runtime session mới được liên kết nội bộ.

Slice **Conversation finalization** (trước đó) vẫn giữ nguyên: tool/permission kết thúc với text hoặc fallback; spinner dừng.

Trạng thái làm việc hằng ngày: Git + `docs/product/`, `docs/quality/`, `docs/architecture/`. `.loop-engineer/` chỉ `MAINTENANCE_ONLY`.

## Semantics Cowork conversation vs runtime turn

| Khái niệm | Ý nghĩa |
|---|---|
| **Cowork conversation** | Identity dài hạn: transcript, title, workspace, provider/model, activity, nhiều runtime turn |
| **Runtime turn** | Một OpenCode session xử lý một lượt prompt; sau terminal tạo session mới **liên kết** cùng conversation |
| **Reuse OpenCode session** | Chỉ khi `canPrompt === true` và session chưa terminal |
| **Context sang turn mới** | Khối transcript bounded (~12k ký tự), deterministic — không gọi model phụ |

Không claim native OpenCode multi-turn continuation khi Cowork GHC tạo linked session mới.

## Nguồn phản hồi cuối (trung thực)

| Nguồn | Khi nào |
|---|---|
| Stream EV `token` / `message.part.delta` | Phản hồi stream trong lúc chạy |
| `message.part.updated` (text committed) | OpenCode chỉ gửi snapshot text sau tool |
| `GET /v1/session/{id}` sau terminal | Text chưa có trên stream khi `session.idle` |
| Fallback UI | `Tác vụ đã hoàn tất nhưng runtime không trả về phản hồi cuối.` — không gán là output model |

## Semantics resume (trung thực)

| Hành vi | Hỗ trợ |
|---|---|
| **Mở lại** — transcript + activity sau relaunch | Có; tự chọn conversation active gần nhất |
| **Multi-turn** — gửi nhiều lượt trong cùng conversation | Có (tự tạo runtime turn mới khi cần) |
| **Tiếp tục** — cùng OpenCode session ID khi chưa terminal | Có khi `canPrompt` |
| **Tạo phiên tiếp nối** — recovery sau `interrupted` | Có; không bắt buộc cho multi-turn thường |

## Năng lực đã qua packaged verification

- Vòng đời local service, workspace, provider/model, keyring, OpenCode, streaming.
- Permission, cancellation, provider recovery, lifecycle scripts.
- Conversation persistence + multi-conversation UI.
- Activity timeline + file-change panel + permission history + file preview API.
- Conversation finalization — tool turn kết thúc đúng.
- **Multi-turn** — ORANGE-731 ba lượt + relaunch + file create (`multi-turn-packaged.mjs`, ≤4 live).
- **Multi-turn tool regression** — create/modify/read file + deny/recovery trong cùng conversation (`multi-turn-tool-packaged.mjs`, ≤4 live).

## Slice khuyến nghị tiếp theo

**Attachments and context input** (roadmap §4).

## Lệnh kiểm tra nhẹ

```powershell
npm run verify:release
node tools/verify/multi-turn-tool-packaged.mjs
node tools/verify/multi-turn-packaged.mjs
node tools/verify/conversation-finalization-packaged.mjs
node tools/verify/session-management-packaged.mjs
```
