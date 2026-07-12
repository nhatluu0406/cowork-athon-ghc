---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Roadmap productization

Web support vẫn `DEFERRED`. Roadmap này chỉ áp dụng cho Windows desktop app.

## 1. Release-gap hardening

Mục tiêu: biến packaged POC thành release candidate đáng tin hơn mà không mở rộng tính năng lớn.

- ~~Xác minh invalid credential recovery.~~ **DONE** (2026-07-12)
- ~~Xác minh invalid model recovery.~~ **DONE**
- ~~Xác minh invalid base URL recovery.~~ **DONE**
- ~~Xác minh `start.bat` và `clean.bat` theo kiểu Explorer.~~ **DONE**
- ~~Gom một lệnh regression không-live.~~ **DONE** — `npm run verify:release`

## 2. Session management and resume

Mục tiêu: người dùng quản lý, mở lại và tiếp tục phiên một cách rõ ràng.

- ~~Danh sách cuộc trò chuyện persisted (sidebar, search, switch).~~ **DONE** (2026-07-12)
- ~~Mở lại transcript sau relaunch.~~ **DONE**
- ~~Tạo phiên tiếp nối khi OpenCode session terminal.~~ **DONE**
- ~~Trạng thái: running, completed, cancelled, errored, interrupted.~~ **DONE**
- ~~Xóa metadata session (không xóa workspace/credential).~~ **DONE**
- Template re-run / workflow replay — **chưa** (ngoài scope slice này).
- Packaged live journey đầy đủ — deterministic trong `session-management-packaged.mjs`; live inference tùy chọn (`COWORK_SESSION_LIVE=1`).

## 3. Tool activity and file-change presentation

Mục tiêu: làm rõ agent đã làm gì trong workspace.

- Timeline tool activity dễ đọc.
- File-change summary trước và sau safe action.
- Permission history ngắn cho approve/deny.
- Phân biệt model output, tool output và app diagnostics.

## 4. Attachments and context input

Mục tiêu: cho người dùng đưa ngữ cảnh vào phiên mà vẫn giữ workspace boundary.

- Chọn file/folder trong workspace.
- Hiển thị attachment đã thêm.
- Giới hạn kích thước và loại input.
- Không đọc dữ liệu ngoài workspace nếu chưa được cấp quyền.

## 5. Skills

Mục tiêu: làm skills thành năng lực có thể hiểu và kiểm soát, không phải cơ chế ẩn.

- Danh sách skill có sẵn.
- Bật/tắt skill.
- Trạng thái lỗi và quarantine rõ ràng.
- Không mở rộng sang marketplace/cloud trước khi desktop flow ổn định.

## 6. UX polish and release candidate

Mục tiêu: nâng từ usable POC lên release candidate.

- Polish first-run guidance.
- Polish provider-error copy.
- Polish session empty/loading/error states.
- Hoàn thiện release checklist.
- Chạy packaged release verification đầy đủ.

## Ngoài phạm vi hiện tại

- Next.js/web app.
- Cloud sync hoặc multi-user.
- Hosted auth.
- OpenWork source integration.
