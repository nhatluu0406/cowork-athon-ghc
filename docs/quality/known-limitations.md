---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Known limitations

## Session

- Session resume/template re-run chưa fully verified.
- Session history và session management còn incomplete.
- Multi-session UX chưa productized.

## Release

- L9 release verification đầy đủ chưa bắt đầu.
- Regression packaged đầy đủ (permission + file + interruption) không chạy mặc định sau mỗi thay đổi nhỏ — dùng `verify:release` + smoke tối thiểu.

## Tính năng chưa có

- Skills chưa available trong GUI người dùng cuối.
- Attachments/context input chưa available.
- Web support vẫn `DEFERRED`.

## UX

- GUI hiện là usable POC quality.
- Chưa claim parity với Claude Cowork hoặc OpenWork.
- Một số empty/error/loading states cần polish trước release candidate.
