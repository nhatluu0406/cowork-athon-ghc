---
language: "vi"
status: "approved"
created_at: "2026-07-14"
topic: "ms365-orchestration"
track: "D2"
phase: "P5"
---

# Design: MS365 Orchestration — clarify, steps visibility, batch confirm — P5

## Mục tiêu

Cho AI **nối nhiều tool MS365** hoàn thành tác vụ đa bước (vd: đọc List UserList → resolve user
→ tạo task Planner cho từng người), với 3 bảo đảm hướng user:

1. **Yêu cầu mơ hồ → hỏi lại user trong chat** trước khi search/action (không đoán mò).
2. **User thấy trước các step** sẽ thực hiện, và trạng thái từng step trung thực khi chạy.
3. **Batch write = MỘT lần confirm** với danh sách đầy đủ, thay vì N modal rời.

## Kiến trúc đã chốt (từ khảo sát 2026-07-14 + quyết định PO)

**Hybrid: prompt-level orchestration + batch ở tầng tool MS365.** KHÔNG xây step-executor
service-side (mâu thuẫn "child owns the loop"); KHÔNG mổ PermissionGate core (giữ 1 request →
1 quyết định). Căn cứ khảo sát: vòng lặp tool-calling thuộc OpenCode child; tiền lệ tiêm prompt
là `COWORK_RUNTIME_ACTION_POLICY` (`app/ui/src/dispatch-plan.ts`); pipeline plan/todo hiển thị
sẵn có (`service/src/execution/todo-mapper.ts`); D1 fan-out không có gì tái dùng.

## 3 mảnh triển khai

### Mảnh 1 — MS365 orchestration prompt block (UI-side, khuôn ACTION_POLICY)

Khối `MS365_ORCHESTRATION_POLICY` mới trong `dispatch-plan.ts`, prepend cùng chỗ với
ACTION_POLICY (budget-accounted), **chỉ khi MS365 đang connected** (đọc từ view state —
không phí budget khi không dùng MS365). Nội dung quy tắc (tiếng Việt cho model):

1. **Tìm-trước, hỏi-nếu-mơ-hồ**: trước khi thao tác trên plan/list/chat/site có tên do user nêu,
   PHẢI gọi tool list/discovery tương ứng để xác nhận tồn tại. Nhiều kết quả khớp hoặc không
   rõ user muốn search hay action → **DỪNG và hỏi lại user trong hội thoại**, không tự đoán.
2. **Công bố kế hoạch bước TRƯỚC khi thực hiện chuỗi ≥2 tool call**: liệt kê các bước sẽ làm
   (dùng todo list của runtime để UI hiển thị plan/todo; tối thiểu là danh sách bước bằng text
   trong chat), cập nhật trạng thái từng bước khi chạy, KHÔNG báo bước nào "xong" khi tool chưa
   thành công (nhất quán ACTION_POLICY).
3. **Đọc-trước-khi-sửa**: edit/delete Planner task phải đọc task trước để lấy `etag` mới nhất.
4. **Batch thay vì N call lẻ**: tác vụ lặp cùng loại trên nhiều đối tượng (vd tạo task cho mỗi
   user trong list) → dùng batch tool (`planner_create_tasks`), KHÔNG gọi create lẻ N lần.
5. **Không bao giờ báo hành động MS365 thành công khi tool trả lỗi/denied** — relay lỗi +
   recovery cho user.

### Mảnh 2 — Batch write tool: `planner_create_tasks`

| Tool | Kind | Graph | Permission |
|---|---|---|---|
| `planner_create_tasks` | **write (batch)** | N × `POST /planner/tasks` | **MỘT PermissionGate request** |

- Input: `{ planId: string; tasks: Array<{ title: string; dueDateTime?: string; assigneeUserIds?: string[] }> }`.
  **Cap 20 items/batch** (quá → `invalid_input` bảo chia nhỏ). Mảng rỗng → invalid.
- **MỘT** `PermissionRequest` mô tả minh bạch toàn bộ:
  `Tạo ${n} task trong Planner: "${title1}", "${title2}", … (kèm người được gán nếu có)`
  (bounded — cắt danh sách title ở ~500 ký tự, luôn ghi tổng số). Allow một lần → service loop
  N Graph call **tuần tự** dưới quyết định đó; Deny → không call nào chạy.
- **Kết quả per-item honest**: `{ created: PlannerTask[]; failed: Array<{ index: number; title: string; error: { kind; message } }> }`
  — item lỗi không phá batch (tiếp tục item sau), model relay chính xác cái nào được/không.
- PermissionGate **không đổi**: đây là 1 tool call = N mutation khai báo trước trong description.
- YAGNI: chưa làm `lists_add_items`/batch khác — thêm khi có kịch bản thật.

#### Chế độ xác nhận write: `manual` / `auto` (quyết định PO 2026-07-14)

- **Preference của user**, control đặt **ngay tại chat box AI** (pill toggle trong khu composer,
  quyết định PO 2026-07-14 — không đặt trong Settings để tránh 2 control 1 state): chỉ hiện khi
  MS365 connected, click đổi `Thủ công ⇄ Tự động`, hiệu lực ngay lượt tool call kế tiếp. Lưu app
  config file (`.runtime/ms365-write-mode.json` — khuôn site-scope persistence, KHÔNG keyring).
  **Mặc định `manual`** (an toàn; user chủ động bật auto). State là one source of truth
  service-side; pill chỉ là UI gọi route.
