---
language: "vi"
status: "approved"
created_at: "2026-07-13"
topic: "ms365-connector-sharepoint"
track: "D2"
---

# Design: MS365 Connector Foundation + SharePoint (Slice 1 / D2)

## Mục tiêu

Xây **cơ chế connector chung MS365** (auth, Microsoft Graph client, credential store,
port/adapter, tool registration vào runtime, permission enforcement) và chứng minh
end-to-end bằng **một dịch vụ: SharePoint** (tìm kiếm theo tên/nội dung, query theo
yêu cầu User, upload tài liệu có permission).

Đây là **Slice 1 của track D2** (Microsoft automation). Các nhóm tác vụ còn lại —
Planner, Lists, Outlook, Teams chat/channels, Power Automate — là các slice kế tiếp,
**dùng chung** connector này. SharePoint và Outlook được ưu tiên vì là connector chung
"để những tab khác có thể sử dụng".

Slice này tuân theo intake D2 trong
[External Systems Integration Readiness](../../integration/external-systems-integration-readiness.md)
(feature flag OFF mặc định trên baseline; surface `microsoft` chỉ `available` khi có connector thật).

## Ngoài phạm vi (out of scope)

- Planner, Lists, Outlook, Teams, Power Automate — slice sau, không implement ở đây.
- App registration Azure thật / client ID production — chưa cấu hình; device code flow được
  code + test nhưng **gated** cho tới khi có client ID.
- Thay đổi UI shell surface `microsoft` ngoài việc bind `MicrosoftIntegrationView` thật vào
  connector state (UI shell disconnected đã tồn tại ở slice trước).
- MCP protocol / `mcp-registry.ts` — quyết định dùng **internal service tool qua loopback**,
  không qua MCP.

## Kiến trúc & boundary

```text
┌─ OpenCode child (tool-calling runtime) ──────────────┐
│  model quyết định tool call → gọi loopback tool URL  │
└──────────────────────┬────────────────────────────────┘
                       │ loopback HTTP (token-guarded, cùng auth như các route service khác)
┌──────────────────────▼────────────────────────────────┐
│  Local application service (sở hữu TOÀN BỘ logic MS365)│
│                                                         │
│  ms365-tool-router ──▶ PermissionGate (mọi write)       │
│        │                                                │
│  Ms365Connector (port) ──── one source of truth         │
│        ├─ TokenProvider (port)                          │
│        │    ├─ ManualTokenProvider  (dán token)         │
│        │    └─ DeviceCodeProvider   (OAuth, gated)      │
│        ├─ GraphClient (port/adapter, SSRF-pinned)       │
│        └─ credential store (keyring — hiện có)          │
│                                                         │
│  SharePointService (dùng Ms365Connector)               │
└─────────────────────────────────────────────────────────┘
```

Nguyên tắc (khớp `.claude/rules/architecture.md` + `security.md`):

- **Toàn bộ logic MS365 nằm service-side.** Renderer không chạm Graph, token, hay keyring.
- **Một connector seam** (`Ms365Connector`) mà SharePoint (slice này) và các dịch vụ MS365
  tương lai tái dùng — chính là "cơ chế connector chung MS365".
- **Auth sau một `TokenProvider` port**, hai adapter (manual paste bây giờ, device code sau);
  connector không quan tâm loại nào.
- **Graph HTTP qua port/adapter**, pin `graph.microsoft.com` theo SSRF policy hiện có.
- **Mọi write đi qua `PermissionGate` hiện có** tại execution boundary. Không tạo cơ chế xác
  nhận thứ hai song song (one source of truth per state type).
- **"Internal service tool, không MCP":** tool được định nghĩa bằng contract loopback **của
  chính chúng ta** và đăng ký vào OpenCode lúc spawn — không dùng MCP protocol hay
  `mcp-registry.ts`.

### Lý do loopback tool bridge (honest constraint)

