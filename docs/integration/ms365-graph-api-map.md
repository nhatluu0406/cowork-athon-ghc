---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Bản đồ API kết nối Microsoft (MS365 / Graph)

Tổng hợp **mọi API bên ngoài mà Cowork GHC gọi tới Microsoft**, trạng thái hoạt động thực tế và
lý do nếu chưa hoạt động. Cập nhật khi mỗi phase D2 thay đổi. Nguồn sự thật về bằng chứng:
`docs/product/current-status.md` (các mục MS365) + ledger SDD.

## Chú giải trạng thái

| Ký hiệu | Nghĩa |
|---|---|
| ✅ **LIVE PASS** | Đã chạy thật với tenant thật, có bằng chứng |
| 🟡 **CODE + UNIT** | Code xong, unit test pass với fake Graph; **chưa** có lượt chạy live |
| 🔴 **BLOCKED** | Code xong nhưng lượt chạy live bị chặn (thiếu scope/app registration) |
| ⬜ **PLANNED** | Trong roadmap, chưa implement |

Ràng buộc chung: mọi call đi qua `HttpGraphClient` **SSRF-pinned** — chỉ được phép tới
`graph.microsoft.com` và `login.microsoftonline.com`; token gắn per-call, redact khỏi log;
lỗi map sang typed `Ms365Error`. Feature flag `CGHC_MS365_ENABLED` OFF mặc định.

## 1. Authentication (login.microsoftonline.com)

| API / cơ chế | Method | Dùng cho | Trạng thái | Ghi chú |
|---|---|---|---|---|
| Manual token (dán access token, không gọi endpoint auth) | — | Kết nối nhanh không cần app registration | ✅ **LIVE PASS** (2026-07-14) | Token in-memory only (không keyring — vượt blob limit ~2560B của Windows Credential Manager); hết hạn ~1h → `needs_reconnect` |
| `POST /{tenant}/oauth2/v2.0/devicecode` | POST | Bắt đầu device-code OAuth | 🔴 **BLOCKED** | Code + unit test xong (fake OAuth). Chặn vì **chưa có `CGHC_MS365_CLIENT_ID`/`CGHC_MS365_TENANT`** — chờ IT cấp app registration ([ms365-it-request.md](./ms365-it-request.md)) |
| `POST /{tenant}/oauth2/v2.0/token` (poll device-code) | POST | Đổi device code lấy access/refresh token | 🔴 **BLOCKED** | Cùng lý do trên; có refresh-token flow, unit-tested |

## 2. Graph core (graph.microsoft.com/v1.0)

| API | Method | Dùng cho | Trạng thái | Ghi chú |
|---|---|---|---|---|
| `/me` | GET | Verify kết nối sau connect (mọi auth source) | ✅ **LIVE PASS** (2026-07-14) | Chạy thật qua `tools/verify/ms365-live-manual-token.mts`; decode scope thật từ token (local, không phải API) cũng PASS |

## 3. SharePoint + Site scope (P0.5 / Slice 1)

| API | Method | Tool | Trạng thái | Ghi chú |
|---|---|---|---|---|
| `/me/followedSites` | GET | `ms365_list_joined_sites` (+ Settings site toggle) | 🔴 **BLOCKED live** (code 🟡 xong) | Lượt live 2026-07-14 trả **403** vì token user thiếu `Sites.Read.All` — cần consent scope (Graph Explorer) hoặc admin consent. Error mapping trên 403 thật đã được xác minh ✅ |
| `/search/query` | POST | `sharepoint_search` | 🟡 **CODE + UNIT** | Tìm theo tên + nội dung; **fail-closed allowlist**: hit thuộc site bị tắt hoặc không resolve được site id → DROP. Chưa live (cần `Sites.Read.All`) |
| `/sites/{siteId}/drive/root/children` | GET | `sharepoint_list_site_files` | 🟡 **CODE + UNIT** | **Allowlist-guarded fail-closed**: site tắt → `endpoint_blocked` TRƯỚC khi gọi Graph. Chưa live |
| `/drive/items/{itemId}/content` | GET | `sharepoint_get_file_summary` | 🟡 **CODE + UNIT** | Body bounded 64 KiB. ⚠️ **Known gap (tracked)**: KHÔNG allowlist-guarded (chỉ có driveItemId, không có site id) — follow-up |
| `/sites/{siteId}/drive/root:/{name}:/content` | PUT | `sharepoint_upload_file` | 🟡 **CODE + UNIT** | **Write duy nhất của slice 1** — chỉ chạy sau Allow của PermissionGate; Deny chặn thật (unit-verified). Chưa live |

