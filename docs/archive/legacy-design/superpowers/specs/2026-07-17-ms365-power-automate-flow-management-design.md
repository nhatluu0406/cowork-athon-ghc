---
language: "vi"
status: "approved"
created_at: "2026-07-17"
topic: "MS365 — Quản lý Custom Power Automate flows (add / enable-disable / timeout / trigger feedback)"
---

# Thiết kế: Quản lý Custom Power Automate flows trong tab Microsoft 365

## 1. Bối cảnh & động lực

Trong tab Microsoft 365, Power Automate là **năng lực duy nhất không cần đăng nhập
Microsoft**: một flow có trigger *"When an HTTP request is received"* thực chất là một
webhook, URL của nó tự mang chữ ký SAS (`...&sig=...`) đóng vai trò bearer. App chỉ cần
POST payload JSON vào URL đó ([power-automate-service.ts:33-38](../../../service/src/ms365/power-automate-service.ts));
việc chạm Outlook/Teams/OneDrive do các connector **bên trong flow** thực hiện, dưới
connection đã cấu hình sẵn trong Power Automate.

Hiện trạng còn thiếu:

- **Không có UI/route để đăng ký flow.** `PowerAutomateStore.setFlows` tồn tại nhưng
  **không route nào gọi tới**; store rỗng mặc định và chỉ sửa được bằng cách chỉnh tay
  file `.runtime/ms365-power-automate.json`.
- **Không tự khám phá được flow** (đó là thao tác cần đăng nhập + license Power Platform,
  đúng thứ đang bị chặn) → người dùng phải tự add từng flow muốn dùng.
- `triggerFlow` **vứt bỏ response body**, chỉ trả HTTP status → không có "feedback" của
  flow trả về cho người dùng/agent.
- Không có khái niệm bật/tắt hay timeout cho từng flow.

## 2. Mục tiêu / Ngoài phạm vi

**Mục tiêu (một slice user-visible):**

1. Người dùng **add / xóa** flow tùy chỉnh (tên + URL) ngay trong UI tab MS365.
2. Mỗi flow có **toggle enable/disable**; flow bị tắt không được agent trigger.
3. Mỗi flow có **timeout chỉnh được** (setting theo từng flow).
4. Khi trigger, app **chờ và trả về feedback (response body) của flow** trong giới hạn
   timeout đó.

**Ngoài phạm vi (YAGNI):**

- Không auto-discovery flow từ tài khoản (cần login/license — mâu thuẫn với đường webhook).
- Không thêm nút "Trigger" chạy thử ngay trong Settings (việc trigger vẫn do agent gọi tool
  trong chat MS365, qua Permission gate như hiện tại).
- Không hiển thị/sửa lại URL sau khi add (URL là secret — xem §8).
- Không gỡ bỏ đường trigger bằng `url` trực tiếp (giữ backward-compat).
- Không đụng tới việc tách gate `not_connected` (bàn riêng nếu cần trigger khi chưa login).

## 3. Kiến trúc & luồng dữ liệu

```
UI (ms-connect-view: renderConnectedSummary)
  └─ Section "Power Automate (tùy chỉnh)"  ──HTTP──▶  service-client.ts
        add / delete / toggle / set-timeout                │
                                                           ▼
                                        ms365-tool-router.ts  (4 route mới)
                                                           │
                                                           ▼
                                        PowerAutomateStore  →  .runtime/ms365-power-automate.json

Agent (chat tab MS365)
  └─ tool power_automate_trigger_flow { name | url, payload }
        └─ ms365-tools.handlePowerAutomateWrite
             ├─ resolve name→url (từ store; từ chối nếu disabled/không có)
             ├─ Permission gate (Allow)  [giữ nguyên]
             └─ PowerAutomateService.triggerFlow(url, payload, timeoutMs)
                   └─ SSRF check → fetch(POST) → await body (bounded) → { status, body }
```

Section chỉ hiển thị khi `connectionState === "connected"` (đặt trong
`renderConnectedSummary`), theo quyết định đã chốt.

## 4. Data model (store)

Mở rộng `PowerAutomateFlow` trong
[power-automate-store.ts](../../../service/src/ms365/power-automate-store.ts):

```ts
export interface PowerAutomateFlow {
  readonly name: string;
  readonly url: string;        // secret (SAS) — chỉ ở server, không gửi renderer
  readonly enabled: boolean;   // mặc định true khi add
  readonly timeoutMs: number;  // per-flow; mặc định DEFAULT_FLOW_TIMEOUT_MS
}
```

- **Backward-compat**: `isFlow` (ở store + [power-automate-file-persistence.ts](../../../service/src/ms365/power-automate-file-persistence.ts))
  chấp nhận entry cũ thiếu `enabled`/`timeoutMs`, điền mặc định `enabled=true`,
  `timeoutMs=DEFAULT_FLOW_TIMEOUT_MS` khi nạp — file cũ không vỡ.
