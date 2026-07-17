---
language: "vi"
status: "draft"
created_at: "2026-07-16"
topic: "P1 — Correctness hardening cho MS365 chat (half-init, IPv6 endpoint, scope-hardening, multi-turn transcript)"
---

# Thiết kế: P1 — Correctness hardening cho MS365 chat

## 1. Mục tiêu & phạm vi

Sửa 4 lỗi correctness đã phát hiện qua code review + final review P0, để luồng chat MS365 (vừa
mở khoá ở P0) hoạt động đúng và bền: không kẹt half-init, endpoint IPv6 hợp lệ, disconnect luôn
dọn sạch, và transcript hiển thị đầy đủ nhiều lượt. Đây là **hardening**, không phải tính năng mới.

### Trong phạm vi (2 file lõi + transcript ở app-shell)
- **#1 Half-init session** — `ms365-chat-controller.ts`.
- **#2 + transcript multi-turn** — `ms365-chat-controller.ts` (giữ 1 session) + `app-shell.ts` (mảng messages).
- **#3 IPv6 endpoint** — `live-launch.ts` (helper `formatHostForUrl`).
- **#4 Scope-hardening** — `ms365-chat-controller.ts` (`finally`).

### Ngoài phạm vi (YAGNI / follow-up)
- Backend `/v1/ms365/disconnect` revoke-all session scope (follow-up — rủi ro thực = 0 qua UI vì
  connection torn down + composer ẩn; client-side `finally` đã đủ).
- P2: history-browsing UI, load transcript từ conversation SQLite.
- P3: port TOCTOU race, plugin gate.
- Không đụng backend router/connector/session-scope/supervisor.

## 2. Quyết định thiết kế (đã chốt với PO)

| Chủ đề | Quyết định |
|---|---|
| Multi-turn | Giữ 1 session liên tục (agent nhớ ngữ cảnh); render đầy đủ nhiều lượt |
| Nguồn transcript | Mảng `ms365Messages[]` trong state UI (không load từ SQLite — đó là P2) |
| Scope-hardening | Chỉ client-side (`finally`); backend revoke-all để follow-up |

## 3. Kiến trúc

4 fix độc lập, mỗi cái một trách nhiệm. #1/#4 trong controller; #3 trong live-launch; #2+transcript
trong controller (bỏ single-shot state) + app-shell (mảng messages). Bất biến giữ nguyên:
connected-gate, one-time scope per session, secret không lộ, `Ms365SessionScope` là guard thật.

## 4. Chi tiết từng fix

### #1 — Half-init session (`app/ui/src/ms365-chat-controller.ts`, ~dòng 34-47)
**Bug:** `ensureSession` gán `sessionId = session.id` TRƯỚC `setMs365SessionScope`/`startStream`. Nếu
chúng throw, `sessionId` đã set → lần `send()` sau bỏ qua `ensureSession` (guard `sessionId !==
null`) → gửi vào session chưa cấp scope / chưa mở stream.
**Fix:** dùng biến cục bộ `const sid = session.id`; gọi `setMs365SessionScope(sid, true)` +
`startStream(sid)`; **chỉ** gán `sessionId = sid` / `stream = ...` SAU KHI cả hai thành công. Throw →
`sessionId` vẫn `null` → `ensureSession` chạy lại lần sau (tự phục hồi). Giữ `conversationId` đã tạo
để tái dùng (không tạo conversation rác mỗi retry).

### #2 + transcript multi-turn (`ms365-chat-controller.ts` + `app/ui/src/app-shell.ts`)
**Bug:** mọi prompt tái dùng 1 session (đúng), nhưng transcript chỉ hiện 1 cặp bubble (state đơn
`ms365UserText`/`ms365AssistantText`) → lượt trước biến mất.
**Fix:** controller GIỮ NGUYÊN hành vi 1-session-tái-dùng. Đổi transcript ở app-shell:
- State: thay 2 biến đơn bằng `ms365Messages: { role: "user" | "assistant"; text: string }[]`.
- Gửi prompt: push `{role:"user",text}` + push `{role:"assistant",text:""}` (bubble chờ); stream
  `onView` cập nhật `text` của phần tử assistant CUỐI in-place; terminal completed → chốt.
