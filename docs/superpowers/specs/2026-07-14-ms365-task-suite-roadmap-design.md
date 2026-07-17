---
language: "vi"
status: "approved"
created_at: "2026-07-14"
topic: "ms365-task-suite-roadmap"
track: "D2"
---

# Design: MS365 Task Suite — Roadmap tổng (D2)

## Mục tiêu

Thiết kế **roadmap tổng** để AI thay User thực hiện các tác vụ trong môi trường Microsoft 365
dựa trên User Prompt, phủ đủ 5 nhóm tính năng còn thiếu (Outlook, Planner, Lists, Teams,
Power Automate) cộng orchestration đa bước, **tất cả tái dùng chung `Ms365Connector` đã có**.

Đây là roadmap nối tiếp
[MS365 Connector + SharePoint (Slice 1)](./2026-07-13-ms365-connector-sharepoint-design.md).
Slice 1 đã build **cơ chế connector chung** (mục 2 của yêu cầu) và chứng minh bằng SharePoint.
Tài liệu này thiết kế các slice còn lại (mục 1 của yêu cầu) và thứ tự thực thi.

## Trạng thái đối chiếu yêu cầu (tại 2026-07-14)

| Nhóm | Yêu cầu | Trạng thái |
|---|---|---|
| Connector chung (mục 2) | Auth, Graph client, port/adapter, tool router, permission | ✅ **Đã có** (Slice 1) |
| SharePoint | Search tên+nội dung, upload, query | 🟡 Có nền tảng, **chưa live-verify** |
| Outlook | Search + tóm tắt/giải thích mail | 🔴 Chưa có |
| Planner | Create/Edit/Delete/Read task, tóm tắt status | 🔴 Chưa có |
| Lists | Add/Edit/Delete item, tóm tắt, auto-gen query | 🔴 Chưa có |
| Teams | Search tin nhắn, post message (có @mentions) | 🔴 Chưa có |
| Power Automate | List + trigger flow user-defined | 🔴 Chưa có |
| Site discovery + search scope | List sites user join, toggle search per-site | 🔴 Chưa có |
| Orchestration đa bước | Nối nhiều tool, clarifying, batch-confirm | 🔴 Chưa có |

## Kiến trúc tổng — mọi nhóm tái dùng một connector

Nguyên tắc cốt lõi: **không nhóm nào tự chạm Graph / token / keyring.** Tất cả đi qua
`Ms365Connector` (đã có). Mỗi nhóm chỉ là một **service module** + một **tool set**, cùng cắm
vào `ms365-tool-router` hiện có.

```text
OpenCode child (model gọi tool)
      │ loopback HTTP (token-guarded)
      ▼
ms365-tool-router  ──►  PermissionGate  (mọi WRITE đi qua đây)
      │
      ├─ SharePointService      (✅ đã có)      ── Graph /search, /drive (lọc allowlist)
      ├─ SiteScopeService       (🔴 P0.5)       ── Graph /me/followedSites + allowlist config
      ├─ OutlookService         (🔴 P1, read)   ── Graph /me/messages
      ├─ PlannerService         (🔴 P2)         ── Graph /planner
      ├─ ListsService           (🔴 P3)         ── Graph /sites/{id}/lists
      ├─ TeamsService           (🔴 P4)         ── Graph /chats, /teams/{id}/channels
      └─ PowerAutomateService   (🔴 P6)         ── Flow API (ngoài Graph chuẩn)
                 └── tất cả gọi  Ms365Connector.graph()  (✅ đã có)
```

Mỗi nhóm mới = 3 mảnh, **không đụng core**:

1. **`{group}-service.ts`** — gọi `connector.graph()`, cap kết quả, bounded, map lỗi qua `Ms365Error`.
2. **Tool definitions** trong `ms365-tools.ts` — read chạy thẳng; write submit `PermissionGate`.
3. **Unit tests** dùng fake Graph — tái dùng đúng khuôn contract của SharePoint (Slice 1).

### Quy tắc read vs write (đồng nhất mọi nhóm)

- **Read** (search mail, list task, get items, search Teams…) → chạy trực tiếp, không permission.
- **Write** (create/edit/delete task, add/edit/delete item, post message, trigger flow, upload) →
  **bắt buộc qua PermissionGate** tại execution boundary. Deny chặn thật. Không có cơ chế
  confirm thứ hai song song (one source of truth).

## Thứ tự thực thi (phase)

```text
P0 (nền tảng live) → P0.5 Site discovery + search scope → P1 Outlook → P2 Planner
   → P3 Lists → P4 Teams → P5 Orchestrator → P6 Power Automate
```

Nguyên tắc sắp xếp: gỡ blocker nền tảng trước; read-only trước write; orchestrator sau khi các
nhóm chính đã tồn tại; nhóm khác biệt nhất (Power Automate, dùng API ngoài Graph) cuối cùng.

### P0 — Gỡ blocker nền tảng (chặn mọi live feature)

Không tool mới. Điều kiện "definition of live" cho toàn bộ P1–P6:

- IT cấp `CGHC_MS365_CLIENT_ID` / `CGHC_MS365_TENANT` — xem [ms365-it-request.md](../../integration/ms365-it-request.md).
- Xác minh OpenCode child **thật sự đọc** `CGHC_MS365_TOOL_ENDPOINT` / `CGHC_MS365_TOKEN` và
  gọi được MS365 tool qua một child đang chạy thật (open verification item hiện tại).
- Một live-tenant run SharePoint để chốt end-to-end.

### P0.5 — Site Discovery + Search Scope (settings sau connect)

Sau khi user connect, liệt kê **toàn bộ site user đang join** và cho phép **toggle bật/tắt
search per-site** trong Settings. Đặt sớm (trước P3 Lists) vì cả SharePoint search và Lists
đều lọc theo allowlist site này.

Gồm 3 mảnh:

1. **List sites** — `connector.graph()` gọi `/me/followedSites` liệt kê site user join, kèm
   trạng thái quyền thật (decode từ token scope).
2. **Toggle allowlist trong Settings** — mỗi site một toggle bật/tắt search, đặt trong surface
   `microsoft` (tab cấu hình sau connect). Lưu trong **app config** (đây là preference, KHÔNG
   phải secret → không vào keyring). **Mặc định: bật hết**; user tự tắt site nhạy cảm.