- `DEFAULT_FLOW_TIMEOUT_MS = 120_000` (120s — trần sync-response thực tế của Power Automate).
- **Ràng buộc validate**: `name` không rỗng và **duy nhất** (add trùng tên → 409/lỗi rõ);
  `url` không rỗng; `timeoutMs` là số nguyên trong `[1_000, 600_000]` (clamp/từ chối ngoài
  biên).

Bổ sung API store (giữ `list()`; thêm thao tác granular, đều persist):

```ts
list(): readonly PowerAutomateFlow[];                 // full, incl url (server-side)
add(flow: {name; url; timeoutMs}): Promise<void>;     // enabled=true; lỗi nếu trùng tên
remove(name: string): Promise<void>;
setEnabled(name: string, enabled: boolean): Promise<void>;
setTimeout(name: string, timeoutMs: number): Promise<void>;
resolve(name: string): PowerAutomateFlow | null;      // cho tool trigger-by-name
```

## 5. Backend routes (mirror `sites` / `write-mode` trong [ms365-tool-router.ts](../../../service/src/ms365/ms365-tool-router.ts))

`PowerAutomateStore` được đưa vào router deps (hiện chưa có). Mọi route trả về **danh sách
công khai** (không kèm url):

| Method + Path | Body | Trả về |
|---|---|---|
| `GET  /v1/ms365/flows` | — | `{ flows: PublicFlow[] }` |
| `POST /v1/ms365/flows` | `{ name, url, timeoutMs? }` | `{ flows }` |
| `POST /v1/ms365/flows/delete` | `{ name }` | `{ flows }` |
| `POST /v1/ms365/flows/toggle` | `{ name, enabled }` | `{ flows }` |
| `POST /v1/ms365/flows/timeout` | `{ name, timeoutMs }` | `{ flows }` |

```ts
interface PublicFlow { name: string; enabled: boolean; timeoutMs: number } // KHÔNG url
```

Path constants đặt cạnh `MS365_WRITE_MODE_PATH`. Parse body có validate (mirror
`parseToggleBody`/`parseWriteModeBody`); body sai → 400 với message không lộ secret.

## 6. Trigger + "chờ Flow feedback" ([power-automate-service.ts](../../../service/src/ms365/power-automate-service.ts))

Đổi chữ ký:

```ts
triggerFlow(input: { url: string; payload?: unknown; timeoutMs: number })
  : Promise<{ status: number; body: string }>;
```

