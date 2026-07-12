---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Known limitations

## Provider và recovery

- Invalid API key chưa được verify riêng.
- Invalid model chưa được verify riêng.
- Invalid base URL chưa được verify riêng.
- Provider recovery hiện đã có missing-credential path, nhưng chưa đủ toàn bộ ma trận lỗi.

## Session

- Session resume/template re-run chưa fully verified.
- Session history và session management còn incomplete.
- Multi-session UX chưa productized.

## Lifecycle và release

- Complete Explorer double-click evidence cho `start.bat` và `clean.bat` còn incomplete.
- Release regression không-live chưa được gom thành một command duy nhất.
- L9 release verification chưa bắt đầu và không được auto-start từ workflow cũ.

## Tính năng chưa có

- Skills chưa available trong GUI người dùng cuối.
- Attachments/context input chưa available.
- Web support vẫn `DEFERRED`.

## UX

- GUI hiện là usable POC quality.
- Chưa claim parity với Claude Cowork hoặc OpenWork.
- Một số empty/error/loading states cần polish trước release candidate.
