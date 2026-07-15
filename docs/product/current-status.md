---
language: "vi"
status: "active"
updated_at: "2026-07-15"
---

# Trạng thái hiện tại

Cowork GHC đang ở giai đoạn **POC demo candidate** với Commercial UI V3 đã tích hợp. GUI đã có light/dark theme và ngôn ngữ thiết kế thống nhất; vẫn còn các slice chức năng và polish hữu hạn trước funding demo.

## Capability inventory

| Năng lực | Trạng thái | Ghi chú hiện tại |
|---|---|---|
| Startup / lifecycle | **WORKS** | Start/stop/build scripts và New Chat startup. |
| Cowork chat / streaming | **WORKS** | Streaming, history, bounded context và transcript persistence. |
| Conversation management | **PARTIAL** | Search/rename/delete có nền tảng; cần PO regression check cho thao tác delete và menu. |
| Permission modes | **PARTIAL** | Hỏi trước / Tự động / Chỉ đọc đã có; repeated prompt và policy behavior cần packaged happy-path verification. |
| Verified file create/modify | **PARTIAL** | False-success guard và file evidence đã bổ sung; golden path phải tiếp tục được kiểm tra trên packaged app. |
| Provider profiles | **PARTIAL** | DeepSeek preset + custom OpenAI-compatible, keyring, active profile; model discovery và reliable readiness persistence chưa hoàn tất. |
| Credentials | **WORKS** | Windows Credential Manager; không persist plaintext key trong profile JSON/UI state. |
| Workspace navigator | **WORKS — BASIC** | Guarded file tree, open folder, refresh, selection. |
| Workspace preview/edit | **PARTIAL** | Text/Markdown edit; binary preview theo giới hạn; PDF packaged behavior và live Agent refresh còn cần hardening. |
| Skills CRUD | **WORKS — BASIC** | User Skill create/edit/delete/enable; built-in read-only. |
| Inspector | **PARTIAL** | Shell/tabs có sẵn; cần product definition và data contract rõ cho Plan/Activity/File Review. |
| Settings / theme | **WORKS — BASIC** | Full-screen Settings; System/Light/Dark; cần giảm scroll/nút và polish các form state. |
| Detailed logging | **PARTIAL / NEEDS CLARIFICATION** | Setting tồn tại; cần tài liệu và xác nhận output/retention/redaction. |
| Local telemetry | **PARTIAL / NEEDS CLARIFICATION** | Setting tồn tại; cần contract local-only, event list, retention và export behavior. |
| Local user authentication | **NOT IMPLEMENTED** | Chưa có local sign-in/lock gate. |
| File Work Review delete | **DEFERRED** | OpenCode v1.17.11 tool surface chưa cho deterministic delete acceptance. |
| D1–D4 backend | **WAITING** | Integration surfaces có sẵn; team backend chưa merge. |
| Full RC / release signing | **DEFERRED** | Chưa phải release candidate. |

## Demo truth

Demo hiện nên tập trung vào:

```text
Launch → select provider → select workspace → chat → ask permission → create/modify file → preview/review → reopen history
```

Không trình bày D1–D4 placeholder như capability đã hoàn thành.
---

## MS365 connector + SharePoint slice — D2 (2026-07-14)

| Item | Status |
|---|---|
| Spec | `docs/superpowers/specs/2026-07-13-ms365-connector-sharepoint-design.md` |
| Plan | `docs/superpowers/plans/2026-07-13-ms365-connector-sharepoint.md` |
| Branch | `feature/ms365-connector-sharepoint` |
| HEAD | `d086ecd` — fix(ms365): advertise tool endpoint to OpenCode child via baseEnv when flag on |
| Feature flag | `CGHC_MS365_ENABLED` — **OFF by default**; with flag off, composition and child env are byte-for-byte unchanged (verified in review) |

### Đã triển khai (what shipped)

- Nền tảng connector MS365 (`ms365-connector`, `ms365-graph-client`, `ms365-errors`) với ánh xạ lỗi Graph rõ ràng.
- Đăng nhập bằng **manual token hoạt động được** (dán access token thủ công, xác thực qua Graph client).
- **Device-code OAuth đã viết code nhưng đang bị chặn (gated)**: chưa có Azure app registration / client ID thật cho tenant thật, nên luồng device-code chưa thể hoàn tất việc kết nối thực sự. Không có trạng thái "đã kết nối" giả nào được hiển thị.
- SharePoint: tìm kiếm (search), liệt kê (list), tóm tắt (summary), và **upload** (ghi, có kiểm soát quyền).
- Tool dispatch cho SharePoint với **upload chỉ chạy sau khi có quyết định Allow được ghi nhận** (permission-gated); Deny chặn thực sự ở boundary thực thi.
- Router loopback token-guarded (`ms365-tool-router` + barrel) làm ranh giới port/adapter cho MS365.
- Khi flag **ON**, service quảng bá (advertise) endpoint tool MS365 cho OpenCode child qua biến môi trường `CGHC_MS365_TOOL_ENDPOINT` / `CGHC_MS365_TOKEN` trong `baseEnv` của child process.

### Bằng chứng hồi quy đã xác minh (verified regression)

```text
npm run typecheck        → exit 0 PASS (trên HEAD d086ecd)
npm run build:renderer   → exit 0 PASS (trên HEAD d086ecd)
MS365 unit tests         → 54/54 PASS, 0 fail, 10 file:
  ms365-errors, ms365-graph-client, ms365-manual-token, ms365-device-code,
  ms365-connector, ms365-sharepoint, ms365-view-redaction, ms365-tool-router,
  ms365-flag-off, ms365-child-env
```

Bộ test đầy đủ của repo có **~20 lỗi có sẵn (pre-existing) trên 13 suite** không liên quan đến
MS365 (`composition-ssot-and-redaction`, `composition-loopback-e2e`, `conversation-relaunch`,
`execution-captured-frames`, `execution-ev-reducer`, `execution-sse-mapper`,
`runtime-session-store-adapter`, `session-live-run-e2e`, `session-restart`,
`session-router-boundary`, `session-stream-hub`, `session-stream-live-e2e`,
`streaming-backpressure`, `streaming-coalesce`). Đây là các suite live/integration/streaming
lỗi trong môi trường dev hiện tại **độc lập** với slice này — không có file nào trong danh sách
là file MS365, và tập lỗi không đổi khi tắt flag MS365. Các suite này KHÔNG được coi là PASS
và KHÔNG do slice này gây ra; báo cáo này không tuyên bố chúng pass.

### Giới hạn trung thực (honesty limitations — phải đọc trước khi coi slice là "xong")

1. **Device-code OAuth bị gate**: chỉ đăng nhập bằng manual token là dùng được thật; device-code
   đã có code nhưng chưa thể hoàn tất kết nối vì chưa có Azure app registration/client ID thật —
   không có trạng thái "đã kết nối" giả.
2. **Quảng bá tool vs. thực sự tiêu thụ (consumption) chưa được xác minh end-to-end**: service đã
   set `CGHC_MS365_TOOL_ENDPOINT` / `CGHC_MS365_TOKEN` trong env của OpenCode child khi flag ON,
   nhưng việc runtime OpenCode thực tế có đọc các biến này để đăng ký MS365 tool thành tool mà
   model có thể gọi (model-callable) **chưa được kiểm chứng qua một child đang chạy thật**. Đây là
   một hạng mục xác minh còn mở (open verification item) — không tuyên bố model đã gọi được
   SharePoint tool trong một phiên chạy thật.
3. **Chưa có xác minh packaged/live với tenant thật**: toàn bộ bằng chứng ở mức unit test; chưa có
   lưu lượng Microsoft Graph / SharePoint thật nào được thực thi.
4. **Thực thi quyền cho hành động ghi (upload)** đã được xác minh ở mức unit (Deny chặn thực sự;
   upload chỉ chạy sau một quyết định Allow được ghi nhận), nhưng **chưa được xác minh qua một
   lượt chạy end-to-end thật**.
5. Slice này **tắt theo mặc định** (`CGHC_MS365_ENABLED=false`); baseline không bị ảnh hưởng khi flag off.

### Kết luận trạng thái

```text
D2 (MS365 connector + SharePoint): foundation implemented behind flag, NOT merge-ready
  as a full live integration. Manual token connect works; device-code gated; tool
  consumption by live OpenCode child not yet verified; no packaged/live tenant run.
```

## MS365 site scope — Site discovery + search allowlist (P0.5, 2026-07-14)

| Item | Status |
|---|---|
| Spec | `docs/superpowers/specs/2026-07-14-ms365-task-suite-roadmap-design.md` (§P0.5) |
| Plan | `docs/superpowers/plans/2026-07-14-ms365-site-scope.md` |
| Branch | `feature/ms365-ui-wiring-device-code` |
| HEAD | `f742e85` — feat(ui): MS365 Settings site-scope list + per-site search toggles |
| Feature flag | `CGHC_MS365_ENABLED` — **OFF mặc định**; toàn bộ construction nằm trong nhánh flag, flag OFF không dựng gì mới |

### Đã triển khai (what shipped)

- `SiteScopeStore` (`service/src/ms365/site-scope-store.ts`): allowlist site được search, **mặc định
  bật hết** (user opt-out site nhạy cảm), persist qua port. Chỉ chứa site id + enabled bool —
  **không token, không dùng keyring** (đây là preference).
