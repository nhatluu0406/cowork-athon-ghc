---
language: "vi"
status: "draft"
created_at: "2026-07-16"
topic: "P2-A — Persist + browse/resume lịch sử hội thoại MS365"
---

# Thiết kế: P2-A — Lịch sử hội thoại MS365 (persist + browse/resume)

## 1. Mục tiêu & phạm vi

Cho tab MS365 lưu và xem lại các cuộc hội thoại: **persist tin nhắn** vào conversation record
(`surface=ms365`), và một **sidebar** trong tab "Trợ lý AI" để liệt kê / mở lại conversation cũ,
tạo cuộc mới, và chat tiếp trong cuộc cũ (continuation).

### Phát hiện định hình scope
Hiện tin nhắn MS365 **KHÔNG được persist** — `Ms365ChatController` tạo conversation + session
nhưng không gọi `appendConversationMessage`, nên conversation `surface=ms365` là vỏ rỗng (có title,
không message). Vì vậy "duyệt lịch sử" có tiền đề bắt buộc là persist. P2-A gồm hai phần liên quan
chặt (cùng đụng conversation persistence + controller) → một spec:
- **A0 (tiền đề)**: persist tin nhắn MS365 (user + assistant).
- **A1**: sidebar list / mở lại (read-only + gửi tiếp) / nút Mới / continuation.

### Trong phạm vi (tầng UI, tái dùng backend có sẵn)
- A0: gọi `appendConversationMessage` trong luồng gửi/stream MS365; controller expose `conversationId`.
- A1: sidebar trong tab Trợ lý AI (list `surface=ms365`), mở lại conversation (load `ms365Messages`
  từ `getConversation`), nút "Cuộc trò chuyện mới", continuation (gửi tiếp trong cuộc cũ).
- Controller: `conversationId` getter + `resetConversation()` + `adoptConversation(id)`.

### Ngoài phạm vi (YAGNI / phase khác)
- Xóa / rename conversation; search trong list.
- Tool-activity display + thẻ phê duyệt (đó là P2-B, spec riêng).
- Load-on-open `GET /v1/ms365/view`; polling.
- Sửa backend router/connector/session-scope/store (dùng lại `listConversations`/`getConversation`/
  `appendConversationMessage` đã có).

## 2. Quyết định thiết kế (đã chốt với PO)

| Chủ đề | Quyết định |
|---|---|
| Scope A | A0 persist + A1 browse/resume trong một spec |
| Vị trí history | Sidebar/danh sách trong tab "Trợ lý AI" |
| Mở conversation cũ | Read-only xem lại + gửi tiếp (continuation): session mới + allow, append vào id cũ |
| Cuộc mới | Nút "Cuộc trò chuyện mới" (không xóa/rename đợt này) |
| Điều kiện | Sidebar + chat chỉ hiện khi `connectionState === "connected"` (đồng bộ gate composer) |

## 3. Kiến trúc

```
Tab "Trợ lý AI" MS365 (chỉ khi connected)
 ┌────────────┬───────────────────────────────────┐
 │ Sidebar     │  Transcript (ms365Messages[])     │
 │ [+ Mới]     │                                   │
 │ • Conv 1 ◄──│  chọn → getConversation → nạp msgs │
 │ • Conv 2    │  gửi → append + persist (id cũ)    │
 └────────────┴───────────────────────────────────┘
```

**Thành phần chạm (đều app/ui):**
- `ms365-chat-controller.ts`: expose `conversationId` (getter); `resetConversation()` (Mới:
  conversationId=null + reset session/stream); `adoptConversation(id)` (mở cũ: conversationId=id +
  reset session/stream). Mô hình "1 session sống mỗi conversation đang mở" giữ nguyên.
- `app-shell.ts`: A0 persist (append user sau send, assistant khi stream completed); sidebar render +
  handlers (list/select/new); nạp `ms365Messages` khi mở cũ; refresh list sau khi tạo conv mới.
- `ms-assistant-view.ts` / `microsoft-view.ts`: khung sidebar + nút "Mới" trong tab Trợ lý AI.
- `service-client`: dùng lại `listConversations(query, "ms365")`, `getConversation(id)`,
  `appendConversationMessage(id, role, text)` — KHÔNG thêm method mới.

**Không đụng:** backend, router, session-scope, connector, Cowork sidebar.

## 4. Data flow

