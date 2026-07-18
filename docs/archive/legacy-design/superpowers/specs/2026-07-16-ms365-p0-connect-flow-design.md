---
language: "vi"
status: "draft"
created_at: "2026-07-16"
topic: "P0 — Luồng kết nối MS365 (manual token) nối UI vào backend có sẵn"
---

# Thiết kế: P0 — Luồng kết nối Microsoft 365 (manual token)

## 1. Mục tiêu & phạm vi

Mở khoá tab MS365 end-to-end: cho user **kết nối** tài khoản Microsoft bằng **manual access
token**, để `connectionState` chuyển sang `connected` → composer "Trợ lý AI" (đã gate sẵn ở lượt
trước) bật lên và chat/tool MS365 chạy thật. Đây là **P0** trong danh sách cải thiện tab MS365 —
điều kiện tiên quyết cho P1/P2/P3.

### Tiền đề (đã có sẵn — KHÔNG làm lại)
- Backend connect đầy đủ: `Ms365Connector.connectWithToken(token)`, `disconnect()`, `buildMs365View`.
- Routes đã mount: `POST /v1/ms365/connect {token}`, `POST /v1/ms365/disconnect`, `GET /v1/ms365/view`
  — mỗi route trả `Ms365ViewData` (secret-free).
- State machine: `disconnected | connecting | connected | needs_reconnect | error` + granted scopes.
- Composer đã gate "chỉ bật khi `connectionState === "connected"`" (Task 6 lượt trước).
- `Ms365ChatController.disconnect()` tồn tại (revoke scope + đóng stream + clear session) — hiện
  CHƯA có caller (dead code); P0 nối nó vào nút Ngắt kết nối.

### Trong phạm vi (tất cả ở tầng UI)
- Service-client: `connectMs365(token)` + `disconnectMs365()` (map `Ms365ViewData` → renderer view).
- `ms-connect-view`: ô nhập manual token + nút Kết nối + hiện lỗi/scopes + nút Ngắt kết nối.
- app-shell: cập nhật `state.ms365View` từ response connect/disconnect; nút Ngắt gọi cả
  `disconnectMs365()` lẫn `ms365Chat.disconnect()`.

### Ngoài phạm vi (YAGNI)
- Device-code UI (backend có sẵn nhưng cần `CGHC_MS365_CLIENT_ID` — để lượt sau).
- OAuth loopback đăng nhập Microsoft.
- `GET /view` load-on-open / polling.
- Sửa connector/router/session-scope/provider/supervisor.

## 2. Quyết định thiết kế (đã chốt với PO)

| Chủ đề | Quyết định |
|---|---|
| Cơ chế connect | Manual access token (không cần app registration) |
| Xử lý token | Xoá ô input NGAY khi gửi; token chỉ đi qua 1 lần gọi; không lưu state/log |
| Cập nhật view | Lấy `Ms365ViewData` từ response của connect/disconnect (không poll, không load-on-open) |
| Disconnect | Nút Ngắt gọi `POST /disconnect` VÀ `ms365Chat.disconnect()` (revoke scope) — đóng lỗ "grant treo" |

## 3. Kiến trúc

```
Tab MS365 — "Kết nối" tab
  ô nhập token (manual) ──Kết nối──► service-client.connectMs365(token)
                                        → POST /v1/ms365/connect {token}
                                        ← Ms365ViewData (connectionState, scopes, error)
  ô token clear NGAY │ state.ms365View = map(response) │ re-render
        │
        ▼ connectionState === "connected"
  "Trợ lý AI" composer BẬT (gate Task 6, không đổi)

  "Ngắt kết nối" ──► disconnectMs365()      → POST /v1/ms365/disconnect
                     + ms365Chat.disconnect() (revoke Ms365SessionScope + đóng stream + clear session)
                     ← Ms365ViewData (disconnected) │ reset ms365View + transcript state │ re-render
```

Bất biến: token là secret — chỉ truyền 1 lần, backend lưu vault; renderer không chạm DB/secret;
`Ms365SessionScope` là guard thực thi thật; connector/router/provider/supervisor không đổi.

## 4. Thành phần phải sửa (đều ở app/ui)

### A. Service-client — `app/ui/src/service-client.ts`
- `connectMs365(token: string): Promise<MicrosoftIntegrationView>` → `POST /v1/ms365/connect`
  body `{ token }`.
- `disconnectMs365(): Promise<MicrosoftIntegrationView>` → `POST /v1/ms365/disconnect` body `{}`.
- Mapper `Ms365ViewData → MicrosoftIntegrationView`. **VERIFY (không đoán):** hai shape có khớp
  field không (`connectionState`, `scopes`, `services`, `error`). Nếu khớp → map trực tiếp; nếu
  lệch → mapper nhỏ chuẩn hoá. Đây là chỗ dễ sai nhất.

