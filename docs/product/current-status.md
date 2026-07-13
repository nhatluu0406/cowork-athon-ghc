---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# Trạng thái hiện tại

Baseline source được vá từ snapshot `310524c`. Tài liệu canonical: [docs/README.md](../README.md).

## Capability inventory

| Năng lực | Trạng thái | Ghi chú trung thực |
|---|---|---|
| Startup | **BASIC WORKS** | Mở New Chat sạch; lifecycle scripts hiện hữu. |
| Provider profiles | **PARTIAL** | DeepSeek preset + custom OpenAI-compatible profiles; packaged switching giữa hai endpoint thật vẫn cần xác nhận. |
| Credentials | **BASIC WORKS** | Windows keyring theo profile; không persist raw key trong profile JSON. |
| Workspace navigator | **PARTIAL** | Duyệt file và mở preview cơ bản. |
| Workspace editing | **PARTIAL** | `.txt`/`.md` nhỏ có thể sửa; file text bị truncate là read-only; XLSX chuyển read-only để tránh mất dữ liệu. |
| Image / PDF / DOCX preview | **PARTIAL** | Image dùng data URL; PDF dùng blob frame theo CSP; DOCX render plain text. Cần packaged PO check. |
| Chat / streaming | **BASIC WORKS** | OpenCode runtime + conversation persistence. |
| File create / modify bằng Agent | **BLOCKED — PACKAGED CHECK REQUIRED** | Source đã thêm action contract, permission tool mapping và false-success guard; chưa được xác nhận trên packaged Windows app. |
| Permissions | **BLOCKED — PACKAGED CHECK REQUIRED** | Bridge nay ưu tiên `permission.asked.properties.tool`; UI poll nhanh hơn và báo lỗi transport. Golden path create→Allow và modify→Deny phải chạy thật. |
| File Work Review | **PARTIAL** | Create/modify review có nền tảng; delete chưa tin cậy. |
| Attachments | **PARTIAL** | Text attachments bounded; image/PDF attachment vào prompt chưa có. |
| Skills | **BASIC WORKS** | User Skill CRUD + enable/disable; built-in read-only. |
| UI readiness | **PARTIAL / COMMERCIAL FAIL** | Shell dùng được nhưng chưa đạt chuẩn demo thương mại; dark mode thật chưa có. |
| D1–D4 | **NOT IMPLEMENTED** | Chỉ có integration surfaces/mount points; backend teams chưa merge. |
| Full RC | **DEFERRED** | Chưa chạy release-candidate đầy đủ. |

## P0 recovery patch trong source này

- Product action contract bắt buộc model dùng file tool và không được báo thành công khi tool chưa thành công.
- Permission bridge giữ đúng tool thật (`write` → `file_create`) thay vì làm mất thông tin qua permission group.
- File-action response được đánh dấu **chưa xác minh** nếu không có review/disk evidence cùng runtime turn.
- Truncated text và XLSX được chuyển sang read-only để tránh ghi đè phá dữ liệu.
- DOCX không còn chèn HTML chưa sanitize; render plain text.
- Workspace giữ thay đổi chưa lưu khi Agent refresh.

## Exit criterion trước khi tiếp tục UI commercial pass

```text
request create file
→ Permission hiển thị
→ Allow once
→ file tồn tại đúng workspace, đúng nội dung
→ File Work Review có bằng chứng
→ assistant chỉ báo verified success sau mutation
```