- `SiteScopeFilePersistence` (`.runtime/ms365-site-scope.json`): file-backed, file thiếu/hỏng
  load thành `[]` (không throw, không chặn khởi động MS365).
- `SiteScopeService` (`service/src/ms365/site-scope-service.ts`): liệt kê **toàn bộ site user
  đang join** qua Graph `GET /me/followedSites`, merge trạng thái enabled; tái dùng
  `Ms365Connector.graph()` — không chạm Graph/token/keyring trực tiếp.
- **Enforce ở service, FAIL-CLOSED**: `SharePointService.search` lọc site theo allowlist tại
  execution boundary. Site tắt → không lọt kết quả. Hit **không resolve được site id** khi có
  allowlist → **bị DROP** (default-deny, quyết định sau security review 2026-07-14). AI không
  bỏ qua được.
- Tool `ms365_list_joined_sites` (read, không PermissionGate) + 2 route token-guarded cho
  Settings: `GET /v1/ms365/sites`, `POST /v1/ms365/sites/toggle`.
- Renderer Settings: mục "Phạm vi tìm kiếm SharePoint" chỉ hiện khi `connected`, liệt kê site
  kèm toggle bật/tắt search per-site (native checkbox, có `aria-label`, keyboard-accessible),
  gọi service client loopback (không chạm Graph). DOM không chứa token/secret.

### Bằng chứng đã xác minh (verified)

```text
npm run typecheck                          → exit 0 PASS (tsc -b, toàn repo)
service MS365 suite (tests/ms365-*.test.ts) → 100/100 PASS, 0 fail
  gồm ms365-flag-off (3/3, flag OFF không dựng gì mới),
  ms365-site-scope-store, ms365-site-scope-service,
  ms365-sharepoint-site-filter (fail-closed), ms365-sites-tool,
  ms365-sites-routes, ms365-site-scope-file-persistence
app/ui ms365-service-client                 → 6/6 PASS (2 test mới: list GET, toggle POST body)
npm run build:renderer                      → exit 0 PASS
```

Security review commit đã bắt lỗi fail-open ban đầu; đã sửa sang fail-closed và cập nhật spec/plan
cho khớp.

### Live-tenant evidence (một phần, 2026-07-14)

Lượt Graph traffic THẬT đầu tiên của track D2, chạy qua `tools/verify/ms365-live-manual-token.mts`
(token đọc từ env `CGHC_MS365_TEST_TOKEN`, không bao giờ in/commit):

```text
[1] connectWithToken → GET /me            → PASS LIVE (tenant thật; granted scopes decode đúng)
[2] /me/followedSites                     → 403 (token user thiếu Sites.Read.All)
    → map đúng sang typed error "Microsoft 365 authorization failed.", không lộ token,
      script thoát sạch — error mapping được xác minh trên traffic 403 THẬT.
```

Kết luận: **manual-token connect + /me verify + scope decode + typed error mapping đã live-verified.**
Phần site-list/search/Outlook **chưa** live-verified vì token thiếu scope `Sites.Read.All`/`Mail.Read`
(cần consent trong Graph Explorer, hoặc admin consent của tenant — đúng nội dung
`docs/integration/ms365-it-request.md`).

### Giới hạn trung thực (honesty limitations)

1. **Live-tenant run mới PARTIAL**: connect + /me + error mapping đã live-verified (xem trên);
   nhưng **site list → toggle → search-bị-chặn và Outlook search/summarize chưa chạy live** vì
   token hiện có thiếu scope `Sites.Read.All`/`Mail.Read`. Bước còn lại này **NOT DONE** — không
   tuyên bố đã pass.
2. **OpenCode child tool-consumption vẫn chưa xác minh end-to-end** (kế thừa từ slice connector):
   việc runtime OpenCode thật đọc endpoint tool và gọi được `ms365_list_joined_sites` /
   `sharepoint_search` (đã lọc allowlist) qua một child chạy thật chưa được kiểm chứng.
3. **Device-code vẫn gated chờ IT** (kế thừa): manual token là đường kết nối chạy thật hôm nay.
4. **Security follow-up (2026-07-14)**: whole-branch review phát hiện `sharepoint_list_site_files`
   trước đó KHÔNG lọc allowlist — AI có thể truyền thẳng `siteId` của site đã bị tắt và vẫn liệt kê
   được file. Đã sửa: `listSiteFiles` nay fail-closed giống `search` (throw `Ms365Error`
   `endpoint_blocked` khi site bị tắt, mapped qua `handleToolCall` thành `{ok:false, error}` không
   crash). **Còn một gap CHƯA sửa**: `sharepoint_get_file_summary` chỉ nhận `driveItemId`, không có
   `siteId`, nên KHÔNG thể check allowlist rẻ tiền tại chỗ (cần thêm 1 Graph call resolve parent site
   trước — ngoài phạm vi fix này, cần thiết kế riêng). Đây là gap đã biết, theo dõi cho việc kế tiếp.

## MS365 Outlook read-only (P1, 2026-07-14)

| Item | Status |
|---|---|
| Spec | `docs/superpowers/specs/2026-07-14-ms365-outlook-read-design.md` |
| Plan | `docs/superpowers/plans/2026-07-14-ms365-outlook-read.md` |
| Branch | `feature/ms365-ui-wiring-device-code` |
| HEAD | `2040ecc` — fix(ms365): typed Ms365Error + KQL quote-escape in Outlook (final-review minors) |
| Final review | **Ready to merge: YES** (opus whole-branch review; 2 minor đã fix trong `2040ecc`) |

### Đã triển khai (what shipped)

- `OutlookService` (`service/src/ms365/outlook-service.ts`): read-only `/me/messages` —
  `searchMessages` (metadata + snippet, model tự dựng query), `getMessage`, `getMessageSummaryText`
  (body bounded 64 KiB). Chỉ GET; **không có đường ghi nào** (không gửi/reply).
- **Injection-safe**: query của model chỉ vào **giá trị** `$search` (escape dấu `"` nhúng để không
  phá KQL phrase), không bao giờ vào URL path; message id được `encodeURIComponent`.
- 3 read tool (`outlook_search_messages`, `outlook_get_message`, `outlook_summarize_message`)
  dispatch trực tiếp — **không PermissionGate** (read-only), guard `not_connected` fail closed.
- Scope **`Mail.Read`** (least-privilege — không `Mail.ReadWrite`/`Mail.Send`) thêm vào `MS365_SCOPES`.
- Lỗi Graph response dị dạng → typed `Ms365Error("graph_error")` kèm recovery action (không phải 500 chung).

### Bằng chứng đã xác minh (verified)

```text
npm run typecheck                    → exit 0 PASS
MS365 suite (tests/ms365-*.test.ts)  → 115/115 PASS (incl outlook-service 7/7, outlook-tool 5/5, flag-off)
Final whole-branch review            → Ready to merge YES; 6/6 binding constraints hold
```

### Giới hạn trung thực (honesty limitations)

1. **Outlook chưa live-verified**: token test hiện có thiếu `Mail.Read` (xem live-tenant evidence
   ở mục P0.5). Cần token có `Mail.Read` để chạy `tools/verify/ms365-live-manual-token.mts` phần [4].
2. Kế thừa: OpenCode child tool-consumption chưa verify end-to-end; device-code gated chờ IT.

## MS365 Planner CRUD (P2, 2026-07-14)

| Item | Status |
|---|---|
| Spec | `docs/superpowers/specs/2026-07-14-ms365-planner-crud-design.md` |
| Plan | `docs/superpowers/plans/2026-07-14-ms365-planner-crud.md` |
| HEAD | `bec16c2` — feat(ms365): add Tasks.ReadWrite scope for Planner (P2) |
| Final review | **Ready to merge: YES** (opus whole-branch; mọi Minor là follow-up, không blocker) |

### Đã triển khai (what shipped)

- `HttpGraphClient` mở rộng **additive**: `PATCH`/`DELETE`, header `If-Match` (chỉ khi có
  `ifMatch`), `noContent()` cho 204 — cùng một đường `send()` duy nhất nên SSRF/host-allowlist/
  redirect discipline phủ luôn method mới; hành vi GET/POST/PUT cũ không đổi (suite cũ pass nguyên).
- `PlannerService`: `listPlans` qua `/me/planner/plans` (**không cần `Group.Read.All`** — hẹp hơn
  roadmap), `listTasks` (etag từ `@odata.etag`, đủ trường để model tóm tắt task trễ),
  `createTask` (nhận `assigneeUserIds` optional), `editTask`/`deleteTask` (**ETag `If-Match`
  bắt buộc**, body chỉ chứa field được cung cấp).
- 5 tool: 2 read chạy thẳng; **3 write (create/edit/delete) qua PermissionGate** đúng khuôn
  upload — Deny/không quyết định thì Graph mutation KHÔNG BAO GIỜ chạy (unit-verified bằng spy);
  Allow mới chạy. Scope `Tasks.ReadWrite` (least-privilege).

### Bằng chứng đã xác minh (verified)

