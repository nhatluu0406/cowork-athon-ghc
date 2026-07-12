# Master Implementation Order — Qt→Electron Migration

**Ngày:** 2026-07-12
**Phạm vi:** thứ tự triển khai + phụ thuộc giữa 11 sub-project trong roadmap (`docs/superpowers/specs/2026-07-11-qt-to-electron-migration-design.md`). Đây KHÔNG phải kế hoạch chi tiết từng task — mỗi sub-project vẫn đi qua quy trình chuẩn (brainstorm → spec → plan chi tiết → implement) riêng khi tới lượt.

## Nguyên tắc sắp xếp thứ tự

1. **Phụ thuộc kỹ thuật thật sự** đi trước (ví dụ: #3 định nghĩa built-in HTML Document Builder skill mà #4 tham chiếu tới, nên #3 phải xong trước #4).
2. **Hạ tầng dùng chung** xây một lần, dùng lại — ưu tiên sub-project nào cần hạ tầng đó sớm nhất.
3. **Độ rủi ro/độ phức tạp** — sub-project rủi ro cao (nhiều tích hợp bên ngoài như MS Graph OAuth) nên làm sau khi các mảng nền tảng đã ổn định.
4. **Giá trị sử dụng độc lập** — mỗi sub-project xong là dùng được ngay (không phải chờ tất cả xong mới demo được gì).
5. **Ưu tiên thấp nhất rõ ràng** — App shell (#11) đã được người dùng xác nhận là ưu tiên thấp nhất, luôn ở cuối bất kể phụ thuộc.

## Thứ tự triển khai

| # | Sub-project | Trạng thái | Phụ thuộc vào | Lý do thứ tự |
|---|---|---|---|---|
| 1 | Tab Cowork (chat) end-to-end | ✅ Đã xong (cần follow-up nhỏ) | — | Nền tảng: provider abstraction, IPC, config, history, conversation manager — mọi sub-project sau đều build trên nền này. |
| 1b | Follow-up cho #1: nút Nén thủ công, crash-resilient session restore, soát lại Thinking/reasoning UI | Chưa làm | #1 | Vá lỗ hổng nhỏ phát hiện qua audit, nên làm ngay trước khi chuyển sang #2 để tránh tích luỹ nợ kỹ thuật trên nền đã ổn định. |
| 2 | Attachments | Đang brainstorm dở | #1 | Mở rộng trực tiếp `Message.content` (ContentPart[]) mà #3 (Office doc generation) và #7 (MS365) sau này cũng có thể cần dùng lại cách trích xuất text tài liệu. Làm sớm để các sub-project sau tận dụng được `extract-text.ts`. |
| 3 | Office document generation (bao gồm HTML Document Builder) | Chưa làm | #1, #2 | Dùng lại cơ chế tool-calling + sandbox `.scratch/` đã có ở #1; tái sử dụng `extract-text.ts` từ #2 nếu cần đọc lại file vừa sinh. HTML Document Builder (built-in skill) được định nghĩa ở đây trước khi #4 tham chiếu. |
| 4 | Skills system | Chưa làm | #1, #3 | Cần #3 xong trước vì Skills tham chiếu HTML Document Builder như một built-in skill luôn bật — nếu làm #4 trước #3, phải viết lại phần tích hợp này. |
| 5 | Tab Code | Chưa làm | #1, #4 | Tab Code dùng Skills (`/skill` command áp dụng cho cả Cowork và Code) và Flow steps tham chiếu skill theo tên — cần #4 xong. Cũng cần quyết định lại provider/tool-calling layer (text-fallback protocol) — độc lập với Cowork nhưng dùng chung `run-cowork.ts`-style loop. |
| 6 | Tab Structure/RAG | Chưa làm | #5 | Dùng chung `codebase-memory-mcp` CLI bridge với Tab Code (#5) — cả 2 nên xây bridge một lần. Structure graph cũng tự động re-scan khi Code/Cowork ghi file mới, nên cần #5 có sẵn để test đầy đủ luồng này. |
| 7 | MS365 integration | Chưa làm | #1, #4 (nhẹ) | Độc lập lớn nhất về mặt kỹ thuật (MS Graph API, OAuth) — không phụ thuộc #5/#6. Cần #4 (Skills) ở mức nhẹ vì `/skill` áp dụng cho M365 tab theo audit — nhưng thực ra bản Python xác nhận M365 KHÔNG dùng skills, nên phụ thuộc này có thể bỏ nếu giữ đúng hành vi cũ (không áp dụng `/skill` cho M365). Rủi ro cao nhất (OAuth, nhiều Graph endpoint) nên đặt sau khi nền tảng đã vững. |
| 8 | Teams webhook notifications | Chưa làm | #1 | Độc lập, chỉ cần cấu hình + gửi HTTP POST khi turn hoàn thành — không phụ thuộc #2-7. Có thể làm sớm hơn nếu muốn, nhưng xếp sau MS365 vì cùng nhóm "tích hợp ngoài" và ít khẩn cấp hơn. |
| 9 | LibreOffice document embedding | Chưa làm | #5 | Chỉ có ý nghĩa khi Tab Code đã có file viewer/editor (#5) để nhúng LibreOffice view vào — làm trước #5 sẽ không có chỗ gắn UI. |
| 10 | Packaging & distribution | Chưa làm | Tất cả 1-9 | Đóng gói bản chạy thật — nên làm sau khi các tính năng chính đã ổn định, tránh phải build lại nhiều lần khi tính năng còn thay đổi. |
| 11 | App shell (tray/notifications) | Chưa làm | #1 (kỹ thuật), nhưng **ưu tiên thấp nhất theo quyết định người dùng** | Về mặt kỹ thuật chỉ cần #1 xong là đủ để thêm system tray/notification, nhưng người dùng đã xác nhận đây là polish cấp thấp — đặt cuối roadmap bất kể phụ thuộc kỹ thuật cho phép làm sớm hơn. |

## Lộ trình rút gọn (thứ tự thực thi)

```
1 (done) → 1b (follow-up) → 2 (Attachments, đang dở) → 3 (Office doc gen)
  → 4 (Skills) → 5 (Tab Code) → 6 (Structure/RAG) → 7 (MS365)
  → 8 (Teams webhook) → 9 (LibreOffice embed) → 10 (Packaging) → 11 (App shell)
```

## Ghi chú

- Thứ tự này có thể điều chỉnh linh hoạt khi bắt đầu từng sub-project nếu phát sinh thông tin mới (ví dụ: #7 MS365 và #8 Teams webhook có thể hoán đổi vị trí cho nhau vì độ phụ thuộc chéo thấp).
- Mỗi sub-project khi tới lượt vẫn đi qua quy trình đầy đủ: brainstorm (bao gồm review lại OldVersion phần liên quan nếu cần) → spec doc → user duyệt → plan chi tiết (writing-plans) → implement (subagent-driven-development) → review → finishing-a-development-branch.
- Bước tiếp theo ngay sau tài liệu này: hoàn thành follow-up 1b cho sub-project #1, sau đó tiếp tục brainstorm sub-project #2 (Attachments) đang dở.
