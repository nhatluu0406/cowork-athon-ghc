---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# Demo acceptance

Hành trình bắt buộc cho funding/demo review trên **packaged app** (`dist-app\win-unpacked\Cowork GHC.exe`).

## Tiền điều kiện

1. `scripts\init.bat` đã chạy ít nhất một lần.
2. `scripts\build.bat` thành công.
3. Provider profile có credential hợp lệ (Settings hoặc `set-provider-key.bat`).
4. Workspace folder demo sẵn sàng (ví dụ thư mục trống hoặc có file `.txt` mẫu).

## Hành trình (10 bước)

| # | Bước | PASS khi |
|---|---|---|
| 1 | Launch desktop app | `start.bat` mở cửa sổ; không crash; service healthy. |
| 2 | New Chat sạch | Không auto-load transcript cũ; không continuation banner trên startup. |
| 3 | Provider profile | Chọn hoặc cấu hình profile; readiness hiển thị trung thực (ready / missing / failed). |
| 4 | Workspace | Chọn workspace; tree/preview hiển thị; path hiển thị rõ. |
| 5 | Gửi prompt chat | Streaming response; không lộ transport envelope trong bubble. |
| 6 | Đính kèm text file | Chip pending → inclusion; secret-like file bị chặn. |
| 7 | Approve file create/modify | Modal Allow/Deny; Allow thực sự ghi file. |
| 8 | File Work Review | Inspector/panel hiển thị thay đổi; diff bounded cho create/modify. |
| 9 | Mở lại từ history | Sidebar chọn conversation; transcript + activity khôi phục. |
| 10 | Relaunch | `stop.bat` → `start.bat`; config + history còn; vẫn New Chat sạch trên startup. |

## Không yêu cầu trong demo này

- D1–D4 backend integrations (placeholder UI only).
- File delete journey (known limitation).
- Skills marketplace / MCP / URL install.
- Full L9 / release-candidate pass.
- Screenshot matrix hoặc live LLM determinism suite.

## Scripts hỗ trợ

- `scripts\demo-reset.bat` — reset runtime temp + packaged profile (giữ keyring).
- `scripts\demo-seed.bat` — tạo `demo-workspace\` với file mẫu cho Workspace Companion.
- `scripts\verify-fast.bat` — typecheck + focused tests + renderer build trước commit.

## Workspace Companion happy path (Phase 1)

- [x] Chọn workspace → tab **Workspace** → mở file từ navigator
- [x] Preview `.txt` / `.md` và chỉnh sửa + **Lưu**
- [x] Preview ảnh `.png` / `.jpg` / `.webp`
- [x] Preview read-only `.pdf` và `.docx`
- [x] Grid preview `.xlsx`, sửa cell, **Lưu**
- [x] Chat Cowork ở cột phải (1366×768 usable)
- [x] Agent sửa file đang mở → preview refresh + badge “Agent đã cập nhật tệp”
- [ ] PO sign-off trên packaged live journey

## Skills CRUD happy path (Basic)

- [x] Settings → tab **Kỹ năng** (không có trên product rail)
- [x] Danh sách Skill: tên, mô tả, version, nguồn, trạng thái bật/tắt
- [x] Tìm theo tên
- [x] Tạo Skill người dùng → `skill-folder/SKILL.md` với frontmatter `id`, `name`, `description`, `version`
- [x] Sửa Skill người dùng (metadata + Markdown)
- [x] Xóa Skill người dùng (xác nhận + gỡ enabled state)
- [x] Skill tích hợp sẵn: chỉ đọc, vẫn bật/tắt được
- [x] Từ chối ID trùng / path traversal
- [x] Provenance lịch sử vẫn đọc được sau khi xóa Skill
- [ ] PO sign-off packaged journey: create → edit → disable → enable → delete

## Bằng chứng

- Screenshots: `docs/demo/screenshots/` (tối đa 4 ảnh).
- JSON evidence: `reports/file-work-review-completion/`, `reports/multi-provider-profiles-phase1/`.
