# MS365 P2-B: Tool-activity display + working permission cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho tab MS365 phê duyệt write-tool ngay tại tab (permission cards) và hiển thị nhãn tool MS365 đang/đã chạy trong transcript (tool-activity, read-only) — đồng thời đóng bug controller Cowork pop nhầm request MS365.

**Architecture:** UI-only. `PermissionController` nhận thêm `sessionFilter` (client-side, contract `sessionId` đã có sẵn). Controller Cowork lọc session Cowork; một controller MS365 mới lọc session MS365 hiện tại, mode cố định `"ask"`. Tool-activity gom qua `onEvent` của stream MS365 → `buildActivitySnapshot` → strip nhãn tiếng Việt (`ms365ToolLabel`), chỉ cho lượt live.

**Tech Stack:** TypeScript, DOM thuần (`el` helper), `node --test` qua `tsx`. Không framework.

## Global Constraints

- Không đổi contract, backend, router, gate, session-scope, connector. Chỉ file trong `app/ui/src`.
- KHÔNG persist EV/tool-activity (bất biến CLAUDE.md: chỉ persist message + durable summary, không raw SSE). Tool-activity chỉ hiện cho lượt live; cuộc cũ mở lại KHÔNG có strip.
- Strip chỉ hiển thị **nhãn + tên tool**, KHÔNG dump `tool_call.summary` thô (tránh lộ KQL/nội dung/tên tài nguyên lên UI/screenshot).
- Permission mode của MS365 cố định `"ask"` — KHÔNG theo `state.permissionMode` của Cowork.
- `sessionFilter` mặc định (không truyền) = nhận-tất-cả → hành vi Cowork cũ KHÔNG đổi.
- Gate xác thực = không NEW failure ở file chạm; baseline `npm test` có sẵn pre-existing fail + `Merge/` glob noise — bỏ qua.
- Không push. Commit trên `main` theo consent của user.

---

### Task 1: `sessionFilter` cho PermissionController

**Files:**
- Modify: `app/ui/src/permission-controller.ts` (thêm field `sessionFilter` vào `PermissionControllerDeps`; áp trong `refresh()`)
- Test: `app/ui/tests/permission-controller.test.ts` (nếu chưa có, tạo mới; nếu có, thêm case)

**Interfaces:**
- Consumes: `PermissionControllerDeps` (đã có), `PendingPermissionView` (đã có `sessionId: string`).
- Produces: `PermissionControllerDeps.sessionFilter?: (sessionId: string) => boolean`. Khi truyền, `refresh()` chỉ xét các request `p` thỏa `sessionFilter(p.sessionId)`; head/queue-count tính trên tập đã lọc. Không truyền → hành vi cũ (nhận tất cả).

- [ ] **Step 1: Viết test thất bại**

Tạo/bổ sung `app/ui/tests/permission-controller.test.ts`. Dùng client giả trả về danh sách pending cố định; timer/visibility giả (đồng bộ). Kiểm tra: khi có `sessionFilter`, chỉ request khớp mới thành head.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPermissionController } from "../src/permission-controller.js";
import type { PendingPermissionView, PermissionDecisionResponse } from "../src/permission-client.js";

function pending(id: string, sessionId: string): PendingPermissionView {
  return {
    requestId: id,
    sessionId,
    approvalLevel: "elevated",
    requestedAt: new Date(0).toISOString(),
    action: { kind: "network", description: `req ${id}` },
  };
}

function fakeContainer(): HTMLElement {
  // jsdom-free: minimal element stub is not available; these tests run under the UI test env
  // which provides a DOM. If no DOM, skip DOM asserts and assert on client calls only.
  return document.createElement("div");
}

test("sessionFilter: chỉ request khớp session mới thành head", async () => {
  const seen: string[] = [];
  const client = {
    listPendingPermissions: async (): Promise<readonly PendingPermissionView[]> => [
      pending("cowork-1", "s-cowork"),
      pending("ms365-1", "s-ms365"),
    ],
    decidePermission: async (): Promise<PermissionDecisionResponse> => ({
      status: "resolved",
      decision: "allow",
      approvalLevel: "elevated",
    }),
  };
  const controller = createPermissionController({
    client,
    container: fakeContainer(),
    getMode: () => "ask",
    sessionFilter: (sid) => sid === "s-ms365",
    onPending: (req) => seen.push(req.requestId),
    timer: { setInterval: () => 0, clearInterval: () => {} },
    visibility: { isHidden: () => false, addVisibilityListener: () => {}, removeVisibilityListener: () => {} },
  });
  await controller.refresh();
  assert.deepEqual(seen, ["ms365-1"]);
});

