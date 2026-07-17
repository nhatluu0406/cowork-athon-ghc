---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Hướng dẫn demo Cowork GHC

## Chuẩn bị

```bat
npm install
scripts\init.bat
scripts\demo-seed.bat
scripts\build.bat
scripts\start.bat
```

Mở **Settings → Nhà cung cấp**, chọn connection đã lưu hoặc thêm connection mới. Dùng `Hỏi trước` cho permission mode trong buổi demo.

## Kịch bản đề xuất

### 1. Mở app

- New Chat sạch.
- Chuyển nhanh Light/Dark để giới thiệu visual system.

### 2. Provider

- Mở danh sách connection.
- Chỉ hiển thị API token dạng đã cấu hình, không lộ key.
- Kiểm tra kết nối trước khi chat.

### 3. Workspace

- Mở demo workspace.
- Chọn một file text/Markdown và xem preview/editor.
- Chọn PDF để minh họa preview khi packaged acceptance đã PASS.

### 4. Cowork chat

Prompt:

```text
Đọc file notes.md trong workspace và tóm tắt ba điểm quan trọng.
```

### 5. Create + permission

```text
Tạo file demo-output.txt trong workspace với nội dung: Cowork GHC demo OK.
```

Kiểm tra:

1. Permission `Tạo tệp` xuất hiện.
2. Chọn `Cho phép một lần`.
3. File xuất hiện/refresh trong Workspace.
4. Assistant chỉ xác nhận sau mutation thật.

### 6. Modify + deny

```text
Sửa demo-output.txt và thêm dòng: This change should be denied.
```

Chọn `Từ chối`; file phải giữ nguyên.

### 7. Skills

- Mở Settings → Kỹ năng.
- Tạo một Skill ngắn, enable, sử dụng trong một lượt, rồi disable/delete nếu cần.

### 8. History / relaunch

- Mở lại conversation.
- Stop/start app.
- Xác nhận profile, history và workspace state phù hợp vẫn còn.

## Không demo như capability đã hoàn thành

- D1–D4 backend trước khi team merge.
- File delete review.
- Full Office editor.
- Cloud/multi-user authentication.

## Kết thúc

```bat
scripts\stop.bat
```