- Giữ `SsrfPolicy.assertAllowed(url)` trước fetch (SSRF-pin — không đổi).
- `fetch(POST, { redirect: "error" })` với **AbortController** hủy sau `timeoutMs`;
  quá hạn → `Ms365Error("timeout", ...)` với recovery ("Flow chạy lâu hơn timeout; tăng
  timeout hoặc để flow trả Response sớm hơn.").
- Đọc body **bounded 64 KiB** (cắt an toàn như các body MS365 khác), trả `{ status, body }`.
- `!response.ok` vẫn ném `Ms365Error("graph_error", ...)` như cũ nhưng kèm body đã cắt để
  người dùng thấy lý do.
- Ghi chú tài liệu: muốn feedback có nghĩa, flow phải **kết thúc bằng action "Response"**
  (Request connector). Flow fire-and-forget trả `202` + body rỗng — app báo trung thực.

## 7. Enable/disable có hiệu lực + gọi theo tên ([ms365-tools.ts](../../../service/src/ms365/ms365-tools.ts))

- `power_automate_trigger_flow` nhận **`name` HOẶC `url`** (`readTriggerFlowArgs` cập nhật):
  - có `name` → `store.resolve(name)`; **không có / disabled** → trả lỗi typed
    (`invalid`/`endpoint_blocked`) **trước** Permission gate; lấy `url` + `timeoutMs` từ flow.
  - chỉ có `url` (legacy) → dùng trực tiếp với `DEFAULT_FLOW_TIMEOUT_MS`.
  - Permission card mô tả theo **tên flow** khi có (không lộ URL secret trong card).
- `power_automate_list_flows` chỉ trả **flow đang enabled** (tên) — agent không trigger nhầm
  flow tắt. (UI dùng route `GET /flows` riêng để thấy cả flow tắt + timeout.)
- `ToolResult.data` mang `{ status, body }` để agent đọc feedback của flow.
- Plugin tool schema ([ms365-plugin-file.ts:144](../../../service/src/runtime/ms365-plugin-file.ts))
  thêm `name` optional; mô tả nêu "ưu tiên gọi theo name từ danh sách đã cấu hình".

## 8. Bảo mật

- **URL flow = bearer secret (SAS)** → chỉ tồn tại ở server + file `.runtime` (owner-only
  `0600`/`0700`, đúng persistence hiện có). **Không** trả về renderer, **không** vào Permission
  card, **không** vào log. Đây là lý do UI chỉ hiện tên + trạng thái + timeout.
- SSRF-pin giữ nguyên; timeout chống flow treo giữ tài nguyên.
- Không lưu vào vault (đồng nhất với quyết định store hiện tại: cùng lớp tin cậy như webhook
  URL, lưu JSON thường) — quyết định này **giữ nguyên**, ghi lại để minh bạch.

## 9. UI ([ms-connect-view.ts](../../../app/ui/src/ui-shell/microsoft/ms-connect-view.ts))

Trong `renderConnectedSummary`, thêm `renderPowerAutomateSection(deps)` (mirror
`renderSiteScopeSection`), đặt sau section site-scope:

- Tiêu đề: **"Power Automate (tùy chỉnh)"**.
- **Danh sách** (load `listMs365Flows()`): mỗi dòng =
  tên flow · toggle enable/disable · ô timeout (giây, đổi khi blur/enter) · nút **Xóa**.
  Trạng thái rỗng: "Chưa có flow nào — thêm bên dưới."
- **Form add**: ô *Tên*, ô *URL* (`type=text`, `autocomplete=off`), ô *Timeout (giây, mặc
  định 120)*, nút **"Thêm flow"**. Lỗi (trùng tên / URL rỗng) hiện inline; thành công →
  clear form + re-render list.
- Mỗi thao tác re-render tại chỗ từ list trả về (pattern giống site row).
- Không token/secret/url nào vào DOM (chỉ name/enabled/timeoutMs).

## 10. Service-client ([service-client.ts](../../../app/ui/src/service-client.ts))

Thêm type `Ms365FlowView { name; enabled; timeoutMs }` và 5 method (mirror
`listMs365Sites`/`setMs365SiteEnabled`), gọi thẳng endpoint loopback qua `call<T>`:

```ts
listMs365Flows(): Promise<readonly Ms365FlowView[]>;
addMs365Flow(name, url, timeoutMs?): Promise<readonly Ms365FlowView[]>;
deleteMs365Flow(name): Promise<readonly Ms365FlowView[]>;
setMs365FlowEnabled(name, enabled): Promise<readonly Ms365FlowView[]>;
setMs365FlowTimeout(name, timeoutMs): Promise<readonly Ms365FlowView[]>;
```

Cập nhật interface `Ms365ConnectClient` trong ms-connect-view để nhận 5 method này.

## 11. Testing (TDD — test trước, code sau)

- **Store**: backward-compat nạp file thiếu `enabled`/`timeoutMs`; add trùng tên bị từ chối;
  remove/setEnabled/setTimeout persist đúng; clamp `timeoutMs` ngoài biên.
- **Service**: `triggerFlow` trả `{status, body}`; body >64 KiB bị cắt; timeout → `Ms365Error`;
  SSRF chặn URL ngoài allowlist trước fetch; `!ok` ném kèm body.
- **Tool**: trigger-by-name resolve đúng; name disabled/không tồn tại → lỗi trước gate;
  legacy url vẫn chạy; `list_flows` chỉ trả enabled; feedback nằm trong `data`.
- **Router**: 4 route mới trả `{flows}` không kèm url; body sai → 400.
- **Service-client**: 5 method gọi đúng path/body, bóc `.flows`.
- **UI**: render list (name/toggle/timeout/delete); add gọi `addMs365Flow`; toggle gọi
  `setMs365FlowEnabled`; xóa gọi `deleteMs365Flow`; sửa timeout gọi `setMs365FlowTimeout`;
  lỗi trùng tên hiện inline.
- Chạy `npm run typecheck` + `npm test`; `scripts\verify-fast.bat` trước commit.

## 12. Quyết định đã chốt (từ brainstorming)

1. Section chỉ hiện khi **đã kết nối** (trong `renderConnectedSummary`).
2. UI **chỉ quản lý danh sách** (add/xóa) + **enable/disable** + **timeout**; không có nút
   trigger tại UI — trigger vẫn qua agent + Permission gate.
3. **"Chờ Flow feedback" = trả response body đồng bộ của flow**, bounded 64 KiB, trong
   **timeout theo từng flow** (chỉnh được; mặc định 120s).
4. **URL ẩn** sau khi add (secret) — UI chỉ hiện tên/trạng thái/timeout.

## 13. Câu hỏi mở

- (đã giải quyết) Timeout global hay per-flow → **per-flow** (chỉnh inline mỗi dòng).
- Không còn câu hỏi mở chặn triển khai.