### B. Connect view — `app/ui/src/ui-shell/microsoft/ms-connect-view.ts`
- Thay `renderSignInCard` (nút disabled) bằng: ô nhập token (`type=password`, `autocomplete=off`)
  + nút "Kết nối" (disabled khi ô trống) + vùng hiện `view.error`. Giữ danh sách scopes sẽ xin.
- `renderConnectedSummary`: thêm nút "Ngắt kết nối".
- `MsConnectHandlers { onConnect(token: string): void; onDisconnect(): void }` (pattern như
  `onSend`/`onOpenConnect` Task 6). Handler clear ô token TRƯỚC khi gọi `onConnect`.

### C. Microsoft-view — `app/ui/src/ui-shell/microsoft/microsoft-view.ts`
- Mở rộng `MicrosoftSurfaceHandlers` để truyền `onConnect`/`onDisconnect` xuống `renderMsConnect`.

### D. app-shell — `app/ui/src/app-shell.ts`
- `onMs365Connect(token)`: `state.ms365View = await connectMs365(token)` → re-render (composer bật
  nếu connected).
- `onMs365Disconnect()`: `await disconnectMs365()` + `await ms365Chat.disconnect()` → reset
  `ms365View` + transcript state (`ms365UserText`/`ms365AssistantText`/`ms365Phase`/`ms365Error`)
  → re-render. Fail-safe: reset UI về disconnected kể cả khi một trong hai lời gọi lỗi.
- Giữ `MS_DISCONNECTED_VIEW` làm giá trị khởi tạo state (không hard-code ở nơi render nữa).

### Không đụng
`ms365-connector.ts`, `ms365-tool-router.ts` routes, `ms365-chat-controller.ts` (chỉ GỌI
`disconnect()` sẵn có), session-scope, provider, supervisor, composer-gate + transcript (Task 6).

## 5. Data flow

**Connect:**
```
1. User dán token vào ô (tab "Kết nối", chỉ hiện khi chưa connected), bấm Kết nối.
2. UI đọc value, clear ô NGAY, gọi connectMs365(token).
3. POST /v1/ms365/connect {token} → connectWithToken → verify(/me) → buildMs365View.
4. Response → state.ms365View = map(view); re-render.
   - connected → chuyển tab "Trợ lý AI", composer bật.
   - error/needs_reconnect → hiện view.error ở tab Kết nối; ô token trống; composer khoá.
```

**Disconnect:**
```
1. User bấm Ngắt kết nối (chỉ hiện khi connected).
2. await disconnectMs365()  → POST /disconnect → view (disconnected)
   + await ms365Chat.disconnect()  → revoke Ms365SessionScope + đóng stream + clear session.
3. state.ms365View = disconnected; reset transcript state; re-render → composer khoá.
```

## 6. Error handling

| Tình huống | Xử lý |
|---|---|
| Token sai/hết hạn | verify fail → view `error`/`needs_reconnect` + `view.error`. Hiện lỗi ở tab Kết nối; ô token trống; composer khoá. |
| Token rỗng | Nút Kết nối disabled khi ô trống → không gọi API. |
| Service chưa sẵn sàng / mạng | `call()` ném → hiện lỗi thân thiện; giữ disconnected. |
| Một trong hai disconnect lỗi | Fail-safe: vẫn reset UI về disconnected; revoke scope ưu tiên, không để treo. |
| Token lưu state/log | KHÔNG — chỉ truyền 1 lần vào body request; backend lưu vault. |

## 7. Testing

1. **Service-client** — `connectMs365(token)` POST đúng `/v1/ms365/connect` body `{token}`, trả view;
   `disconnectMs365()` POST `/disconnect`. Token không xuất hiện ngoài body request.
2. **ms-connect-view** — nút Kết nối disabled khi ô trống; bấm → handler nhận token + ô được clear;
   hiện `view.error` khi error; nút Ngắt hiện khi connected.
3. **app-shell wiring** — connect thành công → `state.ms365View` cập nhật + composer bật; Ngắt → gọi
   cả `disconnectMs365` + `ms365Chat.disconnect`, transcript reset.
4. **Regression** — `npm run typecheck`, `npm test` (đối chiếu baseline: chỉ pre-existing fail),
   `scripts\verify-fast.bat`. **Packaged acceptance** (mở khoá end-to-end thật): PO dán token thật →
   chat MS365 → gọi tool → hành động ghi hiện thẻ phê duyệt → Ngắt kết nối (composer khoá lại).

## 8. Bảo mật & review

- Token Microsoft KHÔNG vào state/log/DOM lâu dài — chỉ 1 lần trong body POST; backend lưu vault.
- Chạm credential flow (token) + boundary → nên có independent review theo CLAUDE.md.
- P0 hoàn tất mở khoá P1 (sửa các correctness finding), P2 (history UI / transcript nhiều lượt /
  tool activity), P3 (port race / plugin gate) — brainstorm từng phase đúng lúc.
