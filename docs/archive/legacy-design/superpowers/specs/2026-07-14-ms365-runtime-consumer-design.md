---
language: "vi"
status: "approved"
created_at: "2026-07-14"
topic: "ms365-runtime-consumer"
track: "D2"
phase: "P5.5"
---

# Design: MS365 runtime consumer — OpenCode plugin + gate-wait + scoped token — P5.5

## Vấn đề

Toàn bộ tool MS365 (P0→P5) chỉ tồn tại ở service (`POST /v1/ms365/tool-call`); **không có code nào
phía OpenCode child tiêu thụ** — `opencode.json` sinh ra không khai báo tool/plugin/MCP nào, và
2 biến env `CGHC_MS365_TOOL_ENDPOINT`/`CGHC_MS365_TOKEN` (live-launch.ts:182-191) không có reader.
Model trong phiên chat không nhìn thấy tool MS365. Kèm theo 2 lỗ đã xác nhận ở review 2026-07-14:

- **Gate deny-loop**: mọi write handler `gate.submit` → `gate.proceed` cùng tick — state luôn
  `pending` lúc proceed → lần đầu luôn denied; retry cùng requestId → submit ném duplicate → 500;
  retry requestId mới → denied mãi. Write không bao giờ hoàn tất trong phiên thật.
- **Full client token trong env child**: `CGHC_MS365_TOKEN` = token guard MỌI route (credentials,
  write-mode, disconnect…) — quá rộng cho child chứa nội dung untrusted (mail/Teams).

## Quyết định kiến trúc (evidence: khảo sát 2026-07-14, OpenCode pin v1.17.11)

**Chọn OpenCode PLUGIN, không MCP, không fork build-in.**

- Registry của v1.17.11 quét `{plugin,plugins}/*.{ts,js}` trong mọi config directory, **bao gồm
  `OPENCODE_CONFIG_DIR`** — đúng thư mục per-launch mà supervisor đã tạo và ghi `opencode.json`
  vào (supervisor.ts:119-129). Plugin trả về map `tool: { <name>: tool({...}) }` được đăng ký
  **đúng tên as-is** (registry.ts:188-193 tại tag v1.17.11) — khớp `TOOL_NAMES` của router.
- Binary nhúng Bun (v1.3.14) — plugin TS chạy in-process, có `fetch` + `process.env`, không cần
  runtime ngoài.
- MCP bị loại (bây giờ): remote MCP đòi viết adapter giao thức mới trên boundary; local MCP spawn
  process con thứ hai ngoài one-supervisor lifecycle. Có thể thêm SAU nếu cần mở connector cho
  agent ngoài OpenCode — plugin không cản đường đó.
