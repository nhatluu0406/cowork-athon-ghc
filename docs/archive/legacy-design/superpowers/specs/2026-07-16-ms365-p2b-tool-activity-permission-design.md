---
language: "vi"
status: "draft"
created_at: "2026-07-16"
topic: "P2-B — Tool-activity display + permission cards cho tab MS365"
---

# Thiết kế: P2-B — Tool-activity display + permission cards (tab MS365)

## 1. Mục tiêu & phạm vi

Cho tab MS365 hiển thị agent đang/đã gọi tool MS365 nào (**tool-activity, read-only**) và
**phê duyệt write-tool ngay tại tab** (permission cards hoạt động end-to-end). Đây là phần khiến
write-tool (`teams_post_message`, `planner_create_task`, `sharepoint_upload_file`…) dùng được — hiện
tại request phê duyệt của chúng không có surface đúng trong tab MS365.

### Phát hiện định hình scope (đã xác minh trong code)

1. MS365 write-tool **đã** submit permission request vào đúng `PermissionGate` chung mà Cowork dùng
   (`service/src/ms365/ms365-tools.ts` gọi `createPermissionRequest` + `gate.submit`).
2. `PendingPermissionView` (`app/ui/src/permission-client.ts:25`) **đã có `sessionId`** → lọc theo
   session KHÔNG cần đổi contract.
3. `PermissionController.refresh()` (`app/ui/src/permission-controller.ts`) poll
   `listPendingPermissions()` **toàn cục** và hiện HEAD bất kể session. Controller Cowork (đang chạy,
   `app-shell.ts` ~line 2590) vì thế sẽ **pop nhầm** request MS365 theo `permissionMode` của Cowork —
   sai surface, có thể auto-approve/auto-deny sai. Đây là **bug thật**, không chỉ thẩm mỹ.
4. Stream MS365 (`app-shell.ts` `createMs365Chat`, `startEvStream`) đã có callback `onEvent?` +
   `view.toolCalls`; `buildActivitySnapshot` (`app/ui/src/activity-model.ts`) đã fold `tool_call` events
   thành `ActivityItem[]` với trạng thái pending/running/success/failed. Hiển thị chỉ là thêm render.

