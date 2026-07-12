# Follow-up 1b: Nút Nén thủ công + Crash-resilient session restore — Design

**Ngày:** 2026-07-12
**Phụ thuộc:** sub-project #1 (Tab Cowork chat) — đã hoàn thành.
**Nguồn:** phát hiện qua audit toàn diện OldVersion (2026-07-12), xem `docs/superpowers/specs/2026-07-11-qt-to-electron-migration-design.md` mục 1b.

## Phạm vi

**Trong phạm vi:**
1. **Nút "🗜 Nén" thủ công** trong composer — cắt bớt lịch sử hội thoại (giữ system message + 3 turn gần nhất) để giảm token, độc lập với auto-compress khi vượt context (đã có ở sub-project #1).
2. **Crash-resilient session restore (chỉ highlight)** — lưu lại session cuối cùng đã hoạt động vào config; khi khởi động app, sidebar tự động highlight (không tự mở) hội thoại đó.

**Ngoài phạm vi:**
- Thinking/reasoning streaming UI — đã xác nhận đủ, không cần việc gì thêm ở đây.
- Tự động mở lại hội thoại cuối khi khởi động (khác hành vi bản gốc Python theo quyết định người dùng — chỉ highlight, không auto-open).
- Session restore cho Tab Code/M365 — các tab đó chưa tồn tại trong bản Electron.

## Thiết kế

### 1. Nút Nén thủ công

- **IPC mới:** `cowork:compress(conversationId: string)` (invoke) → main process lấy `conversationHistories.get(conversationId)`, tách `system` messages riêng, tìm vị trí bắt đầu của 3 `user` message gần nhất, cắt phần còn lại (logic y hệt `_compress_messages` trong `OldVersion/src/cowork_local/ui/chat_panel.py:349-365`), cập nhật lại `conversationHistories` và gọi `persistConversation` để lưu xuống disk. Trả về `{removed: number}` (số message đã bỏ) hoặc `{removed: 0}` nếu hội thoại đã đủ ngắn (≤ 3 turn).
- **Preload:** thêm `compress(conversationId: string): Promise<{removed: number}>` vào `coworkAPI`.
- **Renderer:** thêm nút trong `.composer__bar` (cạnh nút Send hiện có, dùng style `icon-btn`/`text-btn` sẵn có trong `style.css`), gọi `api.compress(currentConversationId)` khi bấm, hiển thị kết quả qua một dòng trạng thái ngắn tạm thời (ví dụ tái sử dụng cơ chế hiện có để hiện lỗi/trạng thái, hoặc một toast đơn giản — implementer quyết định khi viết code cụ thể theo pattern đã có trong `index.ts`). Nút bị vô hiệu hoá (hoặc không làm gì, hiện thông báo) khi chưa có `currentConversationId` (chưa gửi tin nhắn nào).

### 2. Crash-resilient session restore (chỉ highlight)

- **Config mở rộng** (`src/main/config.ts`): thêm `LastSessionConf { cowork: string }` vào `AppConfigData`, và `last_session: { cowork: '' }` vào `DEFAULT_CONFIG`.
- **Ghi lại session cuối:** trong `src/main/ipc.ts`'s `persistConversation()`, sau khi `saveConversation(...)` thành công, cập nhật `config.data.last_session.cowork = conversationId` và gọi `config.save()` — chỉ khi giá trị thực sự đổi (tránh ghi disk thừa mỗi turn).
- **Đọc lại khi khởi động:** renderer (`src/renderer/index.ts`, trong khối `window.addEventListener('load', ...)` đã có) sau khi gọi `refreshHistoryList()`, gọi thêm `api.settingsGet()` để lấy `last_session.cowork`; nếu giá trị này khớp với một `session_id` có trong danh sách history hiện tại, thêm class CSS mới (ví dụ `history-item--last-session`) vào phần tử tương ứng để làm nổi bật (khác với `history-item--active` dùng cho hội thoại đang mở) — **không** gọi `openConversation()` tự động.
- CSS: thêm style nhỏ cho `.history-item--last-session` (ví dụ viền nhấn nhẹ hoặc icon nhỏ) vào `src/renderer/style.css`, phân biệt rõ với trạng thái `--active`.

## Testing

- Unit test cho logic cắt lịch sử (nếu tách thành hàm thuần trong `src/main/ipc.ts` hoặc một module riêng `compress-history.ts`) — verify giữ đúng system message + 3 turn gần nhất, trả về đúng số lượng đã bỏ, không lỗi khi hội thoại đã ngắn.
- Unit test cho `config.ts`: verify `last_session` xuất hiện trong `DEFAULT_CONFIG`, deep-merge hoạt động đúng với config cũ không có field này (tương thích ngược).
- IPC wiring (`cowork:compress`) và renderer highlight: không có test tự động (giống toàn bộ IPC/renderer wiring từ sub-project #1) — verify tay bằng `npm start`: gửi >3 tin nhắn trong 1 hội thoại, bấm Nén, xác nhận số tin giảm; khởi động lại app, xác nhận hội thoại gần nhất được highlight trong sidebar (không tự mở).
