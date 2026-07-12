---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Trạng thái hiện tại của Cowork GHC

## Mốc Git

- `HEAD` hiện tại: `0fc1fa6` — `feat(attachments): add workspace text file context`.
- Mốc trước: `e40dada` — `fix(session): isolate multi-turn context from assistant output`.
- Mốc packaged POC: `8df3d59` — `test(release): complete packaged L6 acceptance`.

## Trạng thái POC

Cowork GHC đạt packaged desktop POC `poc-v0.1` cho Windows. Slice **Workspace text file attachments (Phase 1)** cho phép đính kèm tệp văn bản trong active workspace làm context một lượt — bounded, workspace guard, metadata persist, không lưu raw content trong transcript.

Slice **Multi-turn context isolation** vẫn giữ nguyên (EV mapper + envelope untrusted).

Trạng thái làm việc hằng ngày: Git + `docs/product/`, `docs/quality/`, `docs/architecture/`. `.loop-engineer/` chỉ `MAINTENANCE_ONLY`.

## Semantics Cowork conversation vs runtime turn

| Khái niệm | Ý nghĩa |
|---|---|
| **Cowork conversation** | Identity dài hạn: transcript, title, workspace, provider/model, activity, nhiều runtime turn |
| **Runtime turn** | Một OpenCode session xử lý một lượt prompt; sau terminal tạo session mới **liên kết** cùng conversation |
| **Reuse OpenCode session** | Chỉ khi `canPrompt === true` và session chưa terminal |
| **Context sang turn mới** | Envelope nội bộ bounded (~12k ký tự), đánh dấu untrusted; **không** persist/display; chỉ gửi qua `POST /session/{id}/message` |

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
| **Tiếp tục cuộc trò chuyện** — mở composer sau relaunch khi lịch sử terminal | Có; CTA `Tiếp tục cuộc trò chuyện này` |

## Năng lực đã qua packaged verification

- Vòng đời local service, workspace, provider/model, keyring, OpenCode, streaming.
- Permission, cancellation, provider recovery, lifecycle scripts.
- Conversation persistence + multi-conversation UI.
- Activity timeline + file-change panel + permission history + file preview API.
- Conversation finalization — tool turn kết thúc đúng.
- **Multi-turn tool regression** — create/modify/read + deny/recovery (`multi-turn-tool-packaged.mjs`).
- **Context isolation** — không leak wrapper/prompt vào assistant output (`multi-turn-context-packaged.mjs`, ≤4 live).
- **Workspace text file attachments (Phase 1)** — picker + chip + snapshot read + transport envelope (`attachments-packaged.mjs`, journeys A–J).

## Slice khuyến nghị tiếp theo

**Attachments Phase 2** (folder / image / PDF / drag-and-drop) hoặc **Skills** — chưa bắt đầu.

## Lệnh kiểm tra nhẹ

```powershell
npm run verify:release
node tools/verify/multi-turn-context-packaged.mjs
node tools/verify/attachments-packaged.mjs
node tools/verify/multi-turn-tool-packaged.mjs
node tools/verify/conversation-finalization-packaged.mjs
node tools/verify/session-management-packaged.mjs
```
