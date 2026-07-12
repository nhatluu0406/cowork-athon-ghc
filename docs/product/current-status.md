---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Trạng thái hiện tại của Cowork GHC

## Mốc Git

- `HEAD` hiện tại: `ead01e8` (`poc-v0.1`) - `chore(state): record L6 acceptance commit hash`.
- Commit chấp nhận packaged POC: `8df3d59` - `test(release): complete packaged L6 acceptance`.
- Mốc core trước GUI: `c96b5b8` (`poc-core-v0.1`).

## Trạng thái POC

Cowork GHC đã đạt packaged desktop POC `poc-v0.1` cho Windows. Bằng chứng chính nằm ở
`.loop-engineer/evidence/CGHC-028-l6-packaged-acceptance.md`, còn `.loop-engineer/` được giữ làm
provenance và công cụ kiểm tra tùy chọn.

Trạng thái làm việc hằng ngày hiện nay chuyển sang: Git + các tài liệu nhẹ trong `docs/product/`,
`docs/quality/`, và `docs/architecture/`.

## Năng lực đã qua packaged verification

- Vòng đời local service trong packaged app.
- Chọn workspace, kích hoạt workspace, lưu trạng thái và khôi phục sau relaunch.
- Cấu hình provider/model cho endpoint OpenAI-compatible.
- Lưu và khôi phục credential qua Windows keyring.
- Test connection với DeepSeek trong phạm vi bounded.
- Khởi động OpenCode runtime từ packaged app.
- Gửi prompt, nhận streaming output và hoàn tất một phiên live.
- Permission approve và deny qua GUI với OpenCode permission bridge.
- Cancellation/interruption và relaunch không để lại orphan process.
- Một safe file action trong fixture workspace.
- Clean-profile onboarding.
- `init.bat` và `stop.bat` trong acceptance hiện tại.

## Chưa có hoặc chưa đủ để xem là productized

- Session history, quản lý nhiều phiên, resume/template re-run còn thiếu kiểm chứng đầy đủ.
- Attachments và context input chưa có.
- Skills/MCP UI chưa sẵn sàng cho người dùng cuối.
- Provider-error recovery chưa tách đủ các nhánh invalid API key, invalid model, invalid base URL.
- Bằng chứng Explorer double-click đầy đủ cho `start.bat` và `clean.bat` còn thiếu.
- GUI đạt mức usable POC, chưa phải parity với Claude Cowork hoặc OpenWork.
- Web support giữ `DEFERRED`.

## Slice khuyến nghị tiếp theo

`Release Gap Hardening`

Phạm vi:

- Xác minh recovery khi credential không hợp lệ.
- Xác minh recovery khi model không hợp lệ.
- Xác minh recovery khi base URL không hợp lệ.
- Xác minh `start.bat` và `clean.bat` bằng cách gọi kiểu Explorer.
- Gom một lệnh release regression không-live nếu thực tế.

Sau đó chuyển sang slice tính năng: `Session Management and Resume`.

## Quy trình phát triển nhẹ

```text
Đọc current status
→ chọn một product slice
→ xem Git diff hiện tại
→ implement bằng một Agent
→ chạy focused tests
→ chạy packaged verification khi thay đổi user-facing
→ cập nhật current status
→ commit
```

Independent review chỉ bắt buộc cho credential/security changes, runtime/process changes,
release-critical packaged changes, hoặc large architecture changes. Không cần LLM reviewer cho mọi
task nhỏ.

## Lệnh kiểm tra nhẹ

```powershell
node tools/loop-engineer/cli.mjs verify
git status --short
git diff --stat
```

Không chạy live DeepSeek/OpenCode hoặc package build nếu slice hiện tại chỉ là tài liệu.
