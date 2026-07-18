---
language: "vi"
status: "approved"
created_at: "2026-07-14"
topic: "ms365-planner-crud"
track: "D2"
phase: "P2"
---

# Design: MS365 Planner CRUD — P2

## Mục tiêu

AI thay user thao tác Planner: **Create/Edit/Delete task** (write, có permission) và **Read + tóm
tắt status tasks** (vd "task nào trễ?"). Là slice P2 trong
[MS365 Task Suite Roadmap](./2026-07-14-ms365-task-suite-roadmap-design.md), tái dùng
`Ms365Connector`; đối ứng trực tiếp ví dụ User Prompt #1 ("kiểm tra tasks trong Planner ABC có
task nào trễ không").

## Quyết định thiết kế

- **Tìm plan qua `/me/planner/plans`** (plans chia sẻ với user) — KHÔNG enumerate groups. Nhờ đó
  **không cần scope `Group.Read.All`** như roadmap dự kiến; chỉ cần `Tasks.ReadWrite`
  (least-privilege thu hẹp so với roadmap — cải tiến, ghi lại tại đây).
- **Disambiguation trong hội thoại**: `planner_list_plans` trả candidates (id + title); model tự
  đối chiếu "Planner ABC", nếu nhiều kết quả thì hỏi lại user trong chat — không dialog riêng.
- **Tóm tắt "task trễ"**: `planner_list_tasks` trả đủ trường (`dueDateTime`, `percentComplete`,
  `title`) để model tự tính trễ (due < hôm nay && chưa 100%). Không hard-code logic "trễ" vào
  service — model diễn giải theo yêu cầu user (đúng tinh thần "tóm tắt theo yêu cầu").
- **ETag bắt buộc**: Graph Planner yêu cầu `If-Match` cho PATCH/DELETE. Tool edit/delete nhận
  `etag` từ kết quả read trước đó (mỗi task trả kèm `etag` = `@odata.etag`). Model phải đọc task
  trước khi sửa/xóa — đây cũng là hành vi an toàn mong muốn.
- **Mọi write qua PermissionGate** (create/edit/delete) — đúng khuôn `sharepoint_upload_file`:
  submit request → chỉ mutate khi có Allow được ghi nhận; Deny chặn thật.

## Ràng buộc kỹ thuật phát hiện khi thiết kế

`HttpGraphClient` hiện chỉ hỗ trợ `GET | POST | PUT`, không có custom header và `json()` sẽ fail
trên response rỗng (204). Planner cần:

1. **`PATCH` + `DELETE`** trong method union.
2. **`ifMatch?: string`** trên request → header `If-Match` (giá trị là ETag Graph trả, không phải
   secret).
3. **`noContent(req)`**: gửi request, chấp nhận 2xx không body (204) — cho DELETE (và PATCH mặc
   định trả 204).

Mở rộng này **additive** (không đổi hành vi các call hiện có), nằm trong cùng SSRF/token
discipline sẵn có.

## Kiến trúc & tool model

```text
ms365-tool-router
   └─ PlannerService (mới) ── Graph /me/planner/plans, /planner/plans/{id}/tasks, /planner/tasks
          └── Ms365Connector.graph()  (đã có; graph-client mở rộng PATCH/DELETE/If-Match)
```

| Tool | Kind | Graph | Permission |
|---|---|---|---|
| `planner_list_plans` | read | `GET /me/planner/plans` | không |
| `planner_list_tasks` | read | `GET /planner/plans/{id}/tasks` | không |
| `planner_create_task` | **write** | `POST /planner/tasks` | **PermissionGate** |
| `planner_edit_task` | **write** | `PATCH /planner/tasks/{id}` + `If-Match` | **PermissionGate** |
| `planner_delete_task` | **write** | `DELETE /planner/tasks/{id}` + `If-Match` | **PermissionGate** |