## 4. Outlook (P1 — chỉ đọc)

| API | Method | Tool | Trạng thái | Ghi chú |
|---|---|---|---|---|
| `/me/messages?$search=...&$top=...` | GET | `outlook_search_messages` | 🔴 **BLOCKED live** (code 🟡 xong) | Cần `Mail.Read` — token test hiện thiếu. Query của model chỉ vào **giá trị** `$search` (escape `"`), không vào URL path; cap 25 |
| `/me/messages/{id}` | GET | `outlook_get_message`, `outlook_summarize_message` | 🔴 **BLOCKED live** (code 🟡 xong) | Cùng scope `Mail.Read`; body bounded 64 KiB; response dị dạng → `Ms365Error("graph_error")` kèm recovery |

## 5. Planner (P2 — implemented 2026-07-14)

| API | Method | Tool | Trạng thái | Ghi chú |
|---|---|---|---|---|
| `/me/planner/plans` | GET | `planner_list_plans` | 🟡 **CODE + UNIT** | Tìm plan theo tên (disambiguation trong hội thoại). Scope `Tasks.ReadWrite` — KHÔNG cần `Group.Read.All`. Chưa live (token cần `Tasks.ReadWrite`) |
| `/planner/plans/{planId}/tasks` | GET | `planner_list_tasks` | 🟡 **CODE + UNIT** | Đủ trường (due, percentComplete, etag) để model tóm tắt task trễ |
| `/planner/tasks` | POST | `planner_create_task` | 🟡 **CODE + UNIT** | Write → PermissionGate (Deny chặn thật, unit-verified); nhận `assigneeUserIds` optional |
| `/planner/tasks/{taskId}` | PATCH | `planner_edit_task` | 🟡 **CODE + UNIT** | Write → PermissionGate; **`If-Match` ETag bắt buộc** |
| `/planner/tasks/{taskId}` | DELETE | `planner_delete_task` | 🟡 **CODE + UNIT** | Write → PermissionGate; `If-Match` ETag bắt buộc |
| `/planner/tasks` (N lần, tuần tự) | POST | `planner_create_tasks` (batch, P5) | 🟡 **CODE + UNIT** | **MỘT permission card khai báo cả loạt (cap 20)**; per-item honest (`created[]`/`failed[]`); bị chặn bởi write-mode `manual` (mặc định) — trả `manual_mode` để model tạo lẻ từng task |

> `HttpGraphClient` đã mở rộng (P2 Task 1): `PATCH`/`DELETE`, header `If-Match`, `noContent()`
> cho 204 — additive, hành vi GET/POST/PUT cũ không đổi (suite cũ pass nguyên vẹn).

> Write-mode `manual`/`auto` (P5): lưu `.runtime/ms365-write-mode.json`, đổi qua
> `GET/POST /v1/ms365/write-mode` (token-guarded) — pill toggle trong composer chat. CHỈ ảnh
> hưởng batch tool; mọi write lẻ vẫn một card một lần.

## 6. Lists (P3 — implemented 2026-07-14)

