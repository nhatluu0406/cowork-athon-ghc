---
language: "vi"
status: "approved"
created_at: "2026-07-14"
topic: "ms365-ui-wiring-device-code"
track: "D2"
---

# Design: MS365 UI wiring + device-code OAuth (Slice 2 / D2)

## Mục tiêu

Nối surface UI `ms-connect-view` vào connector backend MS365 đã có (slice 1), để người dùng
**kết nối thật** bằng hai đường:

1. **Manual token** — dán access token (vd từ Graph Explorer), chạy được NGAY, không cần Azure
   app registration.
2. **Device-code OAuth** — đăng nhập bằng tài khoản Microsoft công ty (work/school, delegated,
   AI thao tác thay mặt user). Đọc `CGHC_MS365_CLIENT_ID` + `CGHC_MS365_TENANT` từ env; khi chưa
   cấu hình thì **gated honest** ("cần app registration — nhờ IT"), không giả trạng thái.

Kèm một tài liệu yêu cầu IT (`docs/integration/ms365-it-request.md`) để xin app registration.

Đây là **Slice 2 của track D2**, nối tiếp slice 1 (connector foundation + SharePoint).

## Bối cảnh (trạng thái hiện tại)

- Connector backend đã có: `Ms365Connector` (`connectWithToken`, `connectWithDeviceCode`),
  `DeviceCodeProvider` (Task 5, begin/poll + refresh), `ManualTokenProvider`, Graph client
  SSRF-pinned, SharePoint service, tool dispatch có permission.
- Router `ms365-tool-router.ts` có 3 route: `POST /v1/ms365/tool-call`, `POST /v1/ms365/connect`
  (manual token), `GET /v1/ms365/view`. **Chưa có route device-code.**
- UI `ms-connect-view.ts` là shell tĩnh: nút "Đăng nhập với Microsoft" `disabled` cứng, KHÔNG
  nối vào service-client. Đây là khoảng trống slice này lấp.

## Ngoài phạm vi (out of scope)

- App registration thật trong tenant công ty — do IT cấp (tài liệu yêu cầu nằm trong slice này,
  nhưng việc tạo app là bên ngoài).
- Client credentials / app-only flow.
- Các dịch vụ MS365 khác ngoài SharePoint (Outlook/Planner/Teams... slice sau).
- Refresh-token persistence nâng cao qua nhiều lần khởi động (giữ theo hành vi connector hiện có).

## Kiến trúc

```text
ms-connect-view (UI)  →  service-client (typed HTTP)  →  ms365-tool-router (loopback)  →  Ms365Connector
  card device-code         connectMs365Token()             POST /v1/ms365/connect (đã có)     connectWithToken()
  + manual fallback        beginMs365Device()              POST /v1/ms365/device/begin (mới)  connectWithDeviceCode()
  + connected summary      pollMs365Device()               POST /v1/ms365/device/poll  (mới)  (device-code provider)
                           fetchMs365View()                GET  /v1/ms365/view    (đã có)     buildMs365View()
```

### Cơ chế poll — Option A (UI-driven), đã duyệt

Sau `begin`, service trả `{ userCode, verificationUri, expiresInSec }` và **giữ `device_code`
trong connector**. UI hiện code + nút "Mở trang Microsoft", rồi gọi `POST /device/poll` mỗi ~5s;
mỗi lần poll service hỏi Microsoft một lần và trả `pending | connected | expired`.

Lý do chọn A thay vì backend-driven:

- **One source of truth**: device state ở connector; UI chỉ là poller mỏng. Không có state
  polling song song.
- **Không background task trong service**: mỗi poll là request đồng bộ, xong là hết — không có
  timer/loop ngầm cần quản lý vòng đời/cancel/cleanup. Khớp rule "một execution đồng bộ" của repo;
  runtime/process change được giữ tối thiểu.
