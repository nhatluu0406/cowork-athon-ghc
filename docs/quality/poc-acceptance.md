---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Packaged POC acceptance

Tài liệu này tóm tắt acceptance đã quan sát cho L6 packaged POC. Nguồn chứng cứ chi tiết vẫn nằm trong
`.loop-engineer/evidence/`.

## Bằng chứng packaged đã quan sát

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Service lifecycle | PASS | Packaged app khởi động local service và quản lý shutdown trong smoke hiện tại. |
| Workspace | PASS | Chọn, kích hoạt, persist, relaunch restore và workspace switching đã được verify trong packaged Slice 2. |
| Provider/model | PASS | Cấu hình provider/model qua packaged GUI đã qua Slice 3. |
| Windows keyring | PASS | Credential dùng Windows keyring; relaunch không phụ thuộc `.env`. |
| OpenCode startup | PASS | Packaged app khởi động OpenCode runtime ở Slice 4. |
| DeepSeek inference | PASS | Bounded live inference đã chạy qua endpoint OpenAI-compatible. |
| Streaming | PASS | Prompt live trả streaming output trong packaged flow. |
| Permission approve | PASS | Modal permission thật, approve tạo file fixture. |
| Permission deny | PASS | Deny không tạo file fixture. |
| Cancellation | PASS | Cancellation/interruption được verify trong packaged acceptance. |
| Safe file action | PASS | Một safe file action trong fixture workspace đã thành công. |
| Interruption cleanup | PASS | Relaunch sau interruption không để orphan process hoặc stale running state. |
| Clean-profile onboarding | PASS | Clean profile onboarding đã qua packaged verification. |

## Bằng chứng focused-test-only hoặc còn thiếu

- Invalid API key recovery: chưa verify riêng.
- Invalid model recovery: chưa verify riêng.
- Invalid base URL recovery: chưa verify riêng.
- Session resume/template re-run: chưa verify đầy đủ trong packaged flow.
- `start.bat` và `clean.bat`: cần Explorer-style evidence đầy đủ hơn.
- L9 release regression script: chưa gom thành một luồng nhẹ ổn định.

## Ghi chú bảo mật

- Không đưa API key vào docs, logs, screenshot hoặc Git.
- `.env` chỉ là bootstrap cục bộ khi được phép; packaged flow cuối cùng dùng Windows keyring.
- Live API call phải bounded và không nằm trong default test suite.