```text
npm run typecheck                    → exit 0 PASS
MS365 suite (tests/ms365-*.test.ts)  → 130/130 PASS (graph-client 16, planner-service 5,
                                       planner-tool 7, flag-off, còn lại không regress)
Final whole-branch review            → Ready to merge YES; write-gate/additive/injection/
                                       flag-off/consistency/secret — 6/6 clean
```

### Giới hạn trung thực (honesty limitations)

1. **Planner chưa live-verified**: token test thiếu `Tasks.ReadWrite` — api-map ghi 🟡 CODE+UNIT.
   Chạy `tools/verify/ms365-live-manual-token.mts` với token đủ scope để chốt (nhớ update api-map).
2. Kế thừa: OpenCode child tool-consumption chưa verify end-to-end; device-code gated chờ IT.

## MS365 Lists CRUD (P3, 2026-07-14)

| Item | Status |
|---|---|
| Spec | `docs/superpowers/specs/2026-07-14-ms365-lists-crud-design.md` |
| Plan | `docs/superpowers/plans/2026-07-14-ms365-lists-crud.md` |
| HEAD | `150b431` — feat(ms365): register lists tools; scope Sites.ReadWrite.All |
| Final review | **Ready to merge: YES** (opus whole-branch; 3 Minor toàn doc/cosmetic) |

### Đã triển khai (what shipped)

- `ListsService`: `getLists`/`getItems` (model tự gen OData `$filter` — chỉ vào query value),
  `addItem`/`editItem`/`deleteItem`. **Site allowlist P0.5 chặn fail-closed MỌI method** (đọc lẫn
  ghi) TRƯỚC mọi Graph call — test khẳng định 0 Graph call trên site tắt cho cả 5 method. Khác
  SharePoint: mọi method Lists đều có `siteId` nên **về cấu trúc không thể có lỗ hổng kiểu
  `get_file_summary`** (reviewer xác nhận).
- 5 tool: 2 read thẳng; **3 write qua PermissionGate** (Deny → mutation không chạy, spy-verified).
- Follow-up P2 hoàn tất: `never`-exhaustiveness cho write handlers qua type-guard predicates
  (`isPlannerWrite`/`isListsWrite`) — **không cast**; write lọt vào `handleRead` sẽ compile-error.
- Scope: `Sites.Read.All` → **`Sites.ReadWrite.All`** (Lists cần write; ReadWrite bao Read).
- Không đổi `graph-client` (PATCH/DELETE/noContent đã có từ P2); Lists không cần ETag.

### Bằng chứng đã xác minh (verified)

```text
npm run typecheck                    → exit 0 PASS
MS365 suite (tests/ms365-*.test.ts)  → 146/146 PASS (lists-service 8, lists-tool 8, flag-off,
                                       các suite cũ không regress)
Final whole-branch review            → Ready to merge YES; 6/6 cross-cutting clean
```

> Lưu ý lịch sử: số test và verdict ở block trên là bằng chứng TẠI THỜI ĐIỂM P3 (2026-07-14).
> Các slice sau (P4, P5, P5.5, P5.6, fixpack 2026-07-15) có block bằng chứng riêng bên dưới.

### Giới hạn trung thực (honesty limitations)

1. **Lists chưa live-verified**: token test thiếu `Sites.ReadWrite.All` — api-map ghi 🟡.
2. Follow-up ghi nhận: UI `MS365_REQUESTED_SCOPES` (danh sách hiển thị khi disconnected) đã stale
   so với `MS365_SCOPES` thật (pre-existing, không do P3) — dọn ở UI-hygiene slice sau.
   (đã sửa 2026-07-15, fixpack: scope list render trực tiếp từ `view.scopes` — service truth —
   không còn danh sách hard-code; xem `app/ui/src/ui-shell/microsoft/ms-connect-view.ts`.)
3. Kế thừa: `sharepoint_get_file_summary` chưa allowlist-guard (tracked); OpenCode child
   tool-consumption chưa verify; device-code chờ IT.

## MS365 Teams messaging (P4, 2026-07-14)

| Item | Status |
|---|---|
| Spec | `docs/superpowers/specs/2026-07-14-ms365-teams-messaging-design.md` |
| Plan | `docs/superpowers/plans/2026-07-14-ms365-teams-messaging.md` |
| HEAD | `3e7e268` — feat(ms365): add 5 Teams scopes (P4) |
| Final review | **Ready to merge: YES** (opus whole-branch; mọi Minor harmless, không cần fix) |

### Đã triển khai (what shipped)

- `TeamsService`: list chats/teams/channels/members; `getMessages` trả N tin gần nhất (cap 50,
  text bounded 4 KiB) — **honest: Graph v1.0 KHÔNG có `$search` trên messages**, model tự lọc;
  `postMessage` gửi tới chat hoặc channel (target union `chatId` XOR `teamId`+`channelId`,
  ambiguity không thể lọt tới Graph).
- **@mentions an toàn**: `buildTeamsBody` HTML-escape TOÀN BỘ content trước, rồi thay placeholder
  `@{i}` bằng `<at id="i">` — model không bao giờ viết HTML thô vào Teams. Đã stress-test 7 chiến
  lược injection (fake `<at>`, tag-breaking displayName, entity pre-encoding…) — **không bypass**;
  reviewer final xác nhận đây là **đường duy nhất** content tới POST body.
- 6 tool: 5 read thẳng; `teams_post_message` qua PermissionGate (Deny → không gửi, spy-verified).
- `teams_list_members` trả `{userId, displayName}` — nền resolve-user cho P5 orchestration.
- Scope 5 cái least-privilege: `Chat.ReadWrite` (KHÔNG `.All`), `Team.ReadBasic.All`,
  `Channel.ReadBasic.All`, `ChannelMessage.Read.All`, `ChannelMessage.Send`.
- Đóng luôn Minor P3: docblock rationale bổ sung cho `isListsWrite`/`isPlannerWrite`.

### Bằng chứng đã xác minh (verified)

```text
npm run typecheck                    → exit 0 PASS
MS365 suite (tests/ms365-*.test.ts)  → 164/164 PASS (teams-service 10 gồm injection cases,
                                       teams-tool 8, flag-off, suite cũ không regress)
Final whole-branch review            → Ready to merge YES; injection single-path, gate
                                       compile-enforced, scope exact, flag-off intact
```

### Giới hạn trung thực (honesty limitations)

1. **Teams chưa live-verified**: token test thiếu 5 scope Teams — api-map ghi 🟡.
2. Không có full-text search server-side trên messages (giới hạn Graph, không phải bug) — đã ghi
   rõ trong code + api-map.
3. Kế thừa: `get_file_summary` allowlist gap; OpenCode tool-consumption chưa verify; device-code
   chờ IT.

## MS365 orchestration + batch write-mode (P5, 2026-07-14)

| Item | Status |
|---|---|
| Spec | `docs/superpowers/specs/2026-07-14-ms365-orchestration-design.md` |
| Plan | `docs/superpowers/plans/2026-07-14-ms365-orchestration.md` |
| Branch | `feature/ms365-ui-wiring-device-code` |
| HEAD | `67f2e72` — feat(ui): MS365 write-mode pill in the chat composer — visible when connected, service is the source of truth |
| Final review | Whole-branch review độc lập (opus, 2026-07-14): "Ready to merge: With fixes" — fix duy nhất là chính các link Spec/Plan ở bảng này (đã sửa); không có finding Critical/Important về code |

### Đã triển khai (what shipped)

- `Ms365WriteModeStore` (`service/src/ms365/write-mode-store.ts`): 2 giá trị `manual` (mặc định)
  / `auto`, persist qua `.runtime/ms365-write-mode.json` (file-backed, thiếu/hỏng → fallback
  `manual`, không throw, không chặn khởi động). 2 route token-guarded: `GET`/`POST
  /v1/ms365/write-mode`.
- `planner_create_tasks` (`service/src/ms365/ms365-batch-tools.ts`): batch tool tạo nhiều Planner
  task trong một lượt — cap 20 item, **MỘT permission card duy nhất khai báo cả loạt** (mô tả
  bounded ~500 ký tự, luôn ghi rõ tổng số item), Graph call tuần tự (sequential, không parallel),
  kết quả per-item honest `{created: [...], failed: [{index, title, error}]}` — không có "tất cả
  thành công" giả khi có item lỗi. Ở write-mode `manual` (mặc định), tool trả lỗi cấu trúc
  `manual_mode` **TRƯỚC KHI** tạo bất kỳ permission card nào, buộc model quay lại tạo lẻ từng task
  qua `planner_create_task` (mỗi task một card, đúng khuôn P2).
- `MS365_ORCHESTRATION_POLICY` (`app/ui/src/dispatch-plan.ts`): khối 5 quy tắc tiếng Việt hướng
  dẫn model cách dùng batch tool + write-mode, chỉ tiêm vào prompt khi MS365 đã **connected**
  (không tiêm khi disconnected/flag off), có tính vào budget prompt hiện có (không phá ngân sách
  token). `msView` giờ fetch state khi client MS365 sẵn sàng (helper `ensureMs365ViewFetched`),
  không chờ tương tác thủ công.