3. **Enforce ở service (chặn thật, fail-closed)** — `SharePointService.search` và
   `ListsService.getItems` **lọc site theo allowlist tại execution boundary**. Site tắt →
   service KHÔNG trả kết quả cho site đó. Khi có allowlist mà một hit **không resolve được
   site id** thì hit đó **bị DROP** (default-deny), không được lọt qua — quyết định sau security
   review 2026-07-14, chặt hơn bản plan đầu (fail-open). AI không thể bỏ qua (đúng "deny actually
   blocks", `.claude/rules/security.md`).

| Tool | Kind | Graph | Permission |
|---|---|---|---|
| `ms365_list_joined_sites` | read | `/me/followedSites` | không |

**Tác động phase khác:** `sharepoint_search` (Slice 1) và `lists_get_items` (P3) nhận thêm bước
lọc allowlist trước khi query — không đổi tool signature, chỉ thêm guard service-side.
Scope: `Sites.Read.All`.

### P1 — Outlook (chỉ đọc)

| Tool | Kind | Graph | Permission |
|---|---|---|---|
| `outlook_search_messages` | read | `/me/messages?$search` (theo nội dung/subject/from) | không |
| `outlook_get_message` | read | `/me/messages/{id}` | không |
| `outlook_summarize_message` | read | tải body bounded để model tóm tắt/giải thích | không |

- **Chỉ đọc mail** — không gửi, không reply. Không cần PermissionGate → slice nhỏ, ít rủi ro.
- Body download cap (tái dùng limit 64 KiB của File Review). Scope tối thiểu `Mail.Read`.
- Đối ứng yêu cầu: *tìm nội dung mail + tóm tắt/giải thích theo yêu cầu User*.

### P2 — Planner (đủ CRUD)

| Tool | Kind | Graph | Permission |
|---|---|---|---|
| `planner_list_tasks` | read | `/planner/plans/{id}/tasks` | không |
| `planner_summarize_status` | read | tổng hợp trạng thái/quá hạn từ list tasks | không |
| `planner_create_task` | **write** | `POST /planner/tasks` | **PermissionGate** |
| `planner_edit_task` | **write** | `PATCH /planner/tasks/{id}` (ETag) | **PermissionGate** |
| `planner_delete_task` | **write** | `DELETE /planner/tasks/{id}` (ETag) | **PermissionGate** |

- Đối ứng ví dụ User Prompt #1: `planner_list_tasks` + `planner_summarize_status` trả lời
  "task nào trễ không".
- Disambiguation "tìm Planner ABC, có cái khác thì hỏi lại" → read tool trả candidates, model
  hỏi lại trong hội thoại (xem P5). Scope: `Tasks.ReadWrite`, `Group.Read.All`.

### P3 — Lists (đủ CRUD + auto-gen query)

| Tool | Kind | Graph | Permission |
|---|---|---|---|
| `lists_get_items` | read | `/sites/{id}/lists/{id}/items?$filter=...` | không |
| `lists_add_item` | **write** | `POST /sites/{id}/lists/{id}/items` | **PermissionGate** |
| `lists_edit_item` | **write** | `PATCH /.../items/{id}/fields` | **PermissionGate** |
| `lists_delete_item` | **write** | `DELETE /.../items/{id}` | **PermissionGate** |

- **Auto-gen query**: model **tự dựng `$filter`/OData** từ prompt User (đối ứng "tự động gen
  Query để tìm kiếm"). Service validate + cap kết quả.
- Đối ứng ví dụ User Prompt #2: `lists_get_items` lấy danh sách User từ `UserList`.
  Scope: `Sites.ReadWrite.All`.

### P4 — Teams (search + post + @mentions)

| Tool | Kind | Graph | Permission |
|---|---|---|---|
| `teams_search_messages` | read | `/chats/{id}/messages`, `/teams/{id}/channels/{id}/messages` | không |
| `teams_post_chat_message` | **write** | `POST /chats/{id}/messages` | **PermissionGate** |
| `teams_post_channel_message` | **write** | `POST /teams/{id}/channels/{id}/messages` | **PermissionGate** |

- **@mentions**: message body cần `mentions[]` array + placeholder `<at id="0">Name</at>` trong
  content. Tool phải resolve user → `mentioned.user.id` trước khi post.
- Đối ứng yêu cầu: *post message tới Users, groupchat, Channels* + *support mentions*.
  Scope: `Chat.ReadWrite`, `ChannelMessage.Send`, `Chat.Read` (search).

### P5 — Orchestrator (điều phối toàn bộ P1–P5)

Không tool mới — **lớp điều phối chung** để model nối bất kỳ tool nào giữa các nhóm khi tác vụ
cần (vd đọc Outlook → tạo task Planner; đọc Lists → post Teams). Chứa 2 pattern dùng chung:

- **Clarifying / disambiguation**: read tool trả candidates; nếu mơ hồ, model **hỏi lại trong
  hội thoại** (không dialog riêng). Vd "có Planner khác — bạn muốn cái nào?".
- **Batch-confirm**: trước một loạt write (vd tạo task cho từng User trong UserList), hiện
  confirm gom nhóm, rồi PermissionGate cho từng mutation. Không có confirm song song.

Đối ứng đầy đủ ví dụ User Prompt #2 (Lists → Planner cho từng User). Làm sau P1–P4 vì phụ thuộc
các nhóm đã tồn tại.

### P6 — Power Automate (cuối cùng, ghép vào orchestrator sau)

| Tool | Kind | API | Permission |
|---|---|---|---|
| `power_automate_list_flows` | read | Flow API — tự liệt kê flow của User | không |
| `power_automate_trigger_flow` | **write** | Flow API — trigger flow user-defined | **PermissionGate** |

- Hướng đã chốt: **tự liệt kê flow qua API** (không phải registry thủ công). Cần license +
  Flow API riêng **ngoài Graph chuẩn** → rủi ro cao nhất, để cuối.
- Sau khi P6 xong, ghép `power_automate_*` vào orchestrator P5.

## State & error handling (đồng nhất mọi nhóm)

- Connector state là **one source of truth** service-side (đã có); các nhóm không duplicate.
- Lỗi Graph/Flow map sang typed `Ms365Error` + recovery action (`auth_expired` → "Kết nối lại
  Microsoft 365"). Không hiện raw stack cho user.
- Rate limit (429) tôn trọng `Retry-After`; không infinite retry.
- Kết quả read đều **bounded** (cap số item + cap byte body).
- Token/secret **không bao giờ** ở renderer state, EV frame, log, hay tool-call envelope
  (tái dùng redaction Slice 1).

## Testing (khuôn chung tái dùng Slice 1)

Mỗi phase P0.5–P6 lặp lại khuôn của SharePoint:

- **Unit (service)**: mỗi `{group}-service` với fake Graph — dựng query, cap results, bounded
  summary, map lỗi typed. Write: submit PermissionGate và **chỉ** mutate khi Allow; Deny chặn.
- **Tool router**: `not_connected` khi chưa connect; read chạy thẳng; write qua gate.
- **Redaction**: token không xuất hiện trong view/log/envelope.
- **Focused run**: `npm run typecheck`, targeted tests, `npm run build:renderer`.
- **Packaged/live** (sau P0): kịch bản connect → tác vụ nhóm → verify honest.

## Acceptance criteria (roadmap)

1. Mỗi nhóm P1–P6 là một service + tool set tái dùng `Ms365Connector` **không sửa core**.
2. Read chạy trực tiếp; **mọi write qua PermissionGate** — Allow mới thực thi, Deny chặn thật.
3. P0.5 list được toàn bộ site user join; toggle search per-site trong Settings (mặc định bật
   hết); site tắt bị **chặn thật ở service** cho cả SharePoint search và Lists.
4. P1 Outlook read-only (không gửi mail). P2/P3 đủ CRUD. P3 auto-gen OData query. P4 có @mentions.
5. P5 orchestrator nối được nhiều nhóm + clarifying + batch-confirm (đối ứng cả 2 ví dụ User Prompt).
6. P6 tự liệt kê flow qua Flow API, trigger qua PermissionGate.
7. Không secret trong log / state / DOM / envelope / screenshot ở mọi nhóm.
8. Feature flag D2 **OFF mặc định**; baseline journeys PASS khi OFF.
9. Mỗi phase có typecheck + targeted tests + build renderer PASS trước khi sang phase sau.

## Ghi chú thực thi

- Mỗi phase P0.5–P6 sẽ có **spec + plan riêng** (slice độc lập) khi tới lượt, tài liệu này là
  roadmap khung. P0 là điều kiện tiên quyết cho mọi live-verify.
- Cập nhật `docs/product/current-status.md` sau mỗi phase có evidence.
- Cập nhật §3 integration matrix + §5 D2 acceptance trong
  [External Systems Integration Readiness](../../integration/external-systems-integration-readiness.md)
  khi các nhóm hoàn tất.