- **Phạm vi: CHỈ batch tool.** Write đơn lẻ (upload, create/edit/delete lẻ, post message) luôn
  có permission card riêng như hiện tại — mode không đụng tới.
- **Enforce ở service** (trong `handleToolCall`/batch handler, không phải prompt):
  - `auto` → `planner_create_tasks` chạy như trên (1 request phủ N item).
  - `manual` → batch tool trả structured error `{ kind: "manual_mode", message: "Đang ở chế độ
    duyệt thủ công — tạo từng task riêng lẻ.", recovery: "Dùng planner_create_task cho từng
    task, hoặc bật chế độ tự động trong cài đặt Microsoft 365." }` → model quay về gọi create
    lẻ từng cái → mỗi write một card. Không có đường nào để batch lách qua khi manual.
- Route: `GET /v1/ms365/write-mode` + `POST /v1/ms365/write-mode` (token-guarded,
  body `{ mode: "manual" | "auto" }`), pill toggle trong composer chat gọi route này.
- Prompt block (quy tắc #4) cập nhật: "dùng batch tool cho tác vụ lặp; nếu tool báo
  `manual_mode` thì tạo lẻ từng item và nói rõ với user vì sao có nhiều lần xác nhận."

### Mảnh 3 — Verify tool-consumption (tiền đề P0, acceptance của P5)

Orchestration vô nghĩa nếu OpenCode child chưa thực sự gọi được tool MS365 (open item từ slice 1).
P5 chỉ được coi là **hoàn tất khi có một lượt chạy thật**: app packaged + manual token +
flag ON → prompt yêu cầu model gọi ≥1 tool MS365 read → quan sát tool call đến
`MS365_TOOL_CALL_PATH` + kết quả về model. Cần user thao tác (token thật); ghi kết quả vào
api-map + current-status (kể cả khi FAIL — đó là thông tin quyết định).

## Hành vi kỳ vọng end-to-end (kịch bản demo #2)

```text
User: "Dựa trên List UserList, tạo cho mọi người task [Learning CSR] deadline 2026-07-13"
1. Model công bố kế hoạch bước (todo): tìm UserList → đọc items → xác nhận plan đích
   → resolve user → tạo N task.
2. lists_get_lists → nếu ≥2 list khớp "UserList" → HỎI LẠI user (chat).
3. lists_get_items → có danh sách người.
4. Chưa rõ tạo vào Planner nào → HỎI LẠI user (chat) → user chỉ định plan.
5. teams_list_members / dữ liệu list → map ra assigneeUserIds (nếu không resolve được →
   nói rõ, tạo task không assignment hoặc hỏi user).
6. planner_create_tasks (batch) → MỘT permission card liệt kê N task → user Allow
   → tạo tuần tự → báo per-item kết quả.
```

## Testing

- **Unit batch tool**: cap 20 (21 → invalid); mảng rỗng → invalid; MỘT gate.submit cho cả batch
  (spy đếm submit=1); Deny → 0 Graph call; Allow → N call tuần tự; item giữa lỗi → item sau vẫn
  chạy, failed[] đúng index/error; description chứa tổng số + titles bounded.
- **Prompt block**: unit test `dispatch-plan` — block xuất hiện khi MS365 connected, vắng khi
  không; nằm trong budget; nội dung chứa các quy tắc chính (assert substring).
- **Live consumption run** (mảnh 3): thủ công + ghi evidence; không claim pass khi chưa chạy.

## Acceptance criteria

1. Prompt block tiêm đúng điều kiện (connected), đủ 5 quy tắc, trong budget.
2. `planner_create_tasks`: một Allow phủ N create khai báo trước; Deny chặn cả batch; per-item
   honest; cap 20. **Mode enforce ở service**: `manual` (mặc định) → batch trả `manual_mode`
   error, model tạo lẻ từng cái (mỗi write một card); `auto` → batch chạy. **Pill toggle trong
   composer chat** (hiện khi connected, đổi mode hiệu lực ngay) + route write-mode hoạt động.
3. Kịch bản demo #2 chạy được ở mức tool-contract (unit/integration), các điểm hỏi-lại đúng chỗ.
4. Steps visibility: quy tắc công bố kế hoạch có trong prompt block; pipeline todo hiện có không
   cần sửa (nếu quan sát thấy model không dùng todo tool → fallback text vẫn thỏa yêu cầu).
5. Tool-consumption live run có kết quả ghi nhận (PASS hoặc FAIL trung thực).
6. Không secret; flag OFF; PermissionGate core không đổi; typecheck + targeted tests PASS;
   api-map cập nhật.

## Ngoài phạm vi

- Batch tool cho Lists/Teams/SharePoint (chờ kịch bản thật).
- Cơ chế batch trong PermissionGate core; step-executor service-side; D1 fan-out.
- UI mới cho steps (dùng pipeline plan/todo + chat hiện có).
- Rollback/undo batch (per-item report là mức honest hiện tại).