OpenCode (child process) sở hữu vòng lặp tool-calling. Service gửi prompt; model bên trong
OpenCode quyết định tool call; service chỉ quan sát qua event stream + permission gate. Không
có side-channel để tiêm một hàm JS in-process vào child process riêng biệt. Vì vậy tool MS365
phải expose qua một **wire contract**. Giải pháp: service host các tool MS365 trên **loopback
HTTP surface hiện có** (token-guarded), OpenCode được trỏ tới đó lúc spawn. Logic connector,
Graph client, keyring, permission gate **hoàn toàn ở service-side**; chỉ một tool-call envelope
mỏng đi qua boundary. Điều này tôn trọng "không MCP" (contract loopback riêng, không phải giao
thức/registry MCP) mà vẫn khả thi với runtime hiện tại.

## Connector seam & auth model

### `Ms365Connector` (port)

```ts
interface Ms365Connector {
  connectionState(): MicrosoftConnectionState;      // tái dùng enum contract hiện có
  connectWithToken(accessToken: string): Promise<ConnectResult>;   // manual paste
  connectWithDeviceCode(): Promise<DeviceCodePrompt>;              // gated; trả user_code + verification_url
  disconnect(): Promise<void>;
  graph(): GraphClient;                             // đã xác thực, refresh-aware
}
```

### `TokenProvider` port — hai adapter, chung một keyring entry (`cowork-ghc/ms365`)

| Adapter | Hành vi | State transitions |
|---|---|---|
| `ManualTokenProvider` | User dán bearer token (vd từ Graph Explorer). Service validate bằng một call `GET /me`, lưu keyring. | `disconnected → connecting → connected`. Hết hạn (~1h) → `needs_reconnect` (không auto-refresh — token thủ công không có refresh token). |
| `DeviceCodeProvider` *(code ở slice này, activate khi có app registration)* | OAuth device code chuẩn; lưu refresh token; auto-refresh access token. | `disconnected → connecting → connected`; refresh im lặng giữ `connected`; refresh fail → `needs_reconnect`. |

Xử lý honest với ràng buộc "có thể chưa có quyền access":

- **Manual token path chạy được ngay** — chứng minh connector + SharePoint + tool + permission
  end-to-end mà không cần app registration Azure.
- **Device code path được code + unit-test với fake OAuth endpoint**, nhưng nút UI disabled kèm
  ghi chú honest (`"Cần app registration Azure — chưa cấu hình"`) tới khi có client ID thật.
  Không có state "connected" giả.

### Secret rules

Access/refresh token chỉ nằm ở keyring + in-memory service; **không bao giờ** ở renderer state,
EV frame, log, hay tool-call envelope. `MicrosoftIntegrationView` gửi cho UI chỉ mang
`connectionState`, danh sách service, scopes, và action history đã redact — không mang token.
Redaction tái dùng `secret-scrubber` hiện có.

## Tool model & permission flow

### Đăng ký tool vào OpenCode

Lúc child spawn, supervisor đăng ký tập tool MS365 trỏ tới loopback surface của service
(token-guarded, cùng auth như mọi route service khác). Khi model gọi tool, call rơi vào
`ms365-tool-router`:

1. Kiểm tra connector state — nếu chưa `connected`, trả kết quả có cấu trúc `not_connected`
   (model relay honest; không crash).
2. **Read** → thực thi trực tiếp qua `GraphClient`.
3. **Write** → submit `PermissionRequest` vào `PermissionGate` hiện có; `proceed()` chạy Graph
   mutation **chỉ khi** có Allow được ghi nhận. Deny chặn và reply deny — giống hệt enforcement
   ghi file hiện tại.

### SharePoint tools (Slice 1)

| Tool | Kind | Graph operation | Permission |
|---|---|---|---|
| `sharepoint_search` | read | `/search/query` (driveItem) — tìm theo tên + nội dung | không (read) |
| `sharepoint_list_site_files` | read | `/sites/{id}/drive/root/children` | không (read) |
| `sharepoint_get_file_summary` | read | tải nội dung text bounded để model tóm tắt | không (read) |
| `sharepoint_upload_file` | **write** | `PUT /drive/items/.../content` (upload file trong workspace) | **PermissionGate** — modal Allow/Deny |

Bao phủ yêu cầu SharePoint: *tìm kiếm tên và nội dung* (search), *query theo yêu cầu*
(model tự dựng `$search`/KQL từ prompt), *upload tài liệu* (write có permission).

### Mapping hành vi kỳ vọng (áp dụng cho mọi dịch vụ MS365)