- Rủi ro đã nhận diện: OpenCode background-install `@opencode-ai/plugin` qua npm khi thấy config
  dir (cần mạng, có tiền lệ fail — issue #3001). **Giải pháp: pre-seed
  `<configDir>/node_modules/@opencode-ai/plugin` (+ deps, gồm zod)** từ node_modules đóng gói sẵn
  của app (thêm dependency `@opencode-ai/plugin@1.17.11` — cùng lockstep với binary pin) — import
  resolve tại chỗ, không phụ thuộc mạng lúc launch.

## 4 mảnh triển khai

### Mảnh 1 — Gate-wait cho MS365 write (sửa deny-loop)

Write handler đợi quyết định thật của user thay vì proceed cùng tick:

- Helper `awaitGateDecision(gate, requestId, wait)`: vòng poll (250ms) — `gate.isAllowed` →
  `"allowed"`; requestId **không còn trong `gate.pending()`** và không allowed → `"denied"`
  (phủ cả Deny tay lẫn fail-closed timeout 120s của gate — timer tự deny làm pending biến mất);
  hard cap 180s đề phòng kẹt.
- Mọi write (upload, planner ×3, lists ×3, teams post, batch): `submit` → `await awaitGateDecision`
  → allowed thì `proceed` (giữ nguyên proceed sync + await result ngoài — **PermissionGate core
  KHÔNG đổi**); denied → kết quả `denied` như cũ.
- UX: 1 tool call = 1 card = 1 kết quả cuối. Model không cần retry; card 120s không trả lời →
  denied (session KHÔNG bị deny cả phiên nữa vì tool call vẫn nhận kết quả denied tường minh —
  hành vi denySession của gate với request timeout giữ nguyên, ngoài phạm vi).
- `ToolDeps` thêm `wait?: (ms: number) => Promise<void>` (default `setTimeout`) để test điều khiển.
- Test hiện có đổi khuôn: khởi động promise handler → `gate.resolve(allow/deny)` → await kết quả.

### Mảnh 2 — Scoped token cho route tool-call

- `HttpService` nhận thêm `pathScopedTokens?: readonly { token: string; paths: readonly string[] }[]`:
  guard hiện tại giữ nguyên cho main token; nếu main token không khớp, thử scoped token bằng
  so sánh constant-time — chỉ pass khi `url.pathname` nằm trong `paths` của token đó.
- Live-launch mint token thứ hai `ms365ToolToken` (random như clientToken), đăng ký scoped cho
  DUY NHẤT `/v1/ms365/tool-call`, và `CGHC_MS365_TOKEN` = token scoped này (không còn full token).
- Child (plugin) chỉ còn gọi được đúng 1 route; write-mode/disconnect/credentials ngoài tầm với
  của child.

### Mảnh 3 — Plugin file + seed + policy

- Module mới `service/src/runtime/ms365-plugin-file.ts`: hằng `MS365_PLUGIN_SOURCE` (chuỗi tĩnh,
  KHÔNG interpolate secret — endpoint/token đọc từ `process.env` lúc chạy) + `writeMs365Plugin
  (configDir)` ghi `<configDir>/plugin/ms365.ts`.
- Nội dung plugin: import `tool` từ `@opencode-ai/plugin`; export async plugin trả
  `tool: { 25 tool MS365 }` — args là Zod shape khớp validator của router; mỗi `execute(args, ctx)`
  POST `{ name, args, sessionId: ctx.sessionID, requestId: crypto.randomUUID() }` tới
  `process.env.CGHC_MS365_TOOL_ENDPOINT` với header `x-cowork-token: process.env.CGHC_MS365_TOKEN`,
  unwrap envelope `{ok, data}` của boundary và trả JSON string `ToolResult` cho model; lỗi
  mạng/HTTP → chuỗi lỗi ngắn không secret. Thiếu env → kết quả `not_configured`.
- Seed: `seedMs365PluginDeps(configDir, nodeModulesRoot)` copy đệ quy `@opencode-ai/plugin` + deps
  transitive (zod…) vào `<configDir>/node_modules/`. `nodeModulesRoot` suy từ `binPath`
  (`…/node_modules/opencode-ai/bin/opencode.exe` → `…/node_modules`); không tìm thấy → log warning
  (đã redact) và vẫn ghi plugin (fallback background-install của OpenCode).
- Supervisor `start()`: sau `mkdirSync(configDir)`, nếu `spec.baseEnv` có `CGHC_MS365_ENABLED` →
  ghi plugin + seed. Flag OFF → không ghi gì, baseline giữ nguyên.
- `opencode.json` policy: khi MS365 enabled, `LIVE_SESSION_PERMISSION_POLICY` bổ sung `allow` cho
  đúng 25 tên tool MS365 (tránh double-prompt: OpenCode-side ask sẽ chồng lên gate service — nơi
  enforce thật theo rule "permission at the execution boundary"; read chạy tự do như thiết kế).
- Guard secret: tái dùng cơ chế refuse-if-secret-bytes của `writeOpencodeConfig` cho file plugin.

### Mảnh 4 — Verify tiêu thụ end-to-end (acceptance)

Bằng chứng "model gọi được tool" mà KHÔNG cần tenant:

1. Launch supervisor thật (binary v1.17.11) với flag ON, MS365 **chưa connect**.
2. Phiên thật (provider thật hoặc mock hỗ trợ tool-call) prompt: "gọi tool ms365_list_joined_sites".
3. Kỳ vọng chuỗi: model thấy tool → plugin execute → POST route (scoped token) → handler trả
   `not_connected` → model relay lỗi. Roundtrip này chứng minh TOÀN BỘ chain mà không đụng Graph.
4. Ghi kết quả (PASS/FAIL trung thực) vào api-map + current-status. Khi user có tenant + token:
   lặp lại với connected → tool read thật.

## Testing

- Mảnh 1: unit — allow-sau-khi-đợi thực thi đúng 1 lần; deny-sau-khi-đợi chặn (0 Graph call);
  pending biến mất (timeout giả lập) → denied; batch giữ manual_mode check TRƯỚC submit.
- Mảnh 2: unit http-service — scoped token pass đúng path, 403 path khác; main token pass mọi
  route; thiếu token 401. live-launch env test cập nhật (`CGHC_MS365_TOKEN` ≠ clientToken).
- Mảnh 3: unit — file ghi đúng chỗ khi flag ON, vắng khi OFF; source chứa đủ 25 tên tool; KHÔNG
  chứa giá trị token/endpoint cứng; policy có 25 entry allow khi ON, vắng khi OFF; seed copy đúng.
- Mảnh 4: thủ tục ghi evidence (không claim khi chưa chạy).

## Acceptance criteria

1. Write MS365 trong phiên thật hoàn tất được: 1 call → card → Allow → mutation chạy → kết quả ok
   (unit-proof qua khuôn resolve-async; live-proof ở mảnh 4 bước connected).
2. Child chỉ giữ token scoped cho `/v1/ms365/tool-call`; token này bị 403 trên mọi route khác.
3. Flag OFF: không plugin file, không policy entry, không token mint thêm — baseline không đổi.
4. Plugin file không chứa secret bytes; 25 tool đăng ký đúng tên router.
5. Live consumption run có kết quả ghi nhận trung thực (PASS/FAIL) trong api-map + current-status.
6. PermissionGate core không đổi; typecheck + targeted tests PASS.

## Mảnh 5 — Session gating: chỉ tab MS365 dùng tool MS365 (quyết định PO 2026-07-14, bổ sung)

PO yêu cầu: **chỉ session sinh ra từ tab Microsoft 365 mới được gọi tool MS365** — chat chính bị
chặn thật (fail-closed ở execution boundary, không chỉ ẩn UI).

- `Ms365SessionScope` (in-memory `Set<sessionId>` — session ephemeral theo app run, không persist):
  `allow(sessionId)`, `revoke(sessionId)`, `isAllowed(sessionId)`.
- Route token-guarded MỚI `POST /v1/ms365/session-scope` body `{ sessionId, enabled }` — chỉ MAIN
  client token gọi được (token scoped của child chỉ pass `/v1/ms365/tool-call` → child KHÔNG thể
  tự đăng ký session của nó — bất biến an ninh của mảnh 2 bao luôn mảnh này).
- `handleToolCall`: check ĐẦU TIÊN — sessionId chưa được allow → error
  `{ kind: "session_not_allowed", message: "Tool Microsoft 365 chỉ dùng được trong tab Microsoft 365." }`.
  Fail-closed: registry rỗng (mặc định) = mọi session bị chặn.
- UI interim (trong slice này): chat chính NGỪNG tiêm `MS365_ORCHESTRATION_POLICY` và ẨN pill
  write-mode (tránh UI gợi ý thứ bị chặn). Pill + prompt block + chat thật của tab Microsoft
  chuyển sang slice **P5.6 (MS365 tab chat)** — tab chat sẽ gọi session-scope khi tạo session.
- Verify (mảnh 4 cập nhật): roundtrip qua model ở chat chính giờ kỳ vọng `session_not_allowed`
  (vẫn chứng minh chain plugin→token→route→handler); đăng ký session thủ công qua route rồi lặp
  lại → `not_connected`.

## Ngoài phạm vi

- MCP server surface (chỉ khi cần agent ngoài OpenCode).
- Gói live-readiness fix Graph ($expand, 403→insufficient_scope, Prefer header, verify script mở
  rộng, UI scopes/copy/mask) — slice riêng tiếp theo.
- Đổi hành vi denySession của gate timeout.
- **P5.6 — MS365 tab chat**: session + streaming + transcript trong tab Microsoft, di dời pill +
  prompt block vào composer tab đó, gọi `POST /v1/ms365/session-scope` khi tạo session (spec
  riêng).
