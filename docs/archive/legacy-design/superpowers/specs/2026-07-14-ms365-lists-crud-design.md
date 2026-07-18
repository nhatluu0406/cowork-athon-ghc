---
language: "vi"
status: "approved"
created_at: "2026-07-14"
topic: "ms365-lists-crud"
track: "D2"
phase: "P3"
---

# Design: MS365 Lists CRUD + auto-gen query — P3

## Mục tiêu

AI thao tác Microsoft Lists thay user: **Add/Edit/Delete item** (write, có permission), **đọc +
tóm tắt** item theo yêu cầu, và **tự động gen query** (`$filter` OData) từ prompt. Slice P3 trong
[MS365 Task Suite Roadmap](./2026-07-14-ms365-task-suite-roadmap-design.md); đối ứng ví dụ User
Prompt #2 ("dựa trên List UserList, lấy danh sách user").

## Quyết định thiết kế

- **Lists nằm trong SharePoint site** → **site allowlist P0.5 áp dụng cho MỌI method** (đọc lẫn
  ghi): site bị tắt → `Ms365Error("endpoint_blocked")` **trước** khi gọi Graph (fail-closed, đúng
  khuôn `listSiteFiles`). Write còn thêm PermissionGate phía sau.
- **Discovery 2 bước**: `lists_get_lists(siteId)` liệt kê lists trong site (tìm "UserList" theo
  tên — model đối chiếu, mơ hồ thì hỏi lại trong hội thoại); `lists_get_items(siteId, listId,
  filter?)` lấy items.
- **Auto-gen query**: model tự dựng OData `$filter` (vd `fields/Status eq 'Active'`) từ prompt.
  Filter chỉ đi vào **giá trị query param** `$filter` (URL-encoded) — không bao giờ vào path.
  Items expand `fields` để model đọc cột thật.
- **Không cần ETag**: Graph listItem không bắt buộc `If-Match` (khác Planner) → edit/delete chỉ
  cần itemId. GraphClient đã có PATCH/DELETE từ P2, không cần mở rộng gì thêm.
- **`fields` payload là object model cung cấp** (`Record<string, unknown>`): giá trị chỉ vào JSON
  body; service validate là plain object (không array/null).
- **Scope**: nâng `Sites.Read.All` → **`Sites.ReadWrite.All`** trong `MS365_SCOPES` (write cần;
  ReadWrite bao Read nên thay thế chứ không thêm trùng).

## Kiến trúc & tool model

```text
ms365-tool-router
   └─ ListsService (mới) ── Graph /sites/{id}/lists, /lists/{id}/items
          ├── siteFilter (P0.5 allowlist — fail-closed MỌI method)
          └── Ms365Connector.graph()
```

| Tool | Kind | Graph | Permission |
|---|---|---|---|
| `lists_get_lists` | read | `GET /sites/{siteId}/lists` | site allowlist |
| `lists_get_items` | read | `GET /sites/{siteId}/lists/{listId}/items?expand=fields&$filter=...` | site allowlist |
| `lists_add_item` | **write** | `POST .../items` body `{fields}` | allowlist + **PermissionGate** |
| `lists_edit_item` | **write** | `PATCH .../items/{id}/fields` body fields | allowlist + **PermissionGate** |
| `lists_delete_item` | **write** | `DELETE .../items/{id}` | allowlist + **PermissionGate** |

### `ListsService` (port shape)

```ts
interface ListInfo { id: string; displayName: string }
interface ListItem { id: string; fields: Record<string, unknown> }
interface ListsService {
  getLists(siteId: string): Promise<ListInfo[]>;
  getItems(siteId: string, listId: string, filter?: string): Promise<ListItem[]>;
  addItem(input: { siteId: string; listId: string; fields: Record<string, unknown> }): Promise<ListItem>;
  editItem(input: { siteId: string; listId: string; itemId: string; fields: Record<string, unknown> }): Promise<void>;
  deleteItem(input: { siteId: string; listId: string; itemId: string }): Promise<void>;
}
createListsService(deps: { connector; siteFilter?: { isEnabled(siteId: string): boolean }; maxResults? }) // default 50
```

`siteFilter` optional (khuôn SharePoint): không có → không chặn (backward-compat test); có →
fail-closed cho mọi method.

## Bounded / safe defaults

- Lists/items cap mặc định 50. `fields` của item trả về giữ nguyên object Graph (bounded bởi
  item cap; không tải attachment/binary).
- id (site/list/item) `encodeURIComponent` trong path; `$filter` chỉ là query param value.
- Lỗi Graph 400 do `$filter` sai cú pháp → `graph_error` với recovery chung của `mapGraphStatus`
  ("Thử lại; nếu tiếp diễn hãy kết nối lại.") — model nhận typed error và tự sửa query. *(Đã
  chỉnh sau final review 2026-07-14: không có mapping 400 riêng cho Lists — graph-client không đổi.)*

## Permission flow

3 write đúng khuôn `handlePlannerWrite`/`handleUpload`: mô tả rõ (`Thêm item vào list ${listId}`,
`Sửa item ${itemId}`, `Xóa item ${itemId}`), `kind: "ms365_write"`, Allow mới chạy, Deny chặn.
Thứ tự guard: **not_connected → site allowlist (trong service) → PermissionGate → Graph**.

Kèm follow-up P2 đã hẹn: thêm `never`-exhaustiveness default cho write handler dispatch.

## Testing

- **Unit ListsService** (fake Graph): map lists/items defensive (drop thiếu id; fields thiếu →
  `{}`), cap, `$filter`/`expand` vào query param đúng; allowlist chặn MỌI method khi site tắt
  (endpoint_blocked, Graph không được gọi); không filter → pass-through.
- **Tool dispatch**: 2 read thẳng; 3 write — Allow chạy/Deny chặn (spy = 0); args validate
  (`fields` phải là plain object); `not_connected`.
- **Focused run**: typecheck; `ms365-lists-service`, `ms365-lists-tool`, `ms365-flag-off`.

## Acceptance criteria

1. `lists_get_lists` + `lists_get_items` đủ cho kịch bản "tìm UserList → query user" — model tự
   dựng `$filter`, filter sai cú pháp nhận recovery để tự sửa.
2. Site allowlist chặn thật MỌI method (kể cả write) khi site tắt — trước mọi Graph call.
3. Add/Edit/Delete chỉ chạy sau Allow; Deny chặn thật (spy-verified).
4. Không mở rộng GraphClient (P2 đã đủ); scope thay `Sites.Read.All` → `Sites.ReadWrite.All`.
5. Không secret; flag OFF mặc định; typecheck + targeted tests PASS; cập nhật api-map sau slice.

## Ngoài phạm vi

- Tạo/xóa cả list (chỉ item); column schema management; attachment của item.
- Resolve người từ item thành user id Planner — P5 orchestration.