- *"tìm … có tồn tại và trả lời cho user"* → read tool trả candidates; nếu mơ hồ, **model hỏi
  lại trong hội thoại** (clarifying question), không phải dialog riêng.
- *"nếu chưa rõ … confirm với User"* → với write, **modal PermissionGate** chính là xác nhận.
  Một cơ chế duy nhất, không có confirm song song.

### Bounded / safe defaults

- Search results cap (vd 25).
- File-summary download cap theo byte (tái dùng limit 64 KiB của File Review).
- GraphClient có timeout + typed error mapping: `auth_expired`, `rate_limited`, `not_found`,
  `graph_error`.
- Workspace-boundary check trên file local trước mọi upload (chống path traversal / escape).

## State & error handling

- Connector state là **one source of truth** service-side; UI đọc `MicrosoftIntegrationView`
  qua route hiện có, không duplicate.
- Lỗi Graph map sang typed error + recovery action (vd `auth_expired` → "Kết nối lại
  Microsoft 365"). Không hiện raw stack cho user.
- Rate limit (429) tôn trọng `Retry-After`; không infinite retry.
- Token hết hạn → `needs_reconnect`, UI hiện honest, không giả "connected".

## Testing

**Unit (service):**
- `ManualTokenProvider`: validate token, lưu/đọc keyring, hết hạn → `needs_reconnect`.
- `DeviceCodeProvider`: device code + refresh với fake OAuth endpoint; refresh fail → `needs_reconnect`.
- `GraphClient` adapter: SSRF pin `graph.microsoft.com`; error mapping (401/404/429/5xx → typed).
- Secret redaction: token không xuất hiện trong `MicrosoftIntegrationView`, log, hay envelope.
- `ms365-tool-router`: `not_connected` khi chưa connect; read chạy trực tiếp; write submit
  PermissionGate và **chỉ** mutate khi Allow; Deny chặn.
- `SharePointService`: dựng query search; cap results; bounded summary; workspace-boundary
  check trước upload.

**Contract:** tool-call envelope loopback (request/response shape); `MicrosoftIntegrationView`
mapping (không lộ secret).

**Integration:** tool-router → PermissionGate → GraphClient (fake Graph) round trip; Deny thực
sự chặn upload.

**Focused run:** `npm run typecheck`, targeted service + UI tests, `npm run build:renderer`.

**Packaged verification (user-facing acceptance):** kịch bản manual-token connect → SharePoint
search → get summary → upload (Allow) → upload (Deny chặn) → disconnect → relaunch state honest.
Cập nhật `docs/product/current-status.md` sau khi có evidence.

## Acceptance criteria

1. Connect bằng **manual token** thành công; `connectionState` = `connected`; sai/hết hạn token
   → `needs_reconnect` honest.
2. Device code path được code + unit-test với fake OAuth, nhưng **gated** (nút disabled, ghi chú
   honest) tới khi có client ID; không có "connected" giả.
3. SharePoint: `sharepoint_search` tìm theo tên + nội dung; model tự dựng query từ prompt;
   `sharepoint_get_file_summary` tóm tắt nội dung bounded; `sharepoint_upload_file` là write
   qua PermissionGate — Allow mới upload, Deny chặn thật.
4. Connector seam (`Ms365Connector` + `TokenProvider` + `GraphClient`) là port/adapter tái dùng
   được cho dịch vụ MS365 kế tiếp mà không sửa lại core.
5. Không secret trong log / state / DOM / envelope / screenshot; UI không truy cập Graph/keyring
   trực tiếp; mọi write enforce tại execution boundary.
6. Feature flag D2 **OFF mặc định** trên baseline; surface `microsoft` chỉ `available` khi
   connector thật hiện diện; baseline journeys vẫn PASS khi OFF.
7. Typecheck + targeted tests + build renderer PASS; packaged evidence được tạo.

## Intake D2 traceability

Slice này là bước implement đầu tiên của track D2. Khi hoàn tất, cập nhật §3 integration matrix
và §5 D2 acceptance trong
[External Systems Integration Readiness](../../integration/external-systems-integration-readiness.md):
Auth model (OAuth device code + manual token), scopes (least-privilege SharePoint), một read-only
Graph action + một bounded write có permission, revocation clears state, connector events trong
audit (no secret), packaged journey connect → list/search → upload → disconnect → relaunch honest.