- **Tái dùng nguyên `begin()`/`poll()`** của Task 5 — gần như không thêm logic service.
- **Tự nhiên dừng**: user rời tab/đóng card → UI ngừng poll; không có gì mồ côi ở backend.
- **Dễ test**: poll là hàm thuần, deterministic.

## Thành phần & route

### Route service mới (thêm vào `ms365-tool-router.ts`, token-guarded như các route khác)

| Route | Body | Trả về |
|---|---|---|
| `POST /v1/ms365/device/begin` | `{}` | `{ userCode, verificationUri, expiresInSec }` hoặc `{ error: "not_configured" }` khi chưa có client ID |
| `POST /v1/ms365/device/poll` | `{}` | `{ status: "pending" \| "connected" \| "expired", view? }` |
| `POST /v1/ms365/connect` (đã có) | `{ token }` | `Ms365ViewData` |
| `GET /v1/ms365/view` (đã có) | — | `Ms365ViewData` |

Route mới token-guarded (không `publicUnauthenticated`). Body rỗng vẫn validate qua cùng pattern
`Ms365RouterRequestError` → HTTP 400 nếu sai. `view` trong poll `connected` là secret-free
`Ms365ViewData` (không token).

### Cấu hình env → connector (trong `compose-service.ts`, sau flag)

Nơi connector đã được build khi `isMs365Enabled` bật, đọc thêm `CGHC_MS365_CLIENT_ID` +
`CGHC_MS365_TENANT`:

- **Đủ cả hai** → dựng `DeviceCodeProvider` (Task 5) với `{ clientId, tenant, scopes }` và wire
  vào connector để `connectWithDeviceCode` chạy thật.
- **Thiếu** → connector không có device provider; `device/begin` trả `not_configured`.

Không hardcode client ID/tenant; không commit giá trị thật. `tenant` mặc định `common` nếu chỉ
có client ID (nhưng slice này yêu cầu tenant công ty rõ ràng).

### Service-client (typed, trong `service-client.ts`)

- `connectMs365Token(token: string): Promise<Ms365ViewData>`
- `beginMs365Device(): Promise<DeviceBeginResult>` (`DeviceBeginResult = { userCode, verificationUri, expiresInSec } | { error: "not_configured" }`)
- `pollMs365Device(): Promise<DevicePollResult>` (`{ status, view? }`)
- `fetchMs365View(): Promise<Ms365ViewData>`

Mỗi method map đúng một route, trả kết quả typed. Không `any` ở ranh giới.

### UI `ms-connect-view.ts` — ba trạng thái từ dữ liệu thật

1. **Disconnected**: card device-code là chính. Nút "Đăng nhập với Microsoft" **enabled** khi đã
   cấu hình; khi `not_configured` → disabled kèm ghi chú honest "Cần app registration — nhờ IT
   cấu hình client ID". Manual-token fallback là expander thu gọn bên dưới (ô dán token + nút
   "Kết nối bằng token").
2. **Device pending**: sau `begin` → hiện `userCode` (copy được) + nút "Mở trang Microsoft"
   (mở `verificationUri` qua native shell), UI poll mỗi 5s. `expired` → về disconnected kèm ghi
   chú "Mã đã hết hạn, thử lại".
3. **Connected**: summary hiện có (services + scopes đã cấp) từ `view` thật.

## State & error handling

### UI state (cục bộ trong connect view)

`mode: "disconnected" | "device_pending" | "connected"`, kèm `deviceCode`/`verificationUri` khi
pending và một handle timer poll. **Sự thật kết nối luôn đến từ `view` của service** — UI không
tự bịa "connected". Timer poll bị clear khi: `connected`, `expired`, tab-away, unmount view
(không có interval mồ côi). Poll không chồng (bỏ qua nếu request trước chưa xong).

### Error handling (typed, recovery honest)

