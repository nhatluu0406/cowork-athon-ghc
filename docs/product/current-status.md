---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Trạng thái hiện tại của Cowork GHC

## Mốc Git

- `HEAD` hiện tại: pending commit `feat(session): add persistent conversation management and resume`.
- Mốc trước: `ffe4c01` — `test(release): harden provider recovery and Windows scripts`.
- Mốc packaged POC: `8df3d59` — `test(release): complete packaged L6 acceptance`.

## Trạng thái POC

Cowork GHC đạt packaged desktop POC `poc-v0.1` cho Windows. Slice **Session Management and Resume** vừa hoàn tất:
cuộc trò chuyện lưu trong user-data, danh sách sidebar, mở lại lịch sử, đổi tên, tìm kiếm cục bộ, xóa metadata, trạng thái gián đoạn, và **tạo phiên tiếp nối** khi OpenCode session đã terminal.

Trạng thái làm việc hằng ngày: Git + `docs/product/`, `docs/quality/`, `docs/architecture/`. `.loop-engineer/` chỉ `MAINTENANCE_ONLY`.

## Semantics resume (trung thực)

| Hành vi | Hỗ trợ |
|---|---|
| **Mở lại** — hiển thị transcript đã lưu sau relaunch | Có — từ `userData/.runtime/conversations/` |
| **Tiếp tục** — cùng OpenCode session ID, gửi prompt mới khi session chưa terminal | Có khi runtime còn sống và `continueSession` trả `canPrompt: true` |
| **Tạo phiên tiếp nối** — OpenCode session mới sau completed/cancelled/interrupted | Có — runtime session ID mới, transcript Cowork giữ nguyên |

Không claim multi-turn trên cùng OpenCode session sau terminal (POC vẫn single-turn per runtime session — HTTP 409 `session_completed`).

## Năng lực đã qua packaged verification

- Vòng đời local service, workspace, provider/model, Windows keyring, OpenCode, streaming.
- Permission, cancellation, interruption cleanup, provider recovery, lifecycle scripts.
- **Conversation persistence** — index + record JSON, atomic write, recover `running` → `interrupted` on boot.
- **Multi-conversation UI** — sidebar, search, switch, rename, delete (metadata only).

## Slice khuyến nghị tiếp theo

**Attachments and context input** (roadmap §3) — hoặc polish UX session (loading/error) nếu ưu tiên release candidate.

## Lệnh kiểm tra nhẹ

```powershell
npm run verify:release
node tools/verify/session-management-packaged.mjs
node tools/verify/minimal-packaged-smoke.mjs   # optional; 1 live test connection
```