- Pill toggle "MS365: Thủ công ⇄ Tự động" (`app/ui/src/ms365-write-mode-control.ts`) trong composer
  chat chính — **chỉ hiện khi connected**. Service là nguồn sự thật duy nhất: click phát event →
  `POST /v1/ms365/write-mode` → chỉ đổi nhãn sau khi service xác nhận. Fetch lỗi → ẩn pill (không
  hiện nhãn sai); POST lỗi → giữ nguyên nhãn cũ (không optimistic-update giả). `service-client.ts`
  thêm `fetchMs365WriteMode`/`setMs365WriteMode` (UI không import type từ service src — đúng biên
  client/service, `Ms365WriteMode` định nghĩa lại độc lập ở UI theo quy ước dự án).

### Bằng chứng đã xác minh (verified)

```text
service MS365 suite (tests/ms365-*.test.ts) → 181 PASS, 0 fail (re-run 2026-07-14 khi viết tài
                                               liệu này; gồm write-mode-store/persistence/routes
                                               + ms365-batch-tools, suite cũ không regress)
app/ui (dispatch-plan.test.ts + ms365-write-mode-control.test.ts) → 13 PASS, 0 fail (re-run
                                               2026-07-14; 4 test orchestration-policy mới trong
                                               dispatch-plan, 4 test pill mới trong
                                               ms365-write-mode-control)
```

Chưa chạy `npm run typecheck` / `npm run build:renderer` toàn repo riêng cho báo cáo này trong lúc
viết tài liệu — chỉ đã re-run trực tiếp 2 file test suite trên bằng `node --import tsx --test`
(lệnh test chuẩn của repo, không phải vitest) để xác nhận số liệu, không lấy nguyên số từ mô tả task.

### Hạn chế trung thực (honesty limitations)

1. **Live tool-consumption run CHƯA chạy**: batch tool `planner_create_tasks` và
   `MS365_ORCHESTRATION_POLICY` mới chỉ có bằng chứng unit test với fake Graph/fake service —
   **chưa có một lượt nào** trong đó model thật (qua OpenCode child chạy thật, app packaged, flag
   `CGHC_MS365_ENABLED=1` ON) thực sự gọi `planner_create_tasks` hoặc đọc policy block và tự đổi
   hành vi theo write-mode. Đây là điều kiện acceptance còn mở của P5, cần **user** thực hiện với
   token thật (xem quy trình bên dưới). Kết quả (PASS/FAIL) phải được ghi lại trung thực vào
   `docs/integration/ms365-graph-api-map.md` (mục 10) và vào block này — **không được** coi P5 là
   "xong" chỉ vì unit test pass.
2. **`sharepoint_get_file_summary` allowlist gap vẫn còn** (kế thừa từ P0.5): chỉ nhận
   `driveItemId`, không có `siteId`, nên không thể check site-allowlist rẻ tiền tại chỗ — vẫn
   tracked, chưa fix trong P5.
3. **Toàn bộ endpoint Planner/Lists/Teams vẫn 🟡 CODE + UNIT, chưa live-verify**: token test hiện
   có thiếu scope consent (`Tasks.ReadWrite`, `Sites.ReadWrite.All`, 5 scope Teams) — kế thừa từ
   P2/P3/P4, không đổi trong P5.
4. Kế thừa: OpenCode child tool-consumption tổng quát (ngoài batch tool) vẫn chưa verify
   end-to-end; device-code vẫn gated chờ IT.

### Quy trình live consumption run (để user chạy — ghi lại, KHÔNG claim PASS trước)

```text
1. set CGHC_MS365_ENABLED=1 (không cần CGHC_MS365_TEST_TOKEN — connect dán token thủ công trong UI)
2. Build + chạy app packaged, connect MS365 bằng manual token (không dán token vào file/chat)
3. Prompt: "Liệt kê các plan Planner của tôi" → quan sát tool call tới /v1/ms365/tool-call
   và kết quả quay về model (log service / UI tool-call row)
4. Ghi PASS/FAIL trung thực vào docs/integration/ms365-graph-api-map.md (mục 10, quy tắc
   chuẩn: MỌI lượt test manual token đều cập nhật api-map) + current-status (block này)
```

## MS365 OpenCode plugin bridge + consumption verify (P5.5, 2026-07-14)

| Item | Status |
|---|---|
| Spec | `docs/superpowers/specs/2026-07-14-ms365-orchestration-design.md` (P5.5 addendum) |
| Plan | task-breakdown SDD (`.superpowers/sdd/task-1..5-brief.md`) |
| Branch | `feature/ms365-ui-wiring-device-code` |
| HEAD (verify pass) | `ee546fd` — feat(ms365): session gating — only MS365-tab sessions may call MS365 tools |

### Đã làm (what shipped, Task 1-3+5 trước Task 4 này)

- Gate-wait thật: `awaitGateDecision` poll `PermissionGate.isAllowed`/`pending()` — write tool chờ
  quyết định user thật thay vì trả kết quả cùng tick (deny-loop cũ đã hết).
- Token gọi tool bị scoped theo path: `CGHC_MS365_TOKEN` cấp cho OpenCode child giờ chỉ dùng được
  cho `POST /v1/ms365/tool-call` (`PathScopedToken`), không còn là token chính có thể gọi mọi route
  MS365 khác (write-mode, session-scope, connect...).
- Plugin bridge: supervisor ghi `<configDir>/plugin/ms365.ts` (25 tool, gọi `fetch` tới
  `CGHC_MS365_TOOL_ENDPOINT` với header `x-cowork-token`) + seed
  `<configDir>/node_modules/@opencode-ai/plugin` (+ `dependencies` transitive) mỗi lần launch, chỉ
  khi `CGHC_MS365_ENABLED` có mặt trong `baseEnv`.
- Session gating: chỉ sessionId đã đăng ký qua `POST /v1/ms365/session-scope` (main token) mới gọi
  được tool MS365 — session chưa đăng ký (vd. chat chính) nhận `session_not_allowed` fail-closed,
  không throw, không lộ chain nội bộ.

### Bằng chứng đã xác minh (verified) — Step 1 của Task 4, EMPIRICAL

**Verdict: ✅ PASS** — plugin nạp thành công, đủ 25/25 tool, KHÔNG cần model/tenant/provider key.

Đã spawn binary pin thật `node_modules/opencode-ai/bin/opencode.exe` (in `--version` xác nhận
`1.17.11`, khớp `OPENCODE_PIN`) bằng đúng cách supervisor làm: `serve --hostname 127.0.0.1 --port
<port>`, env `XDG_DATA_HOME=<tempDataDir>`, `OPENCODE_CONFIG_DIR=<tempConfigDir>`,
`CGHC_MS365_ENABLED=1`, `CGHC_MS365_TOOL_ENDPOINT=http://127.0.0.1:9/nowhere` (cổng chết, KHÔNG
phải service thật), `CGHC_MS365_TOKEN=dummy-not-a-secret`. Trước khi spawn, gọi thẳng
`writeOpencodeConfig`/`writeMs365Plugin`/`seedMs365PluginDeps` (code sản phẩm thật, qua
`node --import tsx`, không viết lại logic) để tái tạo đúng những gì supervisor ghi.

```text
health: GET /global/health → {"healthy":true,"version":"1.17.11"} (sẵn sàng trong ~1s)
GET /experimental/tool/ids → chứa đủ 25/25 tên trong TOOL_NAMES (sharepoint_*, ms365_list_joined_sites,
                              outlook_*, planner_*, lists_*, teams_*) — verify bằng diff tập hợp, 0 thiếu
GET /config → "plugin":["file:///<configDir>/plugin/ms365.ts"] — xác nhận OpenCode tự nạp plugin
              qua glob thư mục config (KHÔNG cần khai trong opencode.json), đúng cơ chế đã khảo cứu
              CGHC-028 (config/plugin.ts glob {plugin,plugins}/*.{ts,js})
child stderr → rỗng (không có lỗi import "@opencode-ai/plugin", không lỗi cú pháp plugin template)
POST /session → 200, tạo session thành công (môi trường serve lành mạnh, không lỗi 500 ẩn)
```

Đây là bằng chứng thực nghiệm bác bỏ hẳn nghi vấn trước đó rằng OpenCode chỉ nạp plugin qua config
`plugin` array — xác nhận đúng cơ chế glob thư mục. Đồng thời xác nhận export shape
`export const Ms365 = async () => ({ tool: {...} })` và deps đã seed
(`@ai-sdk`, `@opencode-ai/sdk`, `effect`, `zod`, ...) đủ để resolve import offline, không cần
network.

Harness là script tạm trong scratchpad (KHÔNG commit, KHÔNG phải code sản phẩm) — dùng temp dir cho
data/config, xoá sau khi chạy, không có secret thật trong bất kỳ log/env nào (chỉ chuỗi giả
`dummy-not-a-secret`).

### Hạn chế trung thực (honesty limitations)