| Tình huống | Xử lý |
|---|---|
| `not_configured` (chưa có client ID) | Nút device disabled + ghi chú nhờ IT; manual fallback vẫn dùng được. |
| `begin` lỗi (network/Graph) | Banner lỗi + nút thử lại; giữ disconnected. |
| Poll `expired` | "Mã đã hết hạn, thử lại" → disconnected. |
| Poll lỗi transient | Poll lại có giới hạn số lần, hết giới hạn → báo lỗi (không vòng lặp vô hạn). |
| Manual token sai/hết hạn | Connector trả `needs_reconnect`/`error`; UI hiện message đã map. Token không echo. |

### Secrets

Access/refresh token chỉ ở keyring + memory service. `userCode` là mã ghép cặp ngắn hạn (KHÔNG
phải secret) nên hiển thị được. Không token trong UI state, DOM, log, hay response của poll.

## Tài liệu yêu cầu IT

`docs/integration/ms365-it-request.md` (tiếng Việt), checklist app registration:

- Loại: **public client** (không client secret).
- Platform: **Mobile & desktop applications** (device-code).
- **Allow public client flows = Yes** (Authentication → Advanced) — bắt buộc cho device-code.
- Delegated permissions cho slice SharePoint hiện tại: `User.Read`, `Sites.Read.All`,
  `Files.ReadWrite.All` (kèm danh sách đầy đủ cho các dịch vụ sau: Mail/Calendars/Tasks/Channel).
- **Admin consent** nếu tenant yêu cầu (nhiều tenant doanh nghiệp bắt buộc).
- Trả về: **Application (client) ID** + **Directory (tenant) ID** để đặt vào
  `CGHC_MS365_CLIENT_ID` / `CGHC_MS365_TENANT`.

## Testing

- **Service unit**: `device/begin` trả prompt khi configured / `not_configured` khi thiếu env;
  `device/poll` map `pending → connected → expired`; route giữ token-guarded; wiring env→provider
  (đủ 2 env → dựng device provider; thiếu → không có).
- **Service-client unit**: mỗi method mới map đúng route + parse kết quả typed.
- **UI unit**: render đủ 3 trạng thái; nút device disabled+ghi chú khi `not_configured`, enabled
  khi configured; poll dừng khi connected/expired; manual fallback expander kết nối được; không
  token trong state serialize.
- **Focused run**: `npm run typecheck`, targeted UI + service tests, `npm run build:renderer`.
- **Packaged verification**: mở rộng screenshot verifier — chụp card connect disconnected
  (device chính + manual fallback) và, với device provider giả, trạng thái pending. Đăng nhập
  device-code với tenant thật là bước thủ công gated theo IT (ghi honest, không tự động hoá).

## Acceptance criteria

1. Manual token: dán token → `POST /v1/ms365/connect` thật → UI chuyển `connected`; token sai
   → message lỗi honest, không "connected" giả.
2. Device-code khi **đã cấu hình** env: nút enabled → `begin` trả code + link → UI poll → khi
   user đăng nhập xong → `connected`; `expired` xử lý đúng.
3. Device-code khi **chưa cấu hình**: `begin` trả `not_configured`; UI nút disabled + ghi chú
   nhờ IT; không crash; manual fallback vẫn chạy.
4. Không token/secret trong UI state/DOM/log/response poll; client ID/tenant đọc từ env, không
   commit.
5. Route mới token-guarded; body sai → HTTP 400.
6. `docs/integration/ms365-it-request.md` đầy đủ checklist để gửi IT.
7. Typecheck + targeted tests + build renderer PASS; packaged screenshot evidence cho connect card.

## Intake D2 traceability

Cập nhật `docs/integration/external-systems-integration-readiness.md` §5 D2: auth model giờ có
device-code wired (gated theo app registration), UI kết nối thật, revocation/disconnect rõ trạng
thái. Cập nhật `docs/product/current-status.md` sau khi có evidence — và **gỡ** giới hạn "UI chưa
nối backend" khi wiring hoàn tất, thay bằng giới hạn còn lại (device-code cần app registration IT;
tool consumption bởi OpenCode child vẫn là open item).