test("không sessionFilter: nhận request đầu tiên (hành vi cũ)", async () => {
  const seen: string[] = [];
  const client = {
    listPendingPermissions: async (): Promise<readonly PendingPermissionView[]> => [
      pending("cowork-1", "s-cowork"),
      pending("ms365-1", "s-ms365"),
    ],
    decidePermission: async (): Promise<PermissionDecisionResponse> => ({
      status: "resolved",
      decision: "allow",
      approvalLevel: "elevated",
    }),
  };
  const controller = createPermissionController({
    client,
    container: fakeContainer(),
    getMode: () => "ask",
    onPending: (req) => seen.push(req.requestId),
    timer: { setInterval: () => 0, clearInterval: () => {} },
    visibility: { isHidden: () => false, addVisibilityListener: () => {}, removeVisibilityListener: () => {} },
  });
  await controller.refresh();
  assert.deepEqual(seen, ["cowork-1"]);
});
```

> Ghi chú cho implementer: nếu môi trường test UI chưa có DOM global cho `document`, kiểm tra các test hiện có trong `app/ui/tests` để theo đúng cách chúng dựng container (một số dùng jsdom setup, một số dùng stub). Dùng đúng pattern sẵn có của repo; KHÔNG thêm dependency mới. Nếu không có DOM, thay `fakeContainer()` bằng đúng stub mà file test khác trong thư mục đang dùng.

- [ ] **Step 2: Chạy test — xác nhận fail**

Run: `npx tsx --test app/ui/tests/permission-controller.test.ts`
Expected: FAIL (chưa có `sessionFilter`, cả hai test cùng trả head đầu tiên → test #1 fail vì `seen=["cowork-1"]`).

- [ ] **Step 3: Thêm field vào deps**

Trong `app/ui/src/permission-controller.ts`, thêm vào `interface PermissionControllerDeps` (ngay sau `getMode`):

```ts
  /** Chỉ xử lý request có sessionId thỏa predicate. Không truyền = nhận tất cả (hành vi cũ). */
  readonly sessionFilter?: (sessionId: string) => boolean;
```

- [ ] **Step 4: Áp filter trong `refresh()`**

Trong hàm `refresh()`, sau dòng `pending = await deps.client.listPendingPermissions();` và trước `const head = pending[0];`, thay bằng lọc:

```ts
    const scoped = deps.sessionFilter
      ? pending.filter((p) => deps.sessionFilter!(p.sessionId))
      : pending;
    const head = scoped[0];
    if (head === undefined) {
      closeModal(); // nothing pending → show nothing (honest idle)
      announced.clear();
      lastPending = null;
      return;
    }
    showHead(head, scoped.length - 1);