| API | Method | Tool | Trạng thái | Ghi chú |
|---|---|---|---|---|
| `/sites/{siteId}/lists` | GET | `lists_get_lists` | 🟡 **CODE + UNIT** | Tìm list theo tên (vd "UserList"). **Site allowlist chặn fail-closed MỌI method** (kể cả write) trước Graph call |
| `/sites/{siteId}/lists/{listId}/items?expand=fields&$filter=` | GET | `lists_get_items` | 🟡 **CODE + UNIT** | Model tự gen OData `$filter` — chỉ vào query value, không vào path |
| `.../items` | POST | `lists_add_item` | 🟡 **CODE + UNIT** | Write → PermissionGate (Deny chặn thật, spy-verified) |
| `.../items/{id}/fields` | PATCH | `lists_edit_item` | 🟡 **CODE + UNIT** | Write → PermissionGate; không cần ETag (khác Planner) |
| `.../items/{id}` | DELETE | `lists_delete_item` | 🟡 **CODE + UNIT** | Write → PermissionGate |

## 7. Teams messaging (P4 — implemented 2026-07-14)

| API | Method | Tool | Trạng thái | Ghi chú |
|---|---|---|---|---|
| `/me/chats?$expand=members` | GET | `teams_list_chats` | 🟡 **CODE + UNIT** | Tìm chat theo topic/member |
| `/me/joinedTeams` | GET | `teams_list_teams` | 🟡 **CODE + UNIT** | |
| `/teams/{teamId}/channels` | GET | `teams_list_channels` | 🟡 **CODE + UNIT** | |
| `/chats/{id}/members`, `/teams/{id}/members` | GET | `teams_list_members` | 🟡 **CODE + UNIT** | Resolve `{userId, displayName}` cho mentions (nền resolve-user cho P5) |
| `/chats/{id}/messages`, `/teams/{tid}/channels/{cid}/messages` | GET | `teams_get_messages` | 🟡 **CODE + UNIT** | **Honest**: Graph v1.0 KHÔNG có `$search` trên messages — trả N tin gần nhất (cap 50), model tự lọc |
| `.../messages` | POST | `teams_post_message` | 🟡 **CODE + UNIT** | Write → PermissionGate. Mentions an toàn: HTML-escape toàn bộ + placeholder `@{i}` → `<at>` (injection-tested 7 chiến lược, không bypass) |

## 8. Các phase sau (roadmap, chưa spec chi tiết)

| Nhóm | API dự kiến | Trạng thái |
|---|---|---|
| Power Automate (P6) | Flow API (NGOÀI Graph chuẩn — cần host/license riêng, sẽ cần nới SSRF allowlist qua ADR) | ⬜ PLANNED |

## 9. Scope OAuth đang khai báo (`MS365_SCOPES`)

| Scope | Dùng cho | Đã live-consent? |
|---|---|---|
| `Files.ReadWrite.All` | SharePoint file read + upload | ❌ chưa (token test thiếu) |
| `Sites.ReadWrite.All` | Site discovery + search + **Lists CRUD (P3)** — thay `Sites.Read.All` (ReadWrite bao Read) | ❌ chưa — thiếu scope này là nguyên nhân 403 `/me/followedSites` |
| `Mail.Read` | Outlook read (P1) | ❌ chưa |
| `Tasks.ReadWrite` | Planner CRUD (P2) | ❌ chưa (token test thiếu) |
| `Chat.ReadWrite` | Teams chat list/read/send + members (P4) — KHÔNG `Chat.ReadWrite.All` | ❌ chưa |
| `Team.ReadBasic.All` | List joined teams (P4) | ❌ chưa |
| `Channel.ReadBasic.All` | List channels (P4) | ❌ chưa |
| `ChannelMessage.Read.All` | Đọc channel messages (P4) | ❌ chưa |
| `ChannelMessage.Send` | Post channel message (P4) | ❌ chưa |

## 10. Việc cần làm để chuyển 🔴/🟡 → ✅

1. **Token đúng scope** (nhanh nhất): consent `Mail.Read` + `Sites.Read.All` (+ `Files.Read.All`)
   trong Graph Explorer → chạy `node --import tsx tools/verify/ms365-live-manual-token.mts`
   (token qua env `CGHC_MS365_TEST_TOKEN`, không dán vào file/chat).
   (đã sửa 2026-07-15, fixpack): 403 do thiếu scope giờ được map thành mã lỗi rõ ràng
   `insufficient_scope` (không còn 403 chung chung) kèm recovery hướng dẫn consent lại — xem
   Task 1 của fixpack; UI connect cũng hiển thị đúng scope thật (`view.scopes`) thay vì danh sách
   hard-code cũ.
