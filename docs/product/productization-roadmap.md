---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Roadmap productization

Web support vẫn `DEFERRED`. Roadmap này chỉ áp dụng cho Windows desktop app.

## 1. Release-gap hardening

Mục tiêu: biến packaged POC thành release candidate đáng tin hơn mà không mở rộng tính năng lớn.

- Xác minh invalid credential recovery.
- Xác minh invalid model recovery.
- Xác minh invalid base URL recovery.
- Xác minh `start.bat` và `clean.bat` theo kiểu Explorer.
- Gom một lệnh regression không-live nếu khả thi.
- Chuẩn hóa báo cáo release-gap ngắn trong `docs/quality/`.

## 2. Session management and resume

Mục tiêu: người dùng quản lý, mở lại và tiếp tục phiên một cách rõ ràng.

- Danh sách session gần đây.
- Resume packaged smoke cho session đã có.
- Template re-run hoặc workflow replay ở mức POC.
- Trạng thái session rõ ràng: running, completed, cancelled, errored.
- Hành vi khi app bị đóng giữa phiên.

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
