---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# Lộ trình sản phẩm

## NOW — một golden path đáng tin cậy

- [x] Thêm Cowork file-action contract vào dispatch prompt.
- [x] Map `permission.asked.properties.tool` đúng (`write` → create, `edit` → modify).
- [x] Thêm false-success guard dựa trên File Work Review/disk evidence.
- [x] Tắt các đường ghi file nguy hiểm: truncated text và XLSX destructive save.
- [ ] Packaged manual: create file → Permission → Allow → file tồn tại.
- [ ] Packaged manual: modify file → Deny → file không đổi.
- [ ] Xác nhận File Work Review create/modify sau golden path.

## NEXT — demo xuất sắc sau khi P0 PASS

- [ ] Một commercial UI pass thống nhất: design tokens, icons, tooltip, permission card, transcript, Settings, Workspace, Skills.
- [ ] Light/dark mode thật, gồm titlebar overlay và toàn bộ surface.
- [ ] Capture tối đa 10 màn hình packaged sau khi các feature thật đã ổn định.
- [ ] Hoàn thiện preview Office an toàn; chỉ mở edit khi bảo toàn dữ liệu được chứng minh.

## WAITING — team khác

- [ ] D1 Dispatch backend integration.
- [ ] D2 Microsoft 365 integration.
- [ ] D3 Knowledge/RAG integration.
- [ ] D4 Advanced Gateway integration.

## DEFERRED

- File Work Review delete trên OpenCode v1.17.11.
- XLSX direct editing cho đến khi patch-in-place giữ công thức/format/sheet.
- Full DOCX/PPTX editor.
- Routing, failover, key pool, cost routing.
- Web/Next.js.
- Full L9/RC.