2. **IT cấp app registration** → mở device-code (hết phụ thuộc token 1h) —
   [ms365-it-request.md](./ms365-it-request.md).
3. **Verify OpenCode child consume tool** end-to-end (open item từ slice 1) — điều kiện để mọi
   tool ở trên được model gọi trong phiên chạy thật. Đây cũng là **acceptance của P5** (batch tool
   `planner_create_tasks` + orchestration policy chỉ có giá trị khi model thật gọi được tool qua
   một child đang chạy) — quy trình live consumption run cụ thể ghi ở block P5 trong
   `docs/product/current-status.md`; MỌI lượt chạy (PASS/FAIL) phải cập nhật ngược lại bảng ở đây.
   **Cập nhật (P5.5, 2026-07-14): plugin registration ✅ LIVE PASS (offline, không cần model/tenant)**
   — đã spawn binary pin thật (`node_modules/opencode-ai/bin/opencode.exe` v1.17.11) với
   `<configDir>/plugin/ms365.ts` + `<configDir>/node_modules/@opencode-ai/plugin` (+deps) do
   `writeMs365Plugin`/`seedMs365PluginDeps` ghi, env dummy (`CGHC_MS365_TOOL_ENDPOINT` trỏ cổng
   chết, `CGHC_MS365_TOKEN` chuỗi giả). Sau `/global/health` ready, `GET /experimental/tool/ids`
   liệt kê đủ **25/25 tên tool MS365** (khớp `TOOL_NAMES`), `GET /config` xác nhận
   `plugin: ["file:///.../plugin/ms365.ts"]` được OpenCode nạp qua glob thư mục config (KHÔNG cần
   khai trong `opencode.json`), stderr child rỗng (không lỗi import `@opencode-ai/plugin`). Đây là
   bằng chứng thực nghiệm cho luận điểm đã bị bác bỏ trước đó (reviewer cho rằng OpenCode chỉ nạp
   plugin qua config `plugin` array) — xác nhận đúng theo source `config/plugin.ts`/`paths.ts` ở
   tag v1.17.11. **Việc CHƯA làm**: roundtrip qua phiên thật với model + gate + scoped token +
   session gating (chain đầy đủ plugin → HTTP → route → handler) — cần user tự chạy theo runbook ở
   block P5.5 trong `current-status.md` (đòi hỏi provider key thật + app dev/packaged đang chạy).
4. **Cập nhật (P5.6, 2026-07-15): tool MS365 giờ chỉ có thể được model gọi từ một UI cụ thể — tab
   Microsoft 365 (chat trong tab, không phải chat chính).** Trước P5.6, session gating (P5.5) đã
   chặn đúng ở tầng route, nhưng KHÔNG có UI nào tự nhiên đăng ký một session hợp lệ vào allowlist
   — user phải gọi thủ công `POST /v1/ms365/session-scope` qua HTTP để mô phỏng. P5.6 nối luồng
   thật: mỗi lượt gửi ở tab Microsoft 365 tự tạo session mới → tự đăng ký scope
   (`setMs365SessionScope(id, true)`) TRƯỚC khi dispatch prompt → tự thu hồi
   (`setMs365SessionScope(id, false)`) khi kết thúc lượt (terminal/cancel/disconnect). Chat chính
   (main chat) vẫn bị chặn như cũ (chưa từng được đăng ký) — hành vi P5.5 không đổi, chỉ thêm một
   con đường UI hợp lệ duy nhất để kích hoạt. **Live end-to-end với model thật qua con đường UI này
   vẫn CHƯA được xác minh** trong lần này (cần provider key + flag ON + MS365 connected) — xem hạn
   chế trung thực ở block P5.6 trong `current-status.md`.
