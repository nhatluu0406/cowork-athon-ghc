---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Known limitations

## Session

- **Tiếp tục** (cùng OpenCode session ID) chỉ khả dụng khi runtime session chưa terminal và service có thể `continueSession`. Sau relaunch app, thường cần **tạo phiên tiếp nối** để gửi prompt mới.
- POC vẫn **single-turn per OpenCode runtime session** — re-prompt cùng session sau terminal trả HTTP 409; UI tạo runtime session mới liên kết cùng Cowork conversation.
- Không hỗ trợ nhiều runtime session chạy song song.
- Template re-run / workflow replay chưa có.
- Rename/delete qua context menu (chuột phải) — chưa có menu riêng trong sidebar.

## Release

- L9 release verification đầy đủ chưa bắt đầu.
- Regression packaged đầy đủ (permission + file + interruption) không chạy mặc định sau mỗi thay đổi nhỏ — dùng `verify:release` + `session-management-packaged.mjs`.

## Tính năng chưa có

- Skills chưa available trong GUI người dùng cuối.
- Attachments/context input chưa available.
- Web support vẫn `DEFERRED`.

## UX

- GUI hiện là usable POC quality.
- Chưa claim parity với Claude Cowork hoặc OpenWork.
- Một số empty/error/loading states cần polish trước release candidate.