1. **Step 2 (roundtrip qua phiên thật) CHƯA chạy trong verify này** — cần model provider key thật
   (Step 1 chủ động tránh dùng credential thật). Runbook chính xác để **user** tự chạy:
   ```text
   1. CGHC_MS365_ENABLED=1, app dev/packaged đang chạy, MS365 CHƯA connect.
   2. Ở CHAT CHÍNH (không phải tab MS365), prompt: "Hãy gọi tool ms365_list_joined_sites và cho
      tôi biết kết quả nguyên văn."
      → Kỳ vọng: {"ok":false,"error":{"kind":"session_not_allowed",...}} (chứng minh session
        gating chặn đúng — chat chính không phải session đã đăng ký).
   3. Đăng ký chính session đó: POST /v1/ms365/session-scope { sessionId, enabled: true } bằng
      MAIN TOKEN (không phải scoped child token — child token không tới được route này).
   4. Lặp lại prompt ở bước 2 → Kỳ vọng: {"ok":false,"error":{"kind":"not_connected",...}}
      (chứng minh chain plugin → scoped token → route → handler → gate connection-check hoạt
      động đúng cho tới bước cuối, chỉ dừng vì MS365 chưa connect — đúng như thiết kế).
   5. Ghi PASS/FAIL trung thực (redact mọi token) vào block này và vào api-map mục 10.
   ```
2. **Session gating nghĩa là hiện tại CHỈ session ở tab Microsoft 365 mới được gọi tool MS365** —
   chat chính (main chat) đã bị tách (detached) khỏi khả năng này. Tab MS365 chưa có ô chat riêng
   trong bản này (P5.6 sẽ thêm) — nên trên thực tế, cho tới khi P5.6 xong, **không có UI nào** để
   user tự nhiên kích hoạt một tool call MS365 hợp lệ end-to-end; Step 2 ở trên phải làm thủ công
   qua HTTP (`POST /v1/ms365/session-scope`) để mô phỏng cho tới khi P5.6 có chat thật trong tab.
3. **Hành vi mới cần user biết**: gate-wait cho write tool (`awaitGateDecision`) chờ permission
   gate, và cận trên THẬT SỰ có hiệu lực là **120s** — `DEFAULT_PERMISSION_TIMEOUT_MS` trong
   `compose-service.ts` (fail-closed: hết 120s không ai bấm Allow/Deny thì tự động coi là
   "denied"). `HARD_CAP_MS = 180_000` trong `ms365-gate-wait.ts` là một backstop không bao giờ
   chạm tới trong thực tế, vì gate 120s luôn trả quyết định (allow/deny) trước khi vòng lặp poll
   180s kịp hết hạn. Trong khoảng chờ đó, tool call HTTP tới `/v1/ms365/tool-call` block (không trả
   sớm), nên UI/model có thể trông như "treo" nếu user không thấy card kịp thời — đây là hành vi
   cố ý (fail-closed, không phải bug), nhưng cần biết khi quan sát log/latency.
   - **Giới hạn theo dõi (chưa phải bypass permission)**: nếu user bấm Allow sát mốc 120s (trùng
     với `SOCKET_IDLE_TIMEOUT_MS = 120_000` trong `http-service.ts`), có một cửa sổ hẹp trong đó
     mutation đã chạy thành công phía service nhưng socket đã bị đóng vì idle timeout, nên child
     nhận về `network_error` thay vì kết quả thật — kết quả (side effect) vẫn đúng theo quyết định
     Allow của user, chỉ là response bị mất qua socket đã đóng. Đây là một seam đã ghi nhận để theo
     dõi (follow-up), KHÔNG phải một lỗi permission bypass.
4. **~59MB node_modules seed mỗi lần launch (theo dõi perf)**: `seedMs365PluginDeps` copy
   `@opencode-ai/plugin` + toàn bộ `dependencies` transitive vào `<configDir>/node_modules` — đo
   trực tiếp kích thước từng package nguồn trong lượt verify này: `effect` **47MB** (phần lớn tổng
   size), `zod` 5.2MB, `msgpackr` 1.9MB, `yaml` 1.2MB, `fast-check` 1.4MB, `@opencode-ai/sdk` 908KB,
   `@ai-sdk` 809KB, `kubernetes-types` 858KB, còn lại các dep nhỏ (<400KB mỗi cái) — tổng ~59MB mỗi
   lần `seedMs365PluginDeps` chạy. Đây là I/O đồng bộ (`cpSync`) chạy trước mỗi lần spawn OpenCode;
   chưa đo thời gian ảnh hưởng tới cold-start latency của supervisor trên máy chậm/đĩa mạng — cần
   một pass perf riêng nếu latency start trở thành vấn đề (vd. cache seed theo hash thay vì copy lại
   mỗi lần), KHÔNG blocking cho slice này.
5. **Chưa test connected-live với tenant thật trong chuỗi plugin→tool** — Step 1 verify chỉ chứng
   minh REGISTRATION (plugin nạp, tool có tên đúng), không gọi bất kỳ Graph API thật nào qua chain
   này; live-tenant Graph call vẫn phụ thuộc scope/app-registration đã ghi ở api-map mục 9/10 và
   các block P1-P5 phía trên.

## MS365 UI wiring + device-code (D2 slice 2, 2026-07-14)

| Item | Status |
|---|---|
| Branch | `feature/ms365-ui-wiring-device-code` |
| HEAD | `1f7a0fa` — docs(integration): MS365 Azure app registration request for IT |
| IT request doc | `docs/integration/ms365-it-request.md` — app registration request để IT cấp `CGHC_MS365_CLIENT_ID` / `CGHC_MS365_TENANT` |

### Đã triển khai (what shipped)

- Nút "Kết nối Microsoft 365" (`.ms-connect__signin`) nay gọi thật `beginMs365Device()` qua service
  client — **không còn luôn `disabled`** như bản shell trung thực 2026-07-13. Mặc định (chưa cấu
  hình env) nút vẫn enable được, và khi click mà backend báo thiếu app registration, nút chuyển
  `disabled` kèm ghi chú rõ ràng `"Cần app registration — nhờ IT cấu hình CGHC_MS365_CLIENT_ID."`
  — không có trạng thái "đã kết nối" giả nào được hiển thị.
- Fallback thủ công `.ms-connect__manual` (toggle "Kết nối thủ công bằng token" → input dán token →
  submit) nối thật `connectMs365Token(token)` — **đây là đường kết nối hoạt động thật ngay hôm nay**,
  không cần chờ IT.
- View kết nối/ngắt kết nối phản ánh đúng trạng thái thật từ service (thẻ dịch vụ, scope đã cấp,
  pill trạng thái), không phải dữ liệu mock.

### Bằng chứng đã xác minh (verified)

```text
npm run build:renderer   → exit 0 PASS
npm run typecheck        → exit 0 PASS (tsc -b, toàn repo)
npm run package:win      → PASS (dist-app/win-unpacked + installer/portable exe)
node tools/verify/ui-shell-v3-production-screenshots.mjs → exit 0 PASS
```

Verifier (`tools/verify/ui-shell-v3-production-screenshots.mjs`, hàm `assertMicrosoftConnect`) đã
được mở rộng để phản ánh đúng thẻ đã nối: kiểm tra nút `.ms-connect__signin` tồn tại (chấp nhận cả
hai trạng thái trung thực — enabled mặc định, hoặc disabled kèm ghi chú app-registration nếu đã bị
click và backend từ chối), và `.ms-connect__manual` (input + nút submit token) tồn tại. Assertion
**không** khẳng định có kết nối thật hay trạng thái "đã kết nối" — chỉ khẳng định cấu trúc UI đã
nối đúng. Ảnh chụp `microsoft-connect.png` cho thấy thẻ full-width ở khu vực chính (không phải cột
sidebar hẹp), với nút "Đăng nhập với Microsoft" và "Kết nối thủ công bằng token" cùng danh sách
scope sẽ xin khi kết nối.

### Giới hạn trung thực còn lại (honesty limitations)

1. **Device-code cần IT cấp app registration**: chưa có `CGHC_MS365_CLIENT_ID` / `CGHC_MS365_TENANT`
   thật cho tenant thật — xem `docs/integration/ms365-it-request.md`. Cho tới khi IT cấp, đường
   device-code trên máy không cấu hình sẽ luôn báo lỗi thiếu app registration (đúng như thiết kế,
   không phải bug).
2. **OpenCode child tool-consumption vẫn chưa được xác minh end-to-end**: việc OpenCode runtime thật
   có đọc `CGHC_MS365_TOOL_ENDPOINT` / `CGHC_MS365_TOKEN` để đăng ký MS365 tool thành tool
   model-callable chưa được kiểm chứng qua một child đang chạy thật (kế thừa từ slice connector +
   SharePoint, chưa đổi ở slice này).
3. **Chưa có lượt chạy live-tenant nào**: toàn bộ xác minh ở mức packaged UI + unit test; chưa có
   lưu lượng Microsoft Graph thật nào (kể cả qua manual token) được thực thi trong môi trường xác
   minh này.

## MS365 tab chat — session-scope lifecycle live, pill relocated (P5.6, 2026-07-15)

| Item | Status |
|---|---|
| Spec | `docs/superpowers/specs/2026-07-15-ms365-tab-chat-design.md` |
| Plan | `.superpowers/sdd/task-1..3-brief.md` (Task 1: controller; Task 2: transcript/composer UI; Task 3: app-shell wiring — mục này) |
| Branch | `feature/ms365-ui-wiring-device-code` |

### Đã làm (what shipped, Task 3)