Ghi chú: `planner_summarize_status` trong roadmap được thực hiện bằng **model tóm tắt trên kết quả
`planner_list_tasks`** (đủ trường), không cần tool riêng — YAGNI, một nguồn dữ liệu.

### `PlannerService` (port shape)

```ts
interface PlannerPlan { id: string; title: string }
interface PlannerTask {
  id: string; title: string; planId: string;
  percentComplete: number;          // 0..100
  dueDateTime: string;              // ISO hoặc "" nếu không có
  etag: string;                     // @odata.etag — cần cho edit/delete
}
interface PlannerService {
  listPlans(): Promise<PlannerPlan[]>;
  listTasks(planId: string): Promise<PlannerTask[]>;
  createTask(input: { planId: string; title: string; dueDateTime?: string; assigneeUserIds?: string[] }): Promise<PlannerTask>;
  editTask(input: { taskId: string; etag: string; title?: string; dueDateTime?: string; percentComplete?: number }): Promise<void>;
  deleteTask(input: { taskId: string; etag: string }): Promise<void>;
}
```

## Bounded / safe defaults

- Plans/tasks cap (mặc định 50 — plan/task nhiều hơn search hits).
- id/etag đi vào path/header được service kiểm soát; title/dueDateTime chỉ vào JSON body —
  model không chèn được path Graph tùy ý.
- Lỗi 409/412 (ETag stale) map qua `graph_error` với recovery "Đọc lại task rồi thử lại" —
  không retry mù.

## Permission flow (đúng khuôn upload)

Mỗi write submit `PermissionRequest` (`kind: "ms365_write"`, mô tả rõ hành động:
"Tạo task X trong plan Y" / "Sửa task X" / "Xóa task X") → `gate.proceed` chỉ chạy Graph mutation
khi có Allow; Deny/không quyết định → `{ ok:false, kind:"denied" }`. Không cơ chế confirm thứ hai.

## Testing

- **Unit graph-client**: PATCH/DELETE gửi đúng method; `ifMatch` thành header `If-Match`;
  `noContent` chấp nhận 204; hành vi GET/POST/PUT hiện có không đổi.
- **Unit PlannerService** (fake Graph): map plans/tasks (defensive: drop entry thiếu id/title;
  thiếu due → ""), cap, etag lấy từ `@odata.etag`; create gửi đúng body; edit/delete gửi đúng
  `If-Match`.
- **Tool dispatch**: 2 read chạy thẳng; 3 write qua gate — Allow mới chạy, Deny chặn (test cả
  hai); `not_connected` fail closed; args validate → `invalid_input`.
- **Redaction**: không token trong output.
- **Focused run**: `npm run typecheck`; targeted `ms365-graph-client`, `ms365-planner*`,
  `ms365-flag-off`.

## Acceptance criteria

1. `planner_list_plans` + `planner_list_tasks` trả đủ dữ liệu để model tìm "Planner ABC" và tóm
   tắt task trễ; nếu mơ hồ model hỏi lại trong hội thoại.
2. Create/Edit/Delete **chỉ chạy sau Allow** được ghi nhận; Deny chặn thật ở execution boundary.
3. Edit/Delete gửi đúng `If-Match` ETag; ETag stale → typed error kèm recovery, không retry mù.
4. GraphClient mở rộng PATCH/DELETE/If-Match/noContent mà không đổi hành vi call hiện có.
5. Scope chỉ thêm `Tasks.ReadWrite` (không cần `Group.Read.All` — hẹp hơn roadmap).
6. Không secret trong log/state/envelope; flag OFF mặc định; typecheck + targeted tests PASS.

## Ngoài phạm vi

- **Resolve tên → user id** cho assignment — thuộc P3/P5 (Lists→Planner). `createTask` P2 đã
  nhận `assigneeUserIds` (id thô, optional) để P5 dùng ngay; nhưng P2 không có tool tra cứu user.
- Bucket/checklist/label của Planner; comment task.
- UI surface riêng cho Planner (P2 là tool cho AI).
