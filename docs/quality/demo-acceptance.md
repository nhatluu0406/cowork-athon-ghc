---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# Demo acceptance

Không checkbox nào được đánh dấu PASS chỉ vì unit test hoặc model trả lời bằng văn bản.

## Golden path bắt buộc trên packaged Windows app

- [ ] Launch app, service healthy, New Chat sạch.
- [ ] Provider credential sẵn sàng.
- [ ] Chọn workspace demo.
- [ ] Gửi: `Hãy tạo file permission-demo.txt trong workspace với nội dung: Cowork GHC permission demo.`
- [ ] Runtime phát sinh tool `write` thật.
- [ ] Permission hiển thị action **Tạo tệp** và đúng workspace-relative path.
- [ ] File chưa tồn tại trước khi Allow.
- [ ] `Cho phép một lần` tạo đúng file và đúng nội dung.
- [ ] File Work Review ghi create với after snapshot.
- [ ] Assistant success chỉ xuất hiện sau mutation được xác minh.
- [ ] Yêu cầu modify cùng file, chọn Deny, file không đổi.
- [ ] Conversation/history/relaunch vẫn hoạt động.

## Workspace safety acceptance

- [ ] Text nhỏ `.txt`/`.md`: edit + atomic save.
- [ ] Text truncated: read-only, Save không xuất hiện.
- [ ] XLSX: read-only và có thông báo bảo toàn dữ liệu.
- [ ] DOCX: plain-text preview, không chèn raw HTML.
- [ ] Image preview hoạt động với CSP.
- [ ] PDF preview hoạt động trong packaged app với `frame-src blob:`.
- [ ] Agent refresh không ghi đè edit chưa lưu.

## Không thuộc demo blocker hiện tại

- File delete.
- D1–D4 backend.
- Full Office editing.
- Marketplace/MCP.
- Full release-candidate suite.