- Tab Microsoft 365 (`ms-assistant-view.ts`) giờ chat thật: `app-shell.ts` sở hữu một
  `MsChatController` (Task 1) sống cạnh `state.msView`, wired với các adapter thật thay vì
  stub fail-closed của Task 2:
  - `preflight` → `assessSendPreflight(buildReadinessInput(...))` — cùng luật readiness với
    chat chính (local service + workspace + provider).
  - `createSession` → `ensureLive(state, readiness)` rồi `client.createSession({workspaceId,
    title: "Microsoft 365"})` — **không** tạo conversation record (P5.6 scope, transcript
    ephemeral — xem hạn chế bên dưới).
  - `setSessionScope`/`sendMessage`/`cancelSession` → gọi thẳng `service-client` tương ứng
    (`setMs365SessionScope`, `sendSessionMessage`, `cancelSession`).
  - `startStream` → `startEvStream({baseUrl, clientToken, sessionId, onView})`, giữ một
    `EvStreamHandle` cục bộ cho tab — **không đụng** `state.stream` của chat chính, nên hai
    luồng stream hoàn toàn độc lập.
  - `buildDispatch` → `planDispatchPrompt(prior, [], prompt, undefined, [], true)` với
    `ms365Connected=true` cố định (tab NÀY là surface MS365, luôn bật orchestration policy);
    mapping transcript tab (`MsChatMessage[]`) sang `ConversationMessage[]` nằm trong adapter
    module mới `ms-chat-adapters.ts`.
  - `onStateChange` → re-render tab qua chỉ báo `msChatRerender` (chỉ khi tab Microsoft đang
    active — `renderState` chỉ gọi `renderMicrosoftSurfaceBound` khi `activeSurface ===
    "microsoft"`).
  - MS365 disconnect (nút "Ngắt kết nối" ở tab Kết nối, hoặc bất kỳ view mới nào không còn
    `connected`) → `controller.onDisconnected()` — revoke scope + dừng stream nếu đang có
    lượt chạy dở, giữ nguyên transcript.
- **Pill write-mode đã dời hẳn sang composer tab Microsoft**: instance pill mới
  (`state.msWriteModePill`, dùng lại `createMs365WriteModeControl`) chỉ truyền vào
  `MicrosoftSurfaceDeps.writeModePill` khi `msView.connectionState === "connected"`; fetch mode
  hiện tại + toggle wiring (`ms365-write-mode-toggle` → `setMs365WriteMode` → `setMode`) tái
  dùng đúng khuôn cũ. **Composer chat chính không còn pill này nữa** — gỡ instance khỏi
  `cowork-view.ts`, passthrough khỏi `create-app-frame.ts`/`CoworkViewDom`/`AppFrameDom`, và
  toggle listener cũ khỏi `app-shell.ts`.

### Bằng chứng đã xác minh (verified)

```text
npm run typecheck (app/ui)                              → exit 0 PASS
node --import tsx --test tests/ms-chat-controller.test.ts
  tests/ms-assistant-view.test.ts tests/ms365-write-mode-control.test.ts
  tests/dispatch-plan.test.ts tests/microsoft-view.test.ts               → 45/45 PASS, 0 fail
node --import tsx --test tests/*.test.ts (toàn bộ app/ui)                → 240/246 PASS
  (6 fail là lỗi PRE-EXISTING trên nhánh trước Task 3 — xác nhận bằng
  git stash + chạy lại cùng file test: ms-connect-view.test.ts thiếu
  `listMs365Sites` trên fake client [4 subtest], skills-settings-panel
  và surface-registry lệch fixture/demo-mode — không liên quan tới thay
  đổi của slice này, không sửa để tránh che giấu lỗi khác)
node --import tsx --test tests/ms365-session-scope.test.ts (service)     → 9/9 PASS, không đổi
```

### Hạn chế trung thực (honesty limitations)

1. **Transcript tab là ephemeral** — mất khi đóng app hoặc chuyển sang conversation khác trong
   chat chính; không persist vào conversation store ở P5.6. Persist là follow-up ngoài phạm vi.
2. **Mỗi lượt gửi = một OpenCode session MỚI** (ràng buộc single-turn hiện có của
   `runtime-turn-planner.ts`) — bộ nhớ giữa các lượt chỉ là transcript-context envelope trong
   prompt (có budget cắt), không phải session liên tục.
3. **Live end-to-end với model thật vẫn CHƯA được xác minh trong lần verify này** — cần
   provider key thật + flag `CGHC_MS365_ENABLED` bật + MS365 đã connect (runbook Step 2 của
   P5.5 áp dụng tương tự tại tab này). Task 3 chỉ xác minh typecheck + unit test có seam giả
   lập (fake deps) đúng thứ tự lời gọi; chưa chạy packaged verification thật với mạng.
4. **`sendMessage`/`cancelSession` không throw khi `state.client === null`** ở nhánh
   cancel/send để giữ hành vi best-effort nhất quán với `MsChatController` (revoke luôn được
   swallow lỗi mạng) — nếu service rớt kết nối giữa lượt, controller vẫn báo lỗi trung thực qua
   `createSession`/`setSessionScope`/`sendMessage` khác (những nhánh có throw), không có
   "completed" giả nào được hiển thị.

## Sửa lỗi restart-mỗi-lượt của `connectLive` (2026-07-15)

**Bug đã sửa:** trước đây `IpcChannel.ConnectLive` luôn gọi `restartService()` vô điều kiện —
tức là DỪNG rồi KHỞI ĐỘNG LẠI toàn bộ loopback service + child OpenCode trên **mỗi lượt chat**
(cả tab cowork chính lẫn tab MS365), vì `ensureLive`/`ensureRuntimeSession` (tab chính) và
`createMsChatDeps.createSession` (tab MS365) đều gọi `connectLive()` mỗi lần gửi tin nhắn. Hệ quả:
mỗi lượt tốn thêm ~2.5-3s (đo từ `service-lifecycle.log`), và vì service bị dừng/khởi động lại nên
token MS365 thủ công (giữ in-memory do giới hạn kích thước Windows keyring) cùng session-scope
MS365 bị xoá — tab MS365 hỏng ngay ở lượt kế tiếp.

**Đã sửa:** `ServiceController` (`app/shell/src/service/service-controller.ts`) giờ theo dõi
tier đang chạy (`settings_only` | `live`) qua getter `runningTier`, dựa trên field `tier` optional
trên `StartedService` — cả `createSettingsOnlyStartService` và `toStartedService` (live adapter)
đều gắn tag trung thực để một fallback từ live xuống settings-only KHÔNG BAO GIỜ tự nhận là live.
IPC `connectLive` giờ nhận tham số optional `{ force?: boolean }`
(`app/shell/src/service/connect-live.ts`, wired qua `register-handlers.ts` + `main.ts`): nếu
service ĐANG chạy tier `live` và không `force`, trả `{ restarted: false }` ngay — không dừng/khởi
động lại, không mất state in-memory. Renderer (`app/ui/src/app-shell.ts`) thêm cờ
`state.liveConfigDirty`, bật lên khi người dùng đổi provider/model/credential
(`onSettingsUpdated`) hoặc đổi workspace (`onActivated`) — vì `compose-live.ts` bake cả provider
lẫn workspace-root vào service đang chạy tại thời điểm start (`grantWorkspace({ rootPath:
workspaceId })`, một grant cho cả vòng đời service, không phải per-request) — nên đổi 1 trong 2
thứ đó trong lúc đang live PHẢI force reconnect thì thay đổi mới có hiệu lực. `ensureLive` truyền
`{ force: true }` đúng khi cờ bật, và xoá cờ sau khi reconnect thành công.

### Bằng chứng đã xác minh (verified)

- `app/shell/tests/service-controller.test.ts` — `runningTier` phản ánh đúng tier kể cả khi
  fallback bị gắn tag trung thực; reset về `null` sau `stop()`/start thất bại.
- `app/shell/tests/connect-live.test.ts` — already-live + no force → `{restarted:false}`, KHÔNG
  gọi `stop`/`startLive`; force:true → luôn restart; settings-only đang chạy → vẫn restart lên
  live (giữ nguyên transition onboarding cũ).
- `app/shell/tests/tiered-start-service.test.ts` — tag tier sống sót qua fallback live→settings-only.
- `app/ui/tests/live-config-dirty.test.ts` + `app/ui/tests/ms-chat-controller.test.ts` (regression,
  17/17 pass) — cờ dirty quyết định đúng tham số `force` và được xoá sau khi connect.
- `npm run typecheck` — pass (root `tsc -b`).

### Giới hạn trung thực (honesty limitations)

- Chưa chạy packaged live verification đo lại thời gian thực tế của từng lượt (chỉ có bằng
  chứng đơn vị + lifecycle-log cũ chứng minh vấn đề); nên đo lại `service-lifecycle.log` trong
  lần verify đóng gói kế tiếp để xác nhận số liệu ~2.5-3s/lượt đã biến mất.
- `session-panel.ts` (một panel demo cũ tách biệt khỏi `app-shell.ts`) vẫn gọi
  `connectLive()` không tham số — vẫn hợp lệ (tham số optional) và không được đưa vào phạm vi cờ
  dirty vì nó không dùng `AppState`.

## SSRF boot-lockout hardening + `CGHC_SSRF_ALLOW_PRIVATE_PROVIDER` opt-in (2026-07-15)

