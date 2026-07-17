---
language: "vi"
status: "draft"
created_at: "2026-07-17"
topic: "MS365 follow-up #1+#3 — composer running-gate + selected-conversation highlight"
---

# Thiết kế: MS365 follow-up — composer running-gate (#1) + history highlight (#3)

## 1. Mục tiêu & phạm vi

Hai follow-up nhỏ, thuần UI, cùng vùng (composer + sidebar tab MS365) → một spec:

- **#1 Composer running-gate:** chặn gửi lượt mới khi lượt hiện tại đang stream (`ms365Phase === "running"`)
  và làm mờ nút gửi / ô nhập / chip gợi ý khi đang chạy. Hiện `onMs365Send` KHÔNG kiểm tra phase →
  có thể gửi lượt 2 chồng lên lượt 1 trên cùng session, `ms365Messages` lẫn, assistant bubble đang
  stream bị ghi đè. (P2-A đã gate switch sidebar/nút Mới, nhưng KHÔNG gate chính nút gửi.)
- **#3 Selected-conversation highlight:** đánh dấu conversation đang mở trong sidebar MS365. Hiện
  sidebar liệt kê nhưng không highlight cái đang active (`ms365ActiveConversationId`).

### Trong phạm vi (đều app/ui)
- #1a Guard chức năng: `if (state.ms365Phase === "running") return;` đầu `onMs365Send`.
- #1b Disable trực quan: `renderMs365Transcript` toggle `.disabled` cho nút gửi + ô nhập + chip theo
  `ms365Phase` (KHÔNG rebuild composer — chỉ đổi thuộc tính disabled).
- #3 Highlight: truyền `ms365ActiveConversationId` xuống sidebar, thêm class `--active` cho item khớp.

### Ngoài phạm vi (YAGNI)
- Cancel lượt đang chạy từ composer (không có nút hủy đợt này).
- Rename/xóa/search trong sidebar.
- Follow-up #2 (backend `/disconnect` revoke-all) — tách riêng vì chạm backend.
- Đổi contract/backend/controller.

## 2. Quyết định thiết kế (đã chốt với PO)

| Chủ đề | Quyết định |
|---|---|
| #1 hai lớp | Guard handler (chặn thật) + disable trực quan (UX) |
| Cơ chế disable | `renderMs365Transcript` toggle `.disabled` trực tiếp qua tham chiếu đã lưu — KHÔNG rebuild composer |
| Phạm vi disable | Nút gửi + ô nhập + chip gợi ý (mọi lối gửi đều mờ khi running) |
| #3 nguồn active | `state.ms365ActiveConversationId`, truyền qua render surface |
| #3 nút Mới | activeId=null → không item nào active (cuộc mới chưa persist) |
| Review | Thuần UI, không chạm permission/runtime → không cần independent review |

## 3. Kiến trúc

```
renderState → renderMicrosoftSurface(dom, view, handlers, conversations, activeId)
                 └ renderMsAssistant → composer refs {send,input,chips} lưu vào dom.microsoftView
                                     → renderMs365Sidebar(conversations, handlers, activeId) → item--active
onView (stream) → renderMs365Transcript(dom, state)
                     └ toggle send/input/chips .disabled = running || !connected   (KHÔNG rebuild)
onMs365Send → if running return (guard) → gửi
```

**Thành phần chạm (đều app/ui):**
- `app-shell.ts`:
  - Guard `if (state.ms365Phase === "running") return;` đầu `onMs365Send`.
  - `renderMs365Transcript`: sau khi render bubble/strip, toggle disabled cho composer refs theo phase.
  - Truyền `state.ms365ActiveConversationId` khi gọi `renderMicrosoftSurface`.
- `ui-shell/microsoft/microsoft-view.ts`:
  - `MicrosoftViewDom` thêm field composer refs: `msComposerSend`, `msComposerInput`, `msComposerChips`
    (HTMLElement | null), cạnh `assistantTranscript`.
  - `renderMicrosoftSurface(dom, view, handlers, conversations, activeId?)` nhận + chuyển `activeId`.
  - `renderMicrosoftSurfaceInternal` lưu composer refs từ giá trị `renderMsAssistant` trả về (giống
    cách đang lưu `assistantTranscript`); tab connect → refs = null.
- `ui-shell/microsoft/ms-assistant-view.ts`:
  - `renderComposer` trả `{ root, send, input, chips }` thay vì chỉ `root`.
  - `renderMsAssistant` trả object gồm `transcript` + composer refs (thay vì chỉ transcript), để
    `renderMicrosoftSurfaceInternal` lưu.
  - `renderMsAssistant`/`renderMs365Sidebar` nhận `activeId: string | null`; item khớp thêm class
    `ms-history__item-btn--active`.
- `ui-shell/microsoft/microsoft.css`: rule `.ms-history__item-btn--active`.

**Không đụng:** backend, ms365-chat-controller, permission controller, contract, Cowork.

## 4. Data flow

### #1 Send-gate + disable
```
onMs365Send(text):
  if ms365Phase === "running": return            // (a) guard — chặn lượt chồng
  push user + assistant-placeholder; ms365Phase = "running"; renderMs365Transcript
  → renderMs365Transcript: running=true → send/input/chips .disabled = true   // (b) mờ
  ... stream ...
  onView terminal → ms365Phase = idle/failed → renderMs365Transcript
  → running=false → send/input/chips .disabled = (!connected)                 // bật lại
```

### #3 Highlight
```
onMs365SelectConversation(id): (sau guard running của P2-A) ms365ActiveConversationId = id → renderState
onMs365NewConversation():      ms365ActiveConversationId = null → renderState
renderMicrosoftSurface(..., activeId): renderMs365Sidebar tô class --active cho item id===activeId
```

## 5. Error handling

| Tình huống | Xử lý |
|---|---|
| Bấm gửi khi running | Guard (a) return; disable (b) làm mờ → không gửi |
| Composer refs null (tab connect / chưa build) | `renderMs365Transcript` guard `if (ref !== null) ...` — không crash |
| activeId null (cuộc mới / disconnect) | Không item nào active — đúng |
| Rebuild composer khi chuyển sang connected | `enabled = connected` như cũ; phase-disable phủ lại ở lần `renderMs365Transcript` kế |
| Disconnect | refs về null khi render tab connect; không toggle vào ref cũ |

## 6. Testing

1. **Send-gate (guard)** — gọi `onMs365Send` khi `ms365Phase==="running"` → KHÔNG push message,
   KHÔNG gọi `ms365Chat.send`. Khi `idle` → push + gửi bình thường.
2. **Disable toggle** — `renderMs365Transcript` với `ms365Phase="running"` set
   `send.disabled/input.disabled/chips.disabled = true`; với `idle` (connected) → false. (DOM test
   theo pattern test hiện có trong app/ui/tests.)
3. **Highlight** — `renderMs365Sidebar`/`renderMsAssistant` với `activeId` khớp một conversation →
   item đó có class `ms-history__item-btn--active`; `activeId=null` hoặc không khớp → không item nào có.
4. **Regression** — `npm run typecheck`, focused `ms-assistant-view`/`microsoft-view` tests (nếu có),
   `scripts\verify-fast.bat`. Packaged: gửi 1 lượt → trong lúc chạy nút gửi mờ, bấm không gửi được →
   xong thì bật lại; mở cuộc cũ thấy nó được highlight; bấm Mới → hết highlight.

## 7. Bảo mật & review

- Thuần UI: không chạm secret/backend/permission/runtime. Guard + toggle + class thuần renderer.
- Không đổi contract/controller. Không cần independent review (khác P2-B/P3).