### A0 — Persist
```
Controller expose conversationId (getter). Trong onMs365Send:
1. push {user} + {assistant placeholder} vào ms365Messages (đã có từ P1)
2. await ms365Chat.send(text)  — ensureSession có thể vừa tạo conversationId
3. SAU send: appendConversationMessage(ms365Chat.conversationId, "user", text)   [persist user]
4. Stream onView terminal "completed": appendConversationMessage(conversationId, "assistant", finalText)
   [persist assistant — chỉ khi conversationId != null và text non-empty]
```
Thứ tự: `conversationId` chỉ có sau khi `send()` chạy `ensureSession` → persist user SAU send.

### A1 — Mở conversation cũ
```
1. Sidebar: listConversations(undefined, "ms365") → list (id, title, updatedAt)
2. Chọn id:
   a. rec = getConversation(id)
   b. state.ms365Messages = rec.messages.map(m => ({ role: m.role, text: m.text }))
   c. ms365Chat.adoptConversation(id)  → conversationId=id, session/stream reset
   d. render transcript (lịch sử cũ, read-only tới khi gửi)
3. Gửi tiếp → ensureSession thấy conversationId != null (KHÔNG tạo mới) → session mới + allow +
   stream → sendSessionMessage → append + persist vào id cũ (continuation)
```

### New / Refresh
```
Nút "Mới": ms365Chat.resetConversation() + ms365Messages=[] → transcript trống. Gửi đầu → conv mới.
Refresh list: sau khi conversationId được tạo (lần gửi đầu) hoặc mở lại → listConversations lại.
```

## 5. Error handling

| Tình huống | Xử lý |
|---|---|
| `appendConversationMessage` lỗi | Best-effort: transcript UI vẫn đúng; nuốt/log lỗi persist, không chặn chat. |
| conversationId null khi định persist | Chỉ persist sau send (id đã tạo); nếu vẫn null (send fail sớm) → bỏ qua, không crash. |
| `getConversation` lỗi khi mở cũ | Hiện lỗi thân thiện; giữ transcript hiện tại, không đổi conversationId. |
| Mở cũ khi lượt đang `running` | Chặn switch giữa lượt chạy (hoặc stop stream cũ trước adopt) — tránh stream cũ ghi nhầm conversation mới. |
| Gửi tiếp trong cuộc cũ | ensureSession thấy conversationId != null → KHÔNG tạo conv mới; tạo session mới + allow; append id cũ. |
| Disconnect | Như P1: ms365Messages=[] + disconnect() (revoke + reset). Sidebar list còn (đọc SQLite khi reconnect). |
| Chưa connected | Sidebar + chat chỉ hiện khi connected; chưa kết nối → card "Chưa kết nối" như hiện tại. |

## 6. Testing

1. **A0 persist** — gửi 1 prompt → `appendConversationMessage` gọi cho user + assistant đúng
   `conversationId`; record sau đó có 2 message.
2. **adopt/reset controller** — `adoptConversation(id)` set conversationId=id + reset session; gửi
   sau KHÔNG gọi createConversation, có tạo session mới + allow. `resetConversation()` clear null →
   gửi tạo conv mới.
3. **Sidebar list** — `listConversations(undefined,"ms365")` render đúng; chọn item → `getConversation`
   + `ms365Messages` nạp từ record.
4. **Continuation** — mở cuộc cũ (2 message) → gửi thêm 1 → persist thành 3 dưới cùng conversationId;
   session mới được allow.
5. **Isolation** — conversation `surface=ms365` KHÔNG hiện sidebar Cowork (khẳng định lại); sidebar
   MS365 chỉ hiện `ms365`.
6. **Regression** — `npm run typecheck`, `npm test` (baseline: chỉ pre-existing fail),
   `scripts\verify-fast.bat`. Packaged acceptance: chat vài lượt → Mới → chat cuộc khác → mở lại cuộc
   cũ thấy đủ lịch sử → gửi tiếp được.

## 7. Bảo mật & review

- Persist chỉ tin nhắn user-visible (không token/secret) — đúng bất biến conversation store.
- continuation: session mới vẫn qua `setMs365SessionScope` allow (Ms365SessionScope guard thật).
- Renderer không chạm DB/secret; dùng typed preload/service-client sẵn có.
- Chạm persistence + controller lifecycle → nên có independent review theo CLAUDE.md.