**Bối cảnh:** commit 68d5109 đã sửa để service (Tier 1) sống sót khi một `base_url` provider đã
lưu không còn qua được SSRF policy lúc boot (ví dụ mạng công ty FPT dùng split-horizon DNS khiến
`mkp-api.fptcloud.com` resolve ra IP nội bộ `192.168.11.1` sau khi đổi mạng). Một review bảo mật
độc lập (verdict APPROVE WITH FIXES) tìm thêm 4 follow-up; PO đã duyệt (2026-07-15) một cờ opt-in
tường minh, mặc định TẮT, để cho phép endpoint provider trỏ vào mạng nội bộ khi người dùng chủ
động bật.

**Phần 1 — sửa các follow-up của review bảo mật:**
- **Packaged live-boot lockout:** shell (`app/shell/src/service/tiered-start-service.ts`) trước
  đây RETHROW `SsrfBlockedError` từ `buildLiveCoworkOptions` — nghĩa là app đóng gói không khởi
  động được service NÀO cả (kể cả settings-only), khoá luôn màn hình Settings. Đã thêm
  `SsrfBlockedError` vào danh sách fallback: rơi về settings-only (fail-closed — không spawn
  child, không giữ endpoint chưa xác thực).
- **Thu hẹp 2 bare catch:** `service/src/composition/compose-service.ts` (`syncActiveProfile` và
  `seedFromSettings`) giờ chỉ bắt đúng `SsrfBlockedError` (`if (!(err instanceof
  SsrfBlockedError)) throw err;`) — lỗi khác vẫn làm boot thất bại trung thực thay vì bị nuốt.
- **Log cảnh báo đã redact:** mỗi catch site log một dòng `console.warn` chỉ chứa lý do +
  hostname/IP bị từ chối (không secret) — ví dụ `[boot] provider endpoint skipped: ...`.
- **Test + wording:** thêm test boot cho đường `syncActiveProfile` (active profile với base_url
  resolve về IP nội bộ); sửa lại tiêu đề/comment của test FIX-5.4 — bất biến đúng là "một
  base_url đã lưu không bao giờ được nạp CHƯA XÁC THỰC" (không phải "không bao giờ được nạp" —
  một URL lưu sẵn mà PASS SSRF thì VẪN được tự nạp).

**Phần 2 — opt-in mạng nội bộ cho endpoint provider (mặc định TẮT):**
- Cờ môi trường mới: `CGHC_SSRF_ALLOW_PRIVATE_PROVIDER` (đọc qua
  `isPrivateProviderAllowed(process.env)` trong `service/src/provider/ssrf-policy.ts`) — chỉ ON
  khi giá trị đúng bằng `"1"` hoặc `"true"`, mọi giá trị khác (kể cả không đặt) đều OFF, giống
  style `isMs365Enabled`.
- **Phạm vi: CHỈ endpoint provider.** `SsrfPolicyOptions.allowPrivateNetwork` khi `true` chỉ nới
  lỏng class IP `private` (RFC-1918) — `loopback` (trừ khi `loopbackEscape` bật riêng),
  `link_local`, và `cloud_metadata` vẫn bị chặn tuyệt đối; yêu cầu `https` không đổi.
  `compose-service.ts` dựng MỘT policy `ssrf` (strict, dùng cho MS365 Graph client, device-code
  provider, và extension/MCP registry) và MỘT policy `providerSsrf` riêng (đọc cờ trên, dùng cho
  `createProviderPort`/`createHttpConnectorBundle`). `provider-connection-tester.ts` (test-connection
  cho provider profiles) và `live-launch.ts` (`buildLiveCoworkOptions`, validate base_url custom
  trước khi spawn) cũng được truyền cùng cờ này — vì cả hai đều là đường endpoint-provider.
- **Lý do:** mạng nội bộ FPT dùng split-horizon DNS khiến hostname provider công ty resolve ra IP
  RFC-1918 — nếu không có cờ này, người dùng trên mạng đó không thể dùng provider nội bộ dù đã
  cấu hình đúng. PO quyết định 2026-07-15: chấp nhận rủi ro này CHỈ khi người dùng chủ động bật
  cờ môi trường (không phải mặc định, không phải qua UI/body request).

### Bằng chứng đã xác minh (verified)

- `service/tests/provider-ssrf.test.ts` — `isPrivateProviderAllowed` on/off; `allowPrivateNetwork`
  cho phép `private` nhưng vẫn chặn `link_local`/`cloud_metadata`/loopback/http.
- `service/tests/composition-ssot-and-redaction.test.ts` — boot sống sót qua cả 2 đường
  (`seedFromSettings` và `syncActiveProfile`) khi base_url đã lưu resolve về IP nội bộ; test cờ
  env bật → base_url nội bộ ĐƯỢC seed vào port lúc boot.
- `app/shell/tests/tiered-start-service.test.ts` — `SsrfBlockedError` fallback về settings-only
  vô điều kiện (không cần `fallbackOnLiveSpawnFailure`).
- `npm run typecheck` (root `tsc -b`) — pass.

### Giới hạn trung thực (honesty limitations)

- Chưa chạy packaged live verification trên mạng FPT thật để xác nhận cờ giải quyết đúng sự cố
  gốc (192.168.11.1) end-to-end — mới có bằng chứng unit/composition-level với DNS resolver giả.
- Cờ là toàn-cục cho cả process (không theo từng profile) — nếu người dùng có cả provider công
  khai lẫn provider nội bộ, TẤT CẢ provider endpoint đều được nới lỏng khi cờ bật.

## Microsoft 365 & Claude Code surfaces (2026-07-13)

| Item | Status |
|---|---|
| Spec | `docs/superpowers/specs/2026-07-13-microsoft-claudecode-surfaces-design.md` |
| Plan | `docs/superpowers/plans/2026-07-13-microsoft-claudecode-surfaces.md` |
| Branch | `feature/ms365-claudecode-surfaces` |
| Microsoft 365 surface | **Đã nối backend (D2 UI wiring slice, xem mục bên dưới)** — rail nút `microsoft` mở `section.ms-surface` với segmented "Trợ lý AI" / "Kết nối"; nút đăng nhập `.ms-connect__signin` gọi thật backend device-code, và có fallback `.ms-connect__manual` nối thật manual-token connect. *(Ghi chú lịch sử: bản đầu 2026-07-13 render shell disconnect trung thực với nút luôn `disabled`; đã được thay bằng slice wiring 2026-07-14 bên dưới — mục này giữ lại làm log, không còn phản ánh trạng thái hiện tại.)* |
| Claude Code surface | **Complete (3-column, shared session)** — rail nút `code` mở `section.cc-surface` với `code-explorer` (tree + SOURCE CONTROL thật), `code-editor` (chỉ đọc + diff review), `cc-panel` (dùng chung phiên hội thoại với Cowork); segmented "Phiên làm việc" / "Cách hoạt động" chuyển sang `cc-onboarding` với 4 bước |
| Not included (tại thời điểm 2026-07-13) | *(lịch sử)* Không có backend D2 (Microsoft Graph) thật; editor Claude Code không ghi tệp; không có nút accept/reject trên diff (theo đúng spec — chỉ xem lại). MS365 auth nay đã nối thật (xem slice UI wiring 2026-07-14 bên dưới); phần Claude Code (editor không ghi tệp, không accept/reject) vẫn đúng như cũ. |
| Packaged evidence | `reports/ui-shell-v3-commercial-readiness/` — `microsoft-assistant.png`, `microsoft-connect.png`, `code-session.png`, `code-onboarding.png` + `structural-state-check.json` |
| Verification commands | `scripts\build.bat` → `node tools/verify/ui-shell-v3-production-screenshots.mjs` (exit 0) → `scripts\stop.bat` |

Trong lúc bổ sung 4 capture mới, phát hiện một lỗi có sẵn trong assertion của verifier
(`tools/verify/ui-shell-v3-production-screenshots.mjs`): hai điều kiện kiểm tra
"cowork mode phải chỉ hiện view cowork" / "workspace mode phải chỉ hiện view workspace"
thiếu guard `!settingsOpen`, nên khi Settings đang mở thì assertion tự fail sai. Đã sửa
bằng cách thêm `!settingsOpen &&` vào cả hai điều kiện, giữ nguyên các điều kiện lân cận
vốn đã có guard này — không nới lỏng assertion, chỉ sửa đúng lỗi logic khiến kết quả false
negative.

## UI Shell V3 commercial readiness remediation (2026-07-13)

| Item | Status |
|---|---|
| Independent audit branch | `audit/ui-shell-v3-commercial-readiness` |
| Audit commit | `ecce634` — `docs(quality): audit V3 commercial UI readiness` |
| Remediation branch | `fix/ui-shell-v3-commercial-readiness` |
| Audit verdict before fix | **PASS WITH BOUNDED FIXES** — commercial merge blocked by UI-CR-001 through UI-CR-005 |
| Commercial readiness pass | **Code implemented; packaged evidence refresh pending** — Settings is now a full-screen application surface; workspace tree gap, provider untested status color, rail tooltip clipping, and composer alignment are remediated |
| Packaged evidence | `reports/ui-shell-v3-commercial-readiness/` exists, but final refresh after the last Settings/tooltip fixes is still pending packaged GUI smoke |
| Product Owner visual acceptance | **Pending** — do not claim final PASS until PO reviews the commercial-readiness screenshots |
| D1-D4 merge | **Not started** — integration surfaces remain passive slots |
| Multi-Provider Profiles | **Not implemented** |
| File Work Review | **PARTIAL PASS** (unchanged) |
| Full L9 / RC | **Not complete** |

