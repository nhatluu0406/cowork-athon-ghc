---
language: "vi"
status: "approved"
created_at: "2026-07-17"
topic: "MS365 Power Automate — flow description (Agent discovery) + edit + dialog-based management UI"
builds_on: "2026-07-17-ms365-power-automate-flow-management-design.md"
---

# Thiết kế: Flow description + edit + dialog quản lý (MS365 Power Automate)

## 1. Bối cảnh & động lực

Slice trước cho add/xóa/enable-disable/timeout flow, nhưng `power_automate_list_flows`
chỉ trả **`{ name }`**. Một cái tên trơ không cho Agent biết flow **làm gì / khi nào dùng /
payload ra sao** → model không thể quyết định gọi flow. Slice này thêm **`description`** (mô
tả do người dùng viết, trả cho Agent), **khả năng edit**, và **UI dạng dialog** cho add/edit.

## 2. Mục tiêu / Ngoài phạm vi

**Mục tiêu:**
1. Mỗi flow có `description` (free-text); `power_automate_list_flows` trả `{ name, description }`
   để Agent biết khi nào dùng.
2. **Edit** flow qua popup dialog: sửa description / timeout / (tùy chọn) URL.
3. UI quản lý: **list read-only** + toggle enable/disable inline + nút **Sửa** / **Xóa** mỗi
   dòng + nút **＋ Thêm flow**. Add/Edit mở **dialog** (mirror `permission-modal`).

**Ngoài phạm vi (YAGNI):**
- Không payload JSON schema (description free-text là đủ cho Agent).
- Không đổi tên khi edit (tên là khóa; đổi tên = xóa + tạo lại).
- Không xác nhận khi xóa (xóa ngay theo yêu cầu).
- Không auto-discovery flow (vẫn cần login — ngoài phạm vi như slice trước).

## 3. Quyết định đã chốt (brainstorm)
1. **Description** = free-text, không schema.
2. **Edit**: tên **read-only** (cố định); rename = xóa + tạo lại.
3. **URL khi edit**: ô để trống ⇒ **giữ URL cũ**; nhập ⇒ thay URL mới. URL không bao giờ
   pre-fill (là bearer secret, không gửi renderer).
4. **Xóa**: xóa ngay, không hỏi.
5. Add & Edit dùng **cùng một dialog** (mode `add` | `edit`), mirror `permission-modal.ts`.

## 4. Data model (store)

`PowerAutomateFlow` thêm `description: string` (backward-compat mặc định `""`; normalize khi
load như `enabled`/`timeoutMs`). Thêm thao tác:

```ts
update(name: string, fields: { description: string; timeoutMs: number; url?: string }): Promise<void>;
// url không truyền / rỗng ⇒ giữ url cũ. Ném Error nếu name không tồn tại.
```

`add` mở rộng: `add({ name, url, description, timeoutMs })` (description mặc định `""` nếu
router không truyền).

## 5. Service + Tool

- `PowerAutomateService.listFlows()` trả **`{ name, description }[]`** (enabled-only).
- `resolveFlow` không đổi (không cần description để trigger).
- `power_automate_list_flows` (plugin + tool) trả `{ name, description }`; mô tả tool cập nhật:
  *"Liệt kê flow đã cấu hình (tên + mô tả). Đọc `description` để quyết định khi nào gọi và
  payload cần gửi, rồi gọi `power_automate_trigger_flow` theo `name`."*

## 6. Router

- `POST /v1/ms365/flows` (add): body thêm `description?` (mặc định `""`).
- **Mới** `POST /v1/ms365/flows/update`: body `{ name, description, timeoutMs, url? }`; flow
  không tồn tại → 400 (`Ms365RouterRequestError`); `url` rỗng/thiếu ⇒ giữ URL cũ.
- `PublicFlow` (mọi route trả) thêm `description`: `{ name, enabled, timeoutMs, description }`.
  **Vẫn KHÔNG có `url`** (bearer secret) — bất biến giữ nguyên.

## 7. Service-client

- `Ms365FlowView` thêm `description: string`.
- `addMs365Flow(name, url, description, timeoutMs?)` (thêm tham số `description`).
- **Mới** `updateMs365Flow(name, fields: { description: string; timeoutMs: number; url?: string })`.

## 8. UI

### 8a. Dialog dùng chung — `app/ui/src/ui-shell/microsoft/ms-flow-dialog.ts`
Mirror `permission-modal.ts` (backdrop + `role="dialog"` + focus-trap + Escape/backdrop đóng +
khôi phục focus). API:

```ts
openFlowDialog(container, {
  mode: "add" | "edit",
  initial?: { name: string; description: string; timeoutSec: number }, // edit: prefill (không có url)
  onSubmit: (values: { name: string; url: string; description: string; timeoutSec: number }) => Promise<void>,
}): void
```
- Fields: Tên (edit → read-only), URL (edit → placeholder "Để trống nếu giữ URL cũ"),
  Mô tả (textarea), Timeout (giây).
- Submit gọi `onSubmit`; lỗi hiển thị inline trong dialog, không đóng; thành công → đóng.

### 8b. Section — `renderPowerAutomateSection` (viết lại)
- **List read-only**: mỗi dòng = tên · mô tả (rút gọn) · timeout · **toggle enable/disable** ·
  nút **Sửa** · nút **Xóa**.
- Nút **＋ Thêm flow** → `openFlowDialog({ mode: "add", onSubmit → addMs365Flow })`.
- **Sửa** → `openFlowDialog({ mode: "edit", initial: {name, description, timeoutSec}, onSubmit → updateMs365Flow })`.
- **Xóa** → `deleteMs365Flow(name)` ngay (không hỏi).
- Toggle → `setMs365FlowEnabled`. Mọi thao tác re-render list từ kết quả trả về.
- **URL không bao giờ vào DOM** (list & row chỉ có name/description/enabled/timeoutMs; edit
  không pre-fill url) — bất biến giữ nguyên.

## 9. Bảo mật (bất biến giữ nguyên)
- URL flow = bearer secret: không route/response/type/DOM nào chứa `url`. Edit không pre-fill
  URL. Description **không** phải secret nên hiện được.

## 10. Testing (TDD mọi tầng) + `npm run typecheck` + `npm run build:app`.
- Store: description backward-compat; `update` giữ url khi rỗng, thay khi có, ném khi name sai.
- Service/Tool: `list_flows` trả `{name, description}` enabled-only.
- Router: add với description; update route (giữ url / thay url / name sai → 400); public list
  gồm description, không url.
- Service-client: addMs365Flow (4 tham số), updateMs365Flow đúng path/body.
- Dialog: add submit gọi onSubmit với values (giây), edit tên read-only + url blank, focus-trap,
  Escape đóng.
- Section: list render name+description; Sửa mở dialog prefill; Xóa gọi delete; toggle gọi enable;
  không có url trong DOM.

## 12. Bổ sung: `payloadSchema` (custom JSON) — cho Agent build payload

Mỗi flow lưu thêm **`payloadSchema: string`** — một **JSON Schema** (text thô do user dán) mô tả
payload flow cần, ví dụ:

```json
{ "type": "object", "properties": { "message": { "type": "string" }, "sender": { "type": "string" } } }
```

Vai trò: `power_automate_list_flows` trả `{ name, description, payloadSchema }` → Agent đọc schema,
dựa vào user prompt để **fill giá trị đúng trường** rồi gọi `power_automate_trigger_flow` với
`payload` đó. (Không validate payload-vs-schema ở server lúc trigger — schema chỉ là chỉ dẫn cho
Agent; validation là deferred/YAGNI.)

Thay đổi theo tầng (đều additive, mặc định `""`, backward-compat như `description`):
- **Store**: `PowerAutomateFlow.payloadSchema: string`; `add`/`update` mang thêm field này.
- **Service/Tool**: `listFlows()` trả `{ name, description, payloadSchema }`; mô tả tool cập nhật
  "đọc `payloadSchema` để build payload đúng trường".
- **Router**: add/update nhận `payloadSchema`; **validate là JSON hợp lệ** (rỗng cũng OK) → sai →
  400. `PublicFlow` gồm `payloadSchema` (không phải secret). Vẫn **không** có `url`.
- **Service-client**: `Ms365FlowView.payloadSchema`; `addMs365Flow`/`updateMs365Flow` mang field này.
- **UI dialog**: thêm ô textarea "Payload JSON Schema" (prefill khi edit); submit **validate
  parseable JSON** (rỗng OK), sai → lỗi inline, không đóng.
- **UI row**: có thể hiện badge nhỏ "có schema" (không hiện toàn bộ schema trong dòng).

## 11. Câu hỏi mở
Không còn — mọi quyết định đã chốt ở §3 và §12.
