---
language: "vi"
status: "approved"
created_at: "2026-07-14"
topic: "ms365-connect-ui-polish"
track: "D2"
---

# Design: Cải thiện UI tab Kết nối MS365 (2 nút + quyền thực + disconnect)

## Mục tiêu

Cải thiện tab "Kết nối" của surface Microsoft 365 (nối tiếp slice UI wiring):

1. **Hai nút rõ ràng**: "Đăng nhập với Microsoft" (device-code) + "Kết nối thủ công bằng token".
   Nhấn nút Manual mới hiện token box (mặc định ẩn). Không hiện cả token box lẫn device song song.
2. **Style đồng bộ theme**: nút Manual + token box + nút Kết nối dùng đúng design token (border,
   radius, accent) như các control khác. Token box **đủ dài** (JWT dài) — dùng `textarea`.
3. **Sau khi connect**: hiển thị **quyền THỰC** account đang có (decode claim `scp` của access
   token), không phải danh sách tĩnh "sẽ xin".
4. **Nút "Ngắt kết nối"** cho account đã connected → gọi `disconnect()` thật → về disconnected.

## Ngoài phạm vi

- Verify chữ ký JWT (chỉ decode payload để đọc `scp` hiển thị — token đã được Graph chấp nhận ở
  bước verify `/me`).
- Gọi thêm Graph để lấy tên/email account (chỉ dùng `scp` từ token đang có).
- Thay đổi device-code flow, routes, hay connector state machine (ngoài việc thêm grantedScopes).

## Backend: capability đọc quyền thực

- **`decodeTokenScopes(accessToken: string): string[]`** (hàm thuần, service-side, file mới
  `service/src/ms365/token-scopes.ts`): tách phần payload của JWT (đoạn giữa giữa hai dấu `.`),
  base64url-decode, `JSON.parse`, đọc claim `scp` (delegated scopes, space-separated string) →
  `string[]`. Nếu có claim `roles` (app permissions) thì gộp thêm. An toàn: input không phải JWT
  hợp lệ / thiếu `scp` → trả `[]`, KHÔNG throw. KHÔNG verify chữ ký. KHÔNG log token.
- **`Ms365Connector.grantedScopes(): readonly string[]`**: trả mảng scope đã điền khi connect
  thành công (manual hoặc device), từ `decodeTokenScopes(token)`. Reset `[]` khi disconnect.
  Connector đọc token qua `getToken()` của active provider sau khi verify OK, decode, lưu mảng.
  Chỉ lưu mảng string (không nhạy cảm), không lưu/log token.
- **`buildMs365View`**: khi `connectionState === "connected"` → `scopes` = `connector.grantedScopes()`
  (quyền thực). Khi khác → giữ danh sách tĩnh truyền vào (danh sách "sẽ xin", như hiện tại).

## UI: `ms-connect-view.ts`

### Disconnected

- Card: logo + tiêu đề "Kết nối Microsoft 365".
- **Nút 1** `.ms-connect__signin` "Đăng nhập với Microsoft" (device-code — hành vi hiện có:
  `beginMs365Device`, gated honest khi `not_configured`).
- **Nút 2** `.ms-connect__manual-toggle` "Kết nối thủ công bằng token". Nhấn → toggle hiện/ẩn
  khối manual (`.ms-connect__manual`), mặc định **ẩn**.
- **Khối manual** (ẩn tới khi nhấn nút 2): `textarea.ms-connect__manual-input` **full-width, đủ
  cao (2–3 dòng)** cho JWT dài + nút `.ms-connect__manual-submit` "Kết nối" → `connectMs365Token`.
  Lỗi hiển thị trong `.ms-connect__manual-error`.
- Danh sách "QUYỀN SẼ XIN KHI KẾT NỐI" (tĩnh) giữ như hiện tại.
- **Style**: nút Manual + toggle + textarea + submit dùng design token trung tâm (giống nút/ô
  input khác trong app), không style thô. Textarea kế thừa font/màu/border theme, resize dọc.

### Connected

- Card: "Microsoft 365" + pill "Đã kết nối".
- Dịch vụ: SharePoint (đang bật) — như hiện tại.
- **"QUYỀN ĐANG CÓ"**: render `view.scopes` (quyền THỰC từ `scp`). Nếu rỗng → ghi chú honest
  "Không đọc được danh sách quyền từ token này."
- **Nút `.ms-connect__disconnect` "Ngắt kết nối"** → gọi một method client `disconnectMs365()`
  (route mới `POST /v1/ms365/disconnect` → `connector.disconnect()`), rồi `onViewChange(view)` về
  disconnected. (Nếu đã có đường disconnect thì tái dùng; nếu chưa, thêm route + client method
  tối giản, token-guarded.)

## State & secret

- UI state cục bộ thêm `manualOpen: boolean` (toggle token box). Sự thật kết nối vẫn từ
  `deps.view`. Không token trong state/DOM/log. `scp` scopes là string không nhạy cảm.
- `decodeTokenScopes` không throw, không log token.

## Testing

- **Unit (service)**: `decodeTokenScopes` — JWT hợp lệ có `scp` → mảng scopes; không phải JWT →
  `[]`; thiếu `scp` → `[]`; có `roles` → gộp. `grantedScopes()` điền sau connect, reset sau
  disconnect. `buildMs365View` connected dùng grantedScopes.
- **Unit (UI)**: 2 nút hiện ở disconnected; token box ẩn mặc định, nhấn Manual → hiện; connected
  hiện `view.scopes` thực + nút Ngắt kết nối; nhấn Ngắt kết nối gọi `disconnectMs365` → onViewChange.
- **Build**: typecheck + build:renderer PASS; packaged verifier (assert 2 nút + manual toggle,
  không assert live connection) exit 0.

## Acceptance criteria

1. Disconnected: 2 nút (Microsoft + Manual) hiện; token box ẩn tới khi nhấn Manual.
2. Token box full-width, đủ cao cho JWT dài, style đồng bộ theme.
3. Connected: hiển thị quyền THỰC từ token (`scp`); rỗng → ghi chú honest.
4. Connected: nút "Ngắt kết nối" gọi disconnect thật → về disconnected.
5. Không token/secret trong state/DOM/log; `decodeTokenScopes` an toàn với input lỗi.
6. typecheck + UI/service tests + build:renderer PASS; packaged evidence.