Settings is no longer a backdrop modal. The topbar Settings icon opens a full-screen surface inside the V3 application frame, below the native titlebar/topbar and above the status bar, with internal navigation for **Nhà cung cấp** and **Chung**.

## UI Shell V3 production alignment (2026-07-13)

| Item | Status |
|---|---|
| Design prototype R3 (PO-approved direction) | **Complete** — `d96f205` on `design/ui-shell-v3-prototype` |
| Rejected production port | `794cb00` on `feature/ui-shell-v3-production` — PO rejected visual acceptance because packaged UI still looked like the old shell |
| Alignment branch | `fix/ui-shell-v3-production-alignment` |
| V3 shell in packaged renderer | **Aligned** — V3 frame/component composition replaces the legacy shell composition; `app-shell.ts` remains orchestration/state wiring |
| Major V3 composition | **Approved** — Product Owner accepted the replacement composition after R2 evidence |
| Product chrome / UX completion pass | **Applied** — global Settings restored, native Windows controls retained, provider status semantics clarified, rail/tooltips/composer/discoverability polished |
| Commercial UI Product Owner visual acceptance | **Pending** — awaiting review of `reports/ui-shell-v3-production-r3/` |
| D1–D4 merge | **Not started** — integration surfaces remain `awaiting_integration` |
| Multi-Provider Profiles | **Not implemented** — provider/model control opens existing Settings; no multi-profile dropdown registry |
| File Work Review | **PARTIAL PASS** (unchanged) |
| Full external integration regression | **Deferred** to integration milestone |

Production evidence: `reports/ui-shell-v3-production-r3/` (product chrome/UX screenshots + structural state JSON). R2 remains historical alignment evidence. Regenerate:

```powershell
scripts\build.bat
node tools/verify/ui-shell-v3-production-screenshots.mjs
scripts\stop.bat
```

Design spec: [UI Shell V3 Spec](./ui-shell-v3-spec.md). Prototype reference: `design/ui-shell-v3/`, R3 evidence `reports/ui-shell-v3-r3/`. Prior rejected evidence remains in `reports/ui-shell-v3-production/`.

## Pre-merge stabilization (2026-07-13)

| Item | Status |
|---|---|
| Comprehensive project audit | **Complete** — [audit report](../quality/cowork-ghc-comprehensive-project-audit.md) |
| Commercial UI Product Owner acceptance | **FAIL** — collapsed layout and polish gaps identified before stabilization |
| Pre-merge stabilization | **Applied** — dead verifiers removed, File Review CLI consolidated, shell layout collapse fixes |
| File Work Review | **PARTIAL PASS** — live Journey A–B PASS; Journey C blocked; D–L not completed |
| D1–D4 external integration | **Not merged** — surfaces remain `awaiting_integration` slots only |
| Next milestone | **External integration intake** (D1–D4 merge) — [readiness doc](../integration/external-systems-integration-readiness.md) |
| Architecture refactor (`app-shell.ts`, snapshot/watchdog to service) | **Deferred** until after combined external integration merge |
| Full regression at integration milestone | Planned after D1–D4 code lands |

Baseline commit: `eaeb3eb` — chore(project): stabilize pre-integration baseline

Baseline tag (local, not pushed): `pre-external-integration-2026-07-14`

Canonical intake doc: [External Systems Integration Readiness](../integration/external-systems-integration-readiness.md)

## External integration intake (next milestone)

| Item | Status |
|---|---|
| Baseline commit / tag | **Ready** — `eaeb3eb` / `pre-external-integration-2026-07-14` |
| Next milestone | **External integration intake** (D1–D4) |
| Architecture refactor | **Deferred** until after **combined** external integration merge |
| File Work Review | **PARTIAL PASS** (unchanged) |
| Commercial UI acceptance | **FAIL** (unchanged) |

## Latest Verified Slice

| Field | Value |
|---|---|
| Slice | Integration-Ready UI Shell Foundation |
| Feature commit | `0746112` — feat(ui): establish integration-ready Cowork shell |
| Hardening commits | `fix(files): harden packaged file review capture`; `test(verify): stabilize packaged file review stages`; `fix(files): canonicalize workspace paths in service`; `test(verify): add deterministic file review gateway` |
| Implementation Agent | Cursor |
| Packaged File Review | **PARTIAL PASS** — live Journey A–B PASS; Journey C blocked; D–L not completed in latest run |
| Regression | Latest UI shell foundation: targeted UI tests PASS; `npm run typecheck` PASS; `npm run build:renderer` PASS; `npm run verify:release` PASS. |
| Prior slices still PASS | Skills Foundation A–J; Provider Readiness A–J; Attachment Honesty A–J |

## Latest Verified Slice Commits (prior)

| Commit | Meaning |
|---|---|
| `1604761` | Skills packaged disable/deny recovery strengthened. |
| `97f53bf` | Skills Foundation feature. |
| `4f1e804` | Docs: provider readiness slice record. |
| `3cc4ba6` | Attachment honesty + secret-file safety. |

## Product State

Cowork GHC is a packaged Windows desktop POC (`poc-v0.1`). It is local-first,
workspace-centered, uses OpenCode as the current agent runtime, and supports a
replaceable LLM endpoint. DeepSeek is the current provider used for testing; it is not
a permanent product dependency.

Daily source of truth is Git plus active docs in `docs/product/`, `docs/quality/`,
`docs/architecture/`, and `AGENTS.md`. `.loop-engineer/` is maintenance-only provenance.

## Reference analysis pass

Git/docs reference analysis is complete. Two reference reports were added:

- [CoworkLocalallOS_3 Capability Audit](../references/coworklocalallos3-capability-audit.md)
- [Cowork Frontend Design Assessment](../references/cowork-frontend-design-assessment.md)

D1-D4 have been mapped into the canonical product plan as external parallel tracks:

- D1: Dispatch / fan-out agent.
- D2: Microsoft automation: Teams, SharePoint, OneDrive, Graph.
- D3: Knowledge system: RAG, vector, graph.
- D4: Advanced LLM gateway: key pool, rotation, load balance, failover, cost routing.

Cowork GHC does not currently implement D1-D4. The frontend PDF has been assessed as
design reference only; the active shell direction is now hybrid `1a Airy + 1b rail`:
56px product rail, contextual Cowork sidebar, main chat workspace, and right information
panel. Dispatch, Gateway, Knowledge, Knowledge Graph, and Microsoft 365 are visible
registry-defined integration slots in `awaiting_integration` state only; Code is planned.
They do not show mock provider, task, graph, Microsoft, cost, or RAG data.

## Verified Baseline

- Local service lifecycle, workspace selection, provider/model settings, Windows keyring,
  OpenCode runtime, streaming, permissions, cancellation, provider recovery, and process
  cleanup have packaged POC evidence.
- Conversation persistence, multi-conversation sidebar, search, switch, rename/delete,
  relaunch restore, and linked multi-turn Cowork conversations have packaged/automated evidence.
- Context isolation is verified for new turns: bounded untrusted internal envelopes are not
  persisted or displayed as assistant output.
- Activity timeline, file-change panel, permission history, and bounded text file preview exist.
- **File Work Review**: service-owned bounded snapshot capture, deterministic unified diff,
  persisted review artifacts on conversation activity, attachment vs runtime-read separation,
  secret-like path redaction in review, hash-mismatch banner for stale historical snapshots,
  and activity-panel review surface (no universal Preview tab, no direct editor).
- Attachment Phase 1 plus honesty slice: workspace text files, dispatch preflight fail-fast,
  explicit inclusion metadata, secret-like filename blocking before read, activity wording
  `Đã đưa tệp vào ngữ cảnh`, and no raw attachment content in transcript.
- Provider readiness and Skills Foundation Phase 1 remain as previously verified.

## File Work Review Slice

### What shipped

- **Taxonomy**: `attachment_context`, `runtime_file_read`, `file_created`, `file_modified`,
  `file_deleted`, plus permission history outcomes; Vietnamese past-tense labels for terminal events.
- **Snapshots**: before/after capture at mutation time with SHA-256 hash, size, mtime, truncation flags.
- **Diff**: deterministic line-based unified diff with CRLF/LF normalization; binary metadata-only path.
- **Persistence**: `fileReviews` array on persisted activity snapshot survives relaunch.
- **Secret policy**: reuses `isSecretLikeAttachmentPath`; review shows
  `Nội dung bị ẩn vì file có thể chứa credential hoặc secret.` without raw content.
- **Skills**: file events inherit turn Skill provenance via existing turn metadata; Skills do not bypass permission.
- **UI**: activity right panel review (`Xem lại thay đổi`), copy relative path; open-file deferred.

### Packaged live verification (latest rerun)

```text
File Work Review: PARTIAL PASS
Live Journey A: PASS
Live Journey B: PASS
Journey C: blocked by nondeterministic model/tool selection
Journeys D–L: not completed in the latest run
```

Evidence artifact (best full run): `%TEMP%\cghc-freview-artifacts-ubFNmc`