```

(Xóa cặp `const head = pending[0]; … showHead(head, pending.length - 1);` cũ — thay hoàn toàn bằng khối trên.)

- [ ] **Step 5: Chạy test — xác nhận pass**

Run: `npx tsx --test app/ui/tests/permission-controller.test.ts`
Expected: PASS (cả hai test).

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: GREEN (không lỗi mới ở file chạm).

```bash
git add app/ui/src/permission-controller.ts app/ui/tests/permission-controller.test.ts
git commit -m "feat(ms365): add sessionFilter to PermissionController (client-side scope)"
```

---

### Task 2: Lọc session cho controller Cowork (đóng bug pop nhầm)

**Files:**
- Modify: `app/ui/src/app-shell.ts` (controller Cowork tại ~line 2590 `createPermissionController({...})`)

**Interfaces:**
- Consumes: `sessionFilter` từ Task 1; `state.streamSessionId: string | null` (đã có, line 152).
- Produces: controller Cowork chỉ hiện request của session Cowork; request session khác bị bỏ qua.

- [ ] **Step 1: Thêm sessionFilter vào deps controller Cowork**

Trong `app/ui/src/app-shell.ts`, trong lời gọi `const permissions = createPermissionController({` (~line 2590), thêm ngay sau `getMode: () => state.permissionMode,`:

```ts
            // Chỉ xử lý request của session Cowork đang chạy. Request MS365 (session khác) do
            // controller MS365 riêng đảm nhiệm — tránh pop nhầm surface (P2-B bug fix).
            sessionFilter: (sid) => sid === state.streamSessionId,
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: GREEN.

- [ ] **Step 3: Kiểm chứng thủ công (đọc code)**

Xác nhận `state.streamSessionId` được gán khi Cowork tạo session (grep `streamSessionId =` trong app-shell.ts) và `null` khi không có run → filter đúng: khi Cowork không chạy, mọi request (kể cả MS365) đều không khớp `=== null` → controller Cowork không pop. Không cần test tự động riêng (đã phủ ở Task 1 unit; đây là wiring một dòng).

- [ ] **Step 4: Commit**

```bash
git add app/ui/src/app-shell.ts
git commit -m "fix(ms365): scope Cowork permission controller to its own session"
```

---

### Task 3: Helper `ms365ToolLabel` + state mới

**Files:**
- Create: `app/ui/src/ms365-tool-label.ts`
- Modify: `app/ui/src/app-shell.ts` (thêm state `ms365Events`, `ms365PermissionHistory`; import)
- Test: `app/ui/tests/ms365-tool-label.test.ts`

**Interfaces:**
- Produces:
  - `ms365ToolLabel(toolName: string, done: boolean): string` — nhãn tiếng Việt cho tool MS365; tool lạ → fallback `"Đang dùng công cụ: <toolName>"` / `"Đã dùng công cụ: <toolName>"`.
  - State: `ms365Events: EvEvent[]` (mảng event của lượt live hiện tại); `ms365PermissionHistory: PermissionHistoryEntry[]`.

- [ ] **Step 1: Viết test thất bại**

Tạo `app/ui/tests/ms365-tool-label.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ms365ToolLabel } from "../src/ms365-tool-label.js";

test("nhãn tool MS365 tiêu biểu", () => {
  assert.equal(ms365ToolLabel("sharepoint_search", false), "Đang tìm trên SharePoint");
  assert.equal(ms365ToolLabel("sharepoint_search", true), "Đã tìm trên SharePoint");
  assert.equal(ms365ToolLabel("teams_post_message", false), "Đang đăng tin nhắn Teams");
  assert.equal(ms365ToolLabel("planner_list_tasks", true), "Đã liệt kê công việc Planner");
  assert.equal(ms365ToolLabel("outlook_search_messages", false), "Đang tìm thư Outlook");
});

test("tool lạ dùng fallback", () => {
  assert.equal(ms365ToolLabel("unknown_tool", false), "Đang dùng công cụ: unknown_tool");
  assert.equal(ms365ToolLabel("unknown_tool", true), "Đã dùng công cụ: unknown_tool");
});
```

- [ ] **Step 2: Chạy test — xác nhận fail**

Run: `npx tsx --test app/ui/tests/ms365-tool-label.test.ts`
Expected: FAIL ("Cannot find module '../src/ms365-tool-label.js'").

- [ ] **Step 3: Viết helper**

Tạo `app/ui/src/ms365-tool-label.ts`:

```ts
/**
 * Nhãn tiếng Việt cho tool MS365 hiển thị trong strip tool-activity của tab MS365.
 * Chỉ nhãn hành động — KHÔNG bao gồm args (tránh lộ query/nội dung lên UI). Tool ngoài bảng
 * dùng fallback theo tên tool. Giữ tách khỏi activity-model.ts để model đó thuần Cowork.
 */
const LABELS: Record<string, { doing: string; done: string }> = {
  sharepoint_search: { doing: "Đang tìm trên SharePoint", done: "Đã tìm trên SharePoint" },
  sharepoint_list_site_files: { doing: "Đang liệt kê tệp SharePoint", done: "Đã liệt kê tệp SharePoint" },
  sharepoint_get_file_summary: { doing: "Đang đọc tệp SharePoint", done: "Đã đọc tệp SharePoint" },
  sharepoint_upload_file: { doing: "Đang tải tệp lên SharePoint", done: "Đã tải tệp lên SharePoint" },
  ms365_list_joined_sites: { doing: "Đang liệt kê site SharePoint", done: "Đã liệt kê site SharePoint" },
  outlook_search_messages: { doing: "Đang tìm thư Outlook", done: "Đã tìm thư Outlook" },
  outlook_get_message: { doing: "Đang đọc thư Outlook", done: "Đã đọc thư Outlook" },
  outlook_summarize_message: { doing: "Đang tóm tắt thư Outlook", done: "Đã tóm tắt thư Outlook" },
  planner_list_plans: { doing: "Đang liệt kê kế hoạch Planner", done: "Đã liệt kê kế hoạch Planner" },
  planner_list_tasks: { doing: "Đang liệt kê công việc Planner", done: "Đã liệt kê công việc Planner" },
  planner_create_task: { doing: "Đang tạo công việc Planner", done: "Đã tạo công việc Planner" },
  planner_create_tasks: { doing: "Đang tạo công việc Planner", done: "Đã tạo công việc Planner" },
  planner_edit_task: { doing: "Đang cập nhật công việc Planner", done: "Đã cập nhật công việc Planner" },
  planner_delete_task: { doing: "Đang xóa công việc Planner", done: "Đã xóa công việc Planner" },
  lists_get_lists: { doing: "Đang liệt kê SharePoint List", done: "Đã liệt kê SharePoint List" },
  lists_get_items: { doing: "Đang đọc mục List", done: "Đã đọc mục List" },
  lists_add_item: { doing: "Đang thêm mục List", done: "Đã thêm mục List" },
  lists_edit_item: { doing: "Đang cập nhật mục List", done: "Đã cập nhật mục List" },
  lists_delete_item: { doing: "Đang xóa mục List", done: "Đã xóa mục List" },
  teams_list_chats: { doing: "Đang liệt kê cuộc trò chuyện Teams", done: "Đã liệt kê cuộc trò chuyện Teams" },
  teams_list_teams: { doing: "Đang liệt kê Teams", done: "Đã liệt kê Teams" },
  teams_list_channels: { doing: "Đang liệt kê kênh Teams", done: "Đã liệt kê kênh Teams" },
  teams_list_members: { doing: "Đang liệt kê thành viên Teams", done: "Đã liệt kê thành viên Teams" },
  teams_get_messages: { doing: "Đang đọc tin nhắn Teams", done: "Đã đọc tin nhắn Teams" },
  teams_post_message: { doing: "Đang đăng tin nhắn Teams", done: "Đã đăng tin nhắn Teams" },
};

export function ms365ToolLabel(toolName: string, done: boolean): string {
  const entry = LABELS[toolName];
  if (entry !== undefined) return done ? entry.done : entry.doing;
  return done ? `Đã dùng công cụ: ${toolName}` : `Đang dùng công cụ: ${toolName}`;
}
```

- [ ] **Step 4: Chạy test — xác nhận pass**

Run: `npx tsx --test app/ui/tests/ms365-tool-label.test.ts`
Expected: PASS.

- [ ] **Step 5: Thêm state + import trong app-shell.ts**

Trong `app/ui/src/app-shell.ts`:

(a) Import (khối import EV/activity — grep `buildActivitySnapshot` hoặc `mergeEvEvents` để tìm chỗ; nếu chưa import thì thêm). Đảm bảo có:
```ts
import { buildActivitySnapshot, mergeEvEvents, type PermissionHistoryEntry } from "./activity-model.js";
import type { EvEvent } from "@cowork-ghc/contracts";
import { ms365ToolLabel } from "./ms365-tool-label.js";
```
(Nếu `PermissionHistoryEntry`/`buildActivitySnapshot`/`mergeEvEvents` đã import sẵn từ activity-model, chỉ bổ sung tên còn thiếu; KHÔNG tạo import trùng.)

(b) Trong `interface AppState` (nơi khai báo `ms365Conversations`, ~line 206), thêm:
```ts
  ms365Events: EvEvent[];
  ms365PermissionHistory: PermissionHistoryEntry[];
```

(c) Trong khởi tạo `const state: AppState = { … }` (nơi có `ms365Conversations: [],` ~line 2238), thêm:
```ts
    ms365Events: [],
    ms365PermissionHistory: [],
```

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: GREEN.

```bash
git add app/ui/src/ms365-tool-label.ts app/ui/tests/ms365-tool-label.test.ts app/ui/src/app-shell.ts
git commit -m "feat(ms365): ms365ToolLabel helper + tool-activity/permission state"
```

---

### Task 4: Gom EV events + render strip tool-activity (B2)

**Files:**
- Modify: `app/ui/src/app-shell.ts` (`createMs365Chat` stream `onEvent`; `renderMs365Transcript`; reset events tại new/select/adopt)

**Interfaces:**
- Consumes: `state.ms365Events`, `ms365ToolLabel` (Task 3); `buildActivitySnapshot`, `mergeEvEvents` (activity-model); `startEvStream` `onEvent` (đã có).
- Produces: strip tool-activity trong transcript MS365 cho lượt live; `ms365Events` reset đúng vòng đời.

- [ ] **Step 1: Gom onEvent trong stream MS365**

Trong `createMs365Chat` (~line 2147), trong `startEvStream({...})`, thêm callback `onEvent` (ngay trước `onView:`):

```ts
        onEvent: (event) => {
          state.ms365Events = [...mergeEvEvents(state.ms365Events, [event])];
        },
```

- [ ] **Step 2: Render strip trong renderMs365Transcript**

Trong `renderMs365Transcript` (~line 2099), sau vòng `for (const message of state.ms365Messages)` và TRƯỚC khối `if (state.ms365Phase === "running")`, chèn strip:

```ts
  const snap = buildActivitySnapshot(state.ms365Events, state.activeWorkspace, []);
  const toolItems = snap.items.filter((i) => i.kind === "tool");
  if (toolItems.length > 0) {
    const strip = el("div", "ms-assistant__tools");
    for (const item of toolItems) {
      const done = item.status === "success";
      const failed = item.status === "failed" || item.status === "denied";
      const icon = failed ? "✗" : done ? "✓" : "🔧";
      const row = el(
        "div",
        `ms-assistant__tool ms-assistant__tool--${item.status}`,
        `${icon} ${ms365ToolLabel(item.toolName ?? "", done)}`,
      );
      strip.append(row);
    }
    transcript.append(strip);
  }
```

> Ghi chú: KHÔNG dùng `item.label` (nhãn Cowker) và KHÔNG render `item.summary` (args thô). `item.toolName` là tên tool gốc từ EV `tool_call` — dùng nó cho `ms365ToolLabel`.

- [ ] **Step 3: Reset ms365Events tại các điểm chuyển cuộc**

Trong app-shell.ts, thêm `state.ms365Events = [];` tại:
- `onMs365NewConversation` — ngay sau `ms365Chat.resetConversation();` (trong khối sau guard `if (state.ms365Phase === "running") return;`).
- `onMs365SelectConversation` — trong nhánh thành công, cạnh `state.ms365Messages = rec.messages.map(...)` (đảm bảo cuộc cũ mở ra KHÔNG có strip).
- `onMs365Disconnect` — cạnh `state.ms365Messages = [];`.
- `onMs365Send` — ngay đầu handler nếu bắt đầu một lượt mới trên conversation hiện tại thì KHÔNG reset (giữ chuỗi tool của lượt đang xem). Chỉ reset ở new/select/disconnect. (Không thêm dòng nào ở onMs365Send.)

Cụ thể (new):
```ts
    onMs365NewConversation: () => {
      if (state.ms365Phase === "running") return;
      ms365Chat.resetConversation();
      state.ms365Events = [];
      state.ms365ActiveConversationId = null;
      // …phần còn lại giữ nguyên…
```
(select): trong nhánh sau `getConversation` thành công, cạnh gán `ms365Messages`:
```ts
          state.ms365Messages = rec.messages.map((m) => ({ role: m.role, text: m.text }));
          state.ms365Events = [];
```
(disconnect): cạnh `state.ms365Messages = [];`:
```ts
        state.ms365Messages = [];
        state.ms365Events = [];
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: GREEN.

- [ ] **Step 5: Test fold tool-activity (đơn vị, thuần hàm)**

Vì strip render phụ thuộc DOM + state app-shell (khó unit trực tiếp), kiểm chứng tầng dữ liệu: `buildActivitySnapshot` + `ms365ToolLabel` cho ra đúng chuỗi. Tạo `app/ui/tests/ms365-tool-activity.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildActivitySnapshot, mergeEvEvents } from "../src/activity-model.js";
import { ms365ToolLabel } from "../src/ms365-tool-label.js";
import type { EvEvent } from "@cowork-ghc/contracts";

function toolEvent(seq: number, callId: string, status: "running" | "completed"): EvEvent {
  return {
    sessionId: "s-ms365",
    seq,
    at: new Date(0).toISOString(),
    kind: "tool_call",
    callId,
    toolName: "teams_post_message",
    status,
  };
}

test("fold tool_call running→completed → một item, nhãn MS365 theo trạng thái", () => {
  let events: readonly EvEvent[] = [];
  events = mergeEvEvents(events, [toolEvent(1, "c1", "running")]);
  events = mergeEvEvents(events, [toolEvent(2, "c1", "completed")]);
  const snap = buildActivitySnapshot(events, null, []);
  const toolItems = snap.items.filter((i) => i.kind === "tool");
  assert.equal(toolItems.length, 1);
  assert.equal(toolItems[0]!.status, "success");
  assert.equal(ms365ToolLabel(toolItems[0]!.toolName ?? "", true), "Đã đăng tin nhắn Teams");
});
```

Run: `npx tsx --test app/ui/tests/ms365-tool-activity.test.ts`
Expected: PASS.

> Ghi chú implementer: nếu shape `EvEvent` `tool_call` khác (grep `kind: "tool_call"` trong contracts để lấy field bắt buộc chính xác — ví dụ có `summary?`), điều chỉnh `toolEvent` cho khớp; giữ nguyên ý nghĩa test.

- [ ] **Step 6: Commit**

```bash
git add app/ui/src/app-shell.ts app/ui/tests/ms365-tool-activity.test.ts
git commit -m "feat(ms365): live tool-activity strip in assistant transcript"
```

---

### Task 5: Controller permission MS365 (B1 — phê duyệt tại tab)

**Files:**
- Modify: `app/ui/src/app-shell.ts` (module-level hooks; tạo controller MS365 trong live-bootstrap; start/stop/pause/resume theo connect/disconnect + settings restart; render history vào transcript)

**Interfaces:**
- Consumes: `createPermissionController` + `sessionFilter` (Task 1); `ms365Chat.runtimeSessionId` (đã có getter); `state.ms365PermissionHistory` (Task 3); `dynamicClient` (trong live-bootstrap, cùng chỗ controller Cowork ~2590).
- Produces: modal phê duyệt cho write-tool MS365 tại tab; `state.ms365PermissionHistory` cập nhật; hooks module-level `ms365PermissionStart/Stop/Pause/Resume`.

- [ ] **Step 1: Khai báo hooks module-level**

Cạnh các biến `let permissionRefreshNow …` (~line 128), thêm:

```ts
let ms365PermissionStart: (() => void) | null = null;
let ms365PermissionStop: (() => void) | null = null;
let ms365PermissionPausePoll: (() => void) | null = null;
let ms365PermissionResumePoll: (() => void) | null = null;
```

- [ ] **Step 2: Tạo controller MS365 trong live-bootstrap**

Ngay sau khối `const permissions = createPermissionController({...}); permissions.start();` (Cowork, kết thúc ~line 2660), thêm controller MS365. Nó dùng cùng `dynamicClient` và `dom.root`:

```ts
          const ms365Permissions = createPermissionController({
            client: dynamicClient,
            container: dom.root,
            pollIntervalMs: 100,
            // Luôn hỏi: write MS365 qua Graph luôn cần phê duyệt (đúng hint composer).
            getMode: () => "ask",
            // Chỉ request của session MS365 sống hiện tại. Đọc getter tại thời điểm poll nên
            // tự bám session mới sau reset/adopt; request session cũ không pop lại.
            sessionFilter: (sid) => sid === ms365Chat.runtimeSessionId,
            onPending: (request) => {
              const target =
                request.action.targetPath !== undefined
                  ? toRelativePath(request.action.targetPath, state.activeWorkspace)
                  : request.action.description;
              const entry = permissionEntryFromDecision({
                requestId: request.requestId,
                actionLabel: permissionActionLabel(request.action.kind),
                targetSummary: target,
                decision: "pending",
                at: request.requestedAt,
              });
              if (!state.ms365PermissionHistory.some((p) => p.requestId === request.requestId)) {
                state.ms365PermissionHistory = [...state.ms365PermissionHistory, entry];
                renderMs365Transcript(dom, state);
              }
            },
            onDecision: ({ request, outcome, requestedDecision }) => {
              const target =
                request.action.targetPath !== undefined
                  ? toRelativePath(request.action.targetPath, state.activeWorkspace)
                  : request.action.description;
              const decision =
                outcome.status !== "resolved"
                  ? "denied"
                  : requestedDecision === "deny"
                    ? "denied"
                    : outcome.scope === "always"
                      ? "allowed_always"
                      : "allowed_once";
              const entry = permissionEntryFromDecision({
                requestId: request.requestId,
                actionLabel: permissionActionLabel(request.action.kind),
                targetSummary: target,
                decision,
                at: request.requestedAt,
              });
              state.ms365PermissionHistory = [
                ...state.ms365PermissionHistory.filter((p) => p.requestId !== request.requestId),
                entry,
              ];
              renderMs365Transcript(dom, state);
            },
          });
          ms365PermissionStart = () => ms365Permissions.start();
          ms365PermissionStop = () => ms365Permissions.stop();
          ms365PermissionPausePoll = () => ms365Permissions.pause();
          ms365PermissionResumePoll = () => ms365Permissions.resume();
```

> Ghi chú: `permissionEntryFromDecision`, `permissionActionLabel`, `toRelativePath` đã import/định nghĩa sẵn (controller Cowork dùng chúng). KHÔNG `.start()` ở đây — start khi connect (Step 4).

- [ ] **Step 3: Bám settings→live restart**

Nơi Cowork gọi `permissionPausePoll?.()` (grep, ~line 1465) và `permissionResumePoll?.()` (~line 1502), thêm ngay cạnh mỗi lời gọi tương ứng:
```ts
  ms365PermissionPausePoll?.();
```
và
```ts
    ms365PermissionResumePoll?.();
```
(Đặt sát dòng Cowork tương ứng để cùng vòng đời pause/resume.)

- [ ] **Step 4: Start khi connect thành công**

Trong `onMs365Connect`, trong nhánh `if (state.ms365View.connectionState === "connected")` (khối sau `renderState`, cạnh `refreshMs365Conversations`), thêm:
```ts
        if (state.ms365View.connectionState === "connected") {
          ms365PermissionStart?.();
          void refreshMs365Conversations(state, dom, handlers);
        }
```

- [ ] **Step 5: Stop + clear history khi disconnect**

Trong `onMs365Disconnect`, sau `state.ms365Messages = [];` (và `state.ms365Events = [];` từ Task 4), thêm:
```ts
        ms365PermissionStop?.();
        state.ms365PermissionHistory = [];
```

- [ ] **Step 6: Hiển thị pending permission trong transcript**

Trong `renderMs365Transcript`, sau strip tool-activity và trước khối `ms365Phase === "running"`, thêm chỉ báo pending (modal do controller lo; đây là dòng trạng thái honest trong transcript):
```ts
  const pendingPerm = state.ms365PermissionHistory.filter((p) => p.decision === "pending");
  if (pendingPerm.length > 0) {
    transcript.append(
      el("p", "ms-assistant__status ms-assistant__status--permission", "Đang chờ bạn phê duyệt hành động…"),
    );
  }
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: GREEN.

- [ ] **Step 8: Kiểm chứng thủ công (đọc code)**

Xác nhận: (a) khi Cowork ở `workspace_auto`, một request MS365 KHÔNG bị controller Cowork auto-approve (vì `sessionFilter` Cowork loại nó) và controller MS365 (`getMode "ask"`) hiện modal; (b) hai controller không cùng pop một request (mỗi cái lọc session khác nhau). Logic này đã phủ ở unit Task 1; wiring ở đây là tổ hợp.

- [ ] **Step 9: Commit**

```bash
git add app/ui/src/app-shell.ts
git commit -m "feat(ms365): dedicated permission controller for the MS365 tab (always-ask, session-scoped)"
```

---

### Task 6: CSS strip + trạng thái, và cập nhật current-status

**Files:**
- Modify: file CSS của MS surface (grep `ms-assistant__status` để tìm; thường `app/ui/src/**/*.css` hoặc style inline). Nếu repo dùng CSS thật, thêm class; nếu style tối giản, thêm tối thiểu.
- Modify: `docs/product/current-status.md` (hàng MS365)

**Interfaces:**
- Consumes: class `ms-assistant__tools`, `ms-assistant__tool--{status}`, `ms-assistant__status--permission` (Task 4/5).

- [ ] **Step 1: Tìm CSS MS surface**

Run (grep): tìm nơi định nghĩa `.ms-assistant__status`.
```
grep -rn "ms-assistant__status" app/ui/src
```
Ghi lại file CSS chứa các class `ms-assistant__*`.

- [ ] **Step 2: Thêm style strip (tối thiểu, theo tông sẵn có)**

Trong file CSS đó, thêm:
```css
.ms-assistant__tools { display: flex; flex-direction: column; gap: 2px; margin: 4px 0; }
.ms-assistant__tool { font-size: 12px; opacity: 0.85; }
.ms-assistant__tool--running { opacity: 1; }
.ms-assistant__tool--failed, .ms-assistant__tool--denied { color: var(--danger, #c0392b); }
.ms-assistant__status--permission { color: var(--warning, #b7791f); }
```
(Nếu repo dùng biến màu khác, dùng đúng biến sẵn có trong file; KHÔNG hardcode nếu đã có token.)

- [ ] **Step 3: Cập nhật current-status**

Trong `docs/product/current-status.md`, sửa ô Note hàng `| MS365 |` từ:
```
messages persisted; assistant-tab sidebar lists/opens/continues past MS365 conversations; new-conversation button. Tool-activity display + OAuth deferred.
```
thành:
```
messages persisted; assistant-tab sidebar lists/opens/continues past MS365 conversations; new-conversation button; live tool-activity strip + in-tab permission cards (write-tools approved at the MS365 tab, session-scoped). OAuth deferred.
```

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck`
Expected: GREEN.

```bash
git add -A
git commit -m "style(ms365): tool-activity strip styles + status-doc update"
```

---

## Self-Review

**Spec coverage:**
- §1 phát hiện #1–4 → Task 1 (filter), Task 2 (Cowork scope), Task 5 (MS365 controller), Task 4 (tool-activity). ✅
- §2 quyết định: sessionFilter (Task 1/2/5), MS365 always-ask (Task 5 `getMode "ask"`), nhãn ở tầng render (Task 3), live-only (Task 4 reset + không persist), nhãn+tên (Task 4 không render summary). ✅
- §3 kiến trúc: hai controller lọc session, strip từ buildActivitySnapshot → khớp Task 2/4/5. ✅
- §4 data flow B1/B2 → Task 4/5. ✅
- §5 error handling: backoff/lastError (sẵn có controller), session đổi (getter trong filter, Task 5 Step 8), disconnect stop (Task 5 Step 5), idle rỗng (Task 4 Step 2 `toolItems.length>0`), cuộc cũ (Task 4 Step 3), tool lạ (Task 3 fallback). ✅
- §6 testing → Task 1/3/4 unit; wiring Cowork/MS365 kiểm chứng đọc code (Task 2 Step 3, Task 5 Step 8) + packaged. ✅
- §7 review: chạm permission surface → whole-branch independent review. ✅

**Placeholder scan:** không có TBD/TODO; mọi step có code/lệnh cụ thể. Chỗ "grep để tìm CSS/EvEvent shape" là chỉ dẫn xác minh môi trường, kèm hành động rõ — chấp nhận được.

**Type consistency:** `ms365ToolLabel(toolName, done)` dùng nhất quán Task 3/4; `ms365Events: EvEvent[]` + `mergeEvEvents` trả `readonly EvEvent[]` → gán qua `[...mergeEvEvents(...)]` (Task 4 Step 1) để khớp `EvEvent[]` mutable; `PermissionHistoryEntry` dùng nhất quán Task 3/5; hooks `ms365Permission*` khai báo Task 5 Step 1, gán Step 2, gọi Step 3/4/5.

## Execution Handoff

Sẽ hỏi lựa chọn execution sau khi lưu plan.