- `renderMs365Transcript` render toàn mảng (mỗi phần tử một bubble). Phase `running`/`failed` gắn
  lượt cuối.
- Disconnect / connect lại: `ms365Messages = []`.

### #3 — IPv6 endpoint (`service/src/composition/live-launch.ts`, ~dòng 195)
**Bug:** `` `http://${serviceHost}:${servicePort}` `` sai khi `serviceHost` là IPv6 (`::1`) → produces
`http://::1:PORT` (thiếu `[]`), mọi MS365 tool call fail network_error.
**Fix:** helper thuần `formatHostForUrl(host: string): string` → bọc `[...]` khi host chứa `:`
(IPv6), giữ nguyên IPv4/hostname. Endpoint dùng helper → `http://[::1]:PORT/...`.

### #4 — Scope-hardening (`ms365-chat-controller.ts` `disconnect()`, ~dòng 62-71)
**Bug:** clear `sessionId`/`stream`/`conversationId` chạy SAU `await setMs365SessionScope(false)`,
không trong `finally`. Nếu revoke throw → session/stream treo trong controller.
**Fix:** bọc revoke trong `try`, đưa clear (`sessionId`/`stream`/`conversationId` + `stream?.stop()`)
vào `finally` → dù revoke fail, controller vẫn sạch; connect lại tạo session mới sạch.

## 5. Error handling

| Tình huống | Xử lý |
|---|---|
| #1 allow-scope/startStream throw giữa ensureSession | `sessionId` vẫn null → send ném lên app-shell → phase `failed` + bubble cuối hiện lỗi; retry chạy lại sạch. |
| #1 conversation đã tạo nhưng session fail | Giữ `conversationId` tái dùng (không tạo conversation rác). |
| #3 host IPv4/hostname | `formatHostForUrl` trả nguyên trạng — không hồi quy endpoint hiện tại. |
| #4 revoke throw khi disconnect | `finally` vẫn clear → controller + UI sạch. |
| Transcript stream lỗi giữa lượt | Bubble assistant cuối giữ text đã nhận + phase `failed`; không xoá lượt user. |
| Transcript disconnect giữa lượt | `ms365Messages=[]` + revoke qua `disconnect()`. |

## 6. Testing

1. **#1 half-init (quan trọng nhất)** — fake `setMs365SessionScope` throw lần đầu → `ensureSession`
   ném, `runtimeSessionId` vẫn null; lần 2 (scope ok) → createSession + allow + stream đủ, gửi được.
   Khẳng định KHÔNG gửi vào session chưa-allow.
2. **#3 IPv6** — `formatHostForUrl("::1")` → `"[::1]"`; `("127.0.0.1")` → `"127.0.0.1"`;
   `("localhost")` → `"localhost"`. (Nếu tiện) live-launch với `input.host="::1"` → endpoint chứa
   `http://[::1]:`.
3. **#4 scope-hardening** — fake `setMs365SessionScope(false)` throw trong `disconnect()` → revoke
   vẫn được gọi, `runtimeSessionId` về null; `send()` sau tạo session mới.
4. **#2 transcript multi-turn** — gửi 2 prompt liên tiếp → tái dùng cùng session (createSession 1
   lần, allow 1 lần); `ms365Messages` đủ 2 cặp bubble; stream cập nhật đúng bubble assistant cuối.
5. **Regression** — `npm run typecheck`, `npm test` (đối chiếu baseline: chỉ pre-existing fail),
   `scripts\verify-fast.bat`. Packaged acceptance: PO chat MS365 nhiều lượt thấy đủ lịch sử phiên;
   ngắt kết nối sạch.

## 7. Bảo mật & review

- #1 đóng lỗ "gửi vào session chưa cấp scope" (đúng nghĩa correctness bảo mật). #4 đảm bảo controller
  luôn sạch sau disconnect.
- Renderer không chạm DB/secret. `Ms365SessionScope` vẫn là guard thực thi thật.
- Chạm luồng scope/session → nên có independent review theo CLAUDE.md.
- Backend `/disconnect` revoke-all là follow-up defense-in-depth (rủi ro thực = 0 qua UI hiện tại).