P2-B gồm hai phần liên quan chặt (cùng đụng permission surface + MS365 transcript) → **một spec**:
- **B1 — Permission cards hoạt động (đồng thời fix bug #3)**: lọc request theo session cho cả hai
  controller; MS365 tab có controller riêng để phê duyệt write-tool tại tab.
- **B2 — Tool-activity display (read-only)**: hiển thị nhãn tool MS365 đang/đã chạy trong transcript.

### Trong phạm vi (tầng UI, tái dùng backend/gate/contract có sẵn)
- `permission-controller.ts`: thêm option `sessionFilter?: (sessionId: string) => boolean`
  (mặc định nhận-tất-cả → Cowork behavior KHÔNG đổi nếu không truyền).
- `app-shell.ts`:
  - (a) truyền `sessionFilter` cho controller Cowork = chỉ session Cowork.
  - (b) tạo controller MS365 riêng: filter = session hiện tại của `ms365Chat`, `getMode` cố định
    `"ask"`, vòng đời start/stop bám connect/disconnect, pause/resume bám settings→live restart.
  - (c) gom `onEvent` MS365 → `buildActivitySnapshot` → render strip tool-activity trong transcript.
- Helper nhãn MS365 (`ms365ToolLabel`) ở tầng render app/ui — KHÔNG sửa `activity-model.ts`.
- `ms-assistant-view.ts` / `renderMs365Transcript`: khối tool-activity trong transcript.

### Ngoài phạm vi (YAGNI / ràng buộc)
- Đổi contract/backend/router/gate/session-scope.
- Persist tool-activity/EV vào lịch sử (bất biến CLAUDE.md: **không persist raw SSE/token deltas**);
  tool-activity chỉ hiện cho lượt **live**, cuộc cũ mở lại KHÔNG có strip.
- Dump args thô của tool (KQL mail query, tên site, nội dung Teams) ra UI — chỉ nhãn + tên tool.
- UI chọn permission mode cho MS365 (luôn `"ask"`).
- Chi tiết arg trong permission modal (dùng `action.description` non-secret sẵn có).

## 2. Quyết định thiết kế (đã chốt với PO)

| Chủ đề | Quyết định |
|---|---|
| Scope | B1 permission + B2 tool-activity trong một spec |
| Fix bug controller Cowork pop nhầm | CÓ — thêm `sessionFilter` cho cả hai controller trong P2-B |
| Lọc request | Client-side `sessionFilter` (contract đã có `sessionId`, không đổi) |
| Mode MS365 | Cố định `"ask"` — write qua Graph luôn cần phê duyệt (đúng hint composer) |
| Nhãn tool MS365 | Map ở tầng render app/ui (`ms365ToolLabel`), giữ `activity-model.ts` thuần Cowork |
| Phạm vi tool-activity | Chỉ lượt live; cuộc cũ không có strip (không persist EV) |
| Mức chi tiết strip | Chỉ nhãn + tên tool, KHÔNG dump args thô |

## 3. Kiến trúc

```
                 ┌───────────────── PermissionGate (chung, backend) ─────────────────┐
                 │   pending: [ {sessionId: cowork-s1,…}, {sessionId: ms365-s7,…} ]   │
                 └───────────────────────────────────────────────────────────────────┘
                          ▲ listPendingPermissions() (toàn cục)      ▲
         sessionFilter =  │ sid===state.streamSessionId              │ sessionFilter = sid===ms365Chat.runtimeSessionId
                          │ getMode = state.permissionMode           │ getMode = ()=>"ask"
                 ┌────────┴─────────┐                        ┌───────┴──────────┐
                 │ Cowork controller│                        │ MS365 controller │  (mới)
                 │  (đã có, ~2590)  │                        │  start/stop theo │
                 └──────────────────┘                        │  connect/disc.   │
                                                             └──────────────────┘
Tab "Trợ lý AI" MS365 (khi connected):
 transcript:  [bubble user] [strip tool-activity live] [bubble assistant streaming]
              strip ← buildActivitySnapshot(ms365Events).items.filter(kind==="tool")  → ms365ToolLabel
```

**Thành phần chạm (đều app/ui):**
- `permission-controller.ts`: `PermissionControllerDeps.sessionFilter?: (sessionId: string) => boolean`.
  Trong `refresh()`: `const scoped = sessionFilter ? pending.filter(p => sessionFilter(p.sessionId)) : pending;`
  rồi `head = scoped[0]`, `waiting = scoped.length - 1`. Mặc định không truyền = giữ nguyên hành vi cũ.
- `app-shell.ts`:
  - Controller Cowork: thêm `sessionFilter: (sid) => sid === state.streamSessionId`.
  - Controller MS365 (mới), tạo cùng chỗ live-bootstrap: `client: dynamicClient`, `container: dom.root`,
    `pollIntervalMs: 100`, `sessionFilter: (sid) => sid === ms365Chat.runtimeSessionId`,
    `getMode: () => "ask"`, `onPending/onDecision` cập nhật `state.ms365PermissionHistory`.
    Hook `ms365PermissionPausePoll/ResumePoll/RefreshNow` song song với Cowork.
  - State mới: `ms365Events: EvEvent[]`, `ms365PermissionHistory: PermissionHistoryEntry[]`.
  - Stream MS365 `onEvent: (ev) => { state.ms365Events = mergeEvEvents(state.ms365Events, [ev]); }`.
- Helper `ms365ToolLabel(toolName, done): string` (app/ui) — map các tool tiêu biểu sang tiếng Việt;
  tool lạ → fallback "Đang/Đã dùng công cụ: <toolName>".
- `renderMs365Transcript`: dựng snapshot từ `ms365Events`, lọc `kind==="tool"`, render strip
  (dùng `ms365ToolLabel` thay nhãn Cowork mặc định), đặt trước bubble assistant đang stream.

**Không đụng:** backend, router, gate, session-scope, contract, connector, Cowork sidebar/transcript.

## 4. Data flow

### B1 — Permission (đóng bug + phê duyệt tại MS365)
```
Agent MS365 gọi write-tool → ms365-tools.ts createPermissionRequest → gate.submit (pending)
Poll (mỗi controller, 100ms):
  Cowork:  listPending → filter sid===streamSessionId          → KHÔNG khớp request MS365 → bỏ qua
  MS365:   listPending → filter sid===ms365Chat.runtimeSessionId → khớp → head → modal (getMode "ask")
User Allow/Deny (tab MS365) → decidePermission(requestId,…) → gate resolve → tool tiếp tục/bị chặn
onPending/onDecision → cập nhật state.ms365PermissionHistory → render transcript
```
Race "chưa có session": trước khi `ensureSession` gán `runtimeSessionId`, filter trả false cho mọi
request → an toàn (không pop sớm); poll kế tiếp bắt được khi session sống.

### B2 — Tool-activity (read-only, live-only)
```
Stream MS365 onEvent(ev) → ms365Events = mergeEvEvents(ms365Events,[ev])
renderMs365Transcript:
  snap = buildActivitySnapshot(ms365Events, workspace, [])
  toolItems = snap.items.filter(i => i.kind === "tool")
  strip: mỗi item → ms365ToolLabel(item.toolName, item.status==="success") + icon theo status
         (KHÔNG render item.summary thô)
Reset ms365Events=[] khi: new / select / adopt / resetConversation.
Cuộc cũ mở lại: ms365Events rỗng → không strip (không có lịch sử EV — đúng bất biến).
```

## 5. Error handling

| Tình huống | Xử lý |
|---|---|
| Poll lỗi (MS365 controller) | Backoff + transport-note sẵn có của controller; không crash tab. |
| decidePermission lỗi | `lastError` sẵn có giữ note recovery khi modal re-open (không đổi). |
| Session MS365 đổi khi có request treo | Filter đọc `runtimeSessionId` lúc poll → request session cũ rớt khỏi head, không pop lại. |
| Cả Cowork lẫn MS365 cùng pending | Mỗi controller lọc session riêng → không double-pop cùng một request. |
| Disconnect MS365 khi có pending | `stop()` controller MS365 → đóng modal + ngừng poll; request treo timeout server-side. |
| tool_call event nhưng chưa có bubble | Strip render độc lập; `ms365Events` rỗng → không strip (honest idle). |
| Mở cuộc cũ | `ms365Events=[]` → không strip (chủ ý). |
| Tool lạ (không trong map) | `ms365ToolLabel` fallback "Đang/Đã dùng công cụ: <toolName>". |

## 6. Testing

1. **sessionFilter** — controller có `sessionFilter` bỏ qua request session khác; head = request khớp;
   không truyền filter → nhận tất cả (Cowork cũ không đổi).
2. **MS365 always-ask** — `getMode:()=>"ask"` → write-tool request hiện modal (KHÔNG auto-approve dù
   Cowork đang `workspace_auto`/`read_only`).
3. **Cowork không pop request MS365** — hai request (1 Cowork, 1 MS365) → controller Cowork chỉ hiện
   request Cowork; controller MS365 chỉ hiện request MS365.
4. **Decision** — Allow/Deny MS365 request → `decidePermission` gọi đúng requestId; history cập nhật.
5. **Tool-activity fold** — `onEvent` gom `tool_call` (running→completed) → snapshot → strip hiện nhãn
   MS365 đúng trạng thái; `ms365ToolLabel` map đúng vài tool tiêu biểu; tool lạ → fallback.
6. **Reset events** — new/select/adopt → `ms365Events=[]` → strip trống.
7. **Không dump args** — strip KHÔNG chứa `tool_call.summary` thô (chỉ nhãn + tên tool).
8. **Regression** — `npm run typecheck`, `npm test` (baseline: chỉ pre-existing fail),
   `scripts\verify-fast.bat`. Packaged: connect → yêu cầu ghi (đăng Teams / tạo Planner task) → thấy
   strip "Đang…" + thẻ phê duyệt TẠI tab MS365 → Allow → thực thi; Cowork tab KHÔNG bị pop.

## 7. Bảo mật & review

- Không đụng contract/backend/router/gate. Filter + render thuần client-side.
- Modal chỉ hiển thị `action.description` (đã non-secret theo contract) + nhãn tool; không args thô.
- Strip chỉ nhãn + tên tool; không dump KQL/nội dung/tên tài nguyên (tránh lộ lên UI/screenshot).
- Không persist EV/tool-activity (đúng bất biến "chỉ persist message + durable summary").
- **Chạm permission surface (an ninh)** → theo CLAUDE.md nên có independent review ở whole-branch.
