---
task: "CGHC-002"
loop: "L6"
title: "Local application service — loopback boundary + per-launch token + typed contract"
language: "vi"
status: "implemented"
adr_refs: ["0003", "0008"]
---

# CGHC-002 — Local application service (boundary loopback)

## 1. Đã xây dựng cái gì

Tạo package `@cowork-ghc/service` (`service/`) — **local application service** standalone Node
(ADR 0003), là **execution/permission boundary**. HTTP server bind loopback-only, guard bằng
per-launch client token, dispatch tới các typed route mount trên một registry. SSE-ready: handler
tự sở hữu response khi các route streaming được thêm sau.

Cấu trúc:

```
service/
  package.json                # @cowork-ghc/service, private, type module
  tsconfig.json               # extends ../tsconfig.base.json (strict)
  src/
    index.ts                  # public surface (barrel)
    boundary/
      contract.ts             # versioned envelope + typed route/router + client interface
      client.ts               # typed BoundaryClient (fetch, gắn token mỗi request)
    server/
      loopback.ts             # isLoopbackAddress / assertLoopbackHost / shouldAcceptConnection (P7)
      token.ts                # generate/verify/check per-launch token (constant-time, non-persistent)
      router-registry.ts      # mount seam + chặn trùng route (fail closed)
      health-router.ts        # GET /v1/health (cold-start readiness)
      http-util.ts            # đọc body có giới hạn + ghi envelope
      http-service.ts         # createService(): bind loopback + guard + dispatch + start/stop
    start.ts                  # startService(): seam tiện dụng cho shell/scripts (mount + start + client)
  tests/
    loopback-bind.test.ts     # P7 negative test
    token.test.ts             # token non-persistence + guard
    boundary.test.ts          # envelope + mount seam
```

Không thêm dependency runtime nào (chỉ dùng `node:http`, `node:crypto`, `node:net`); tsx/typescript
đã có sẵn ở root (ADR 0008).

## 2. Acceptance criteria → nơi thỏa mãn (code mapping)

**AC1 — Bind loopback-only, từ chối non-loopback, không bao giờ `0.0.0.0`:**
- `src/server/loopback.ts`: `assertLoopbackHost()` chỉ chấp nhận `127.0.0.1`/`localhost`/`::1`, ném
  `LoopbackBindError` cho `0.0.0.0`, `::`, LAN IP. Gọi trong constructor của service → cấu hình
  non-loopback bị **fail closed** ngay khi tạo service.
- `http-service.ts`: `listen({ host, port })` với host loopback; `port` mặc định `0` (ephemeral)
  chỉ chọn cổng tự do, **không** mở rộng interface (ADR 0003).
- Defense in depth: listener `connection` destroy socket nếu `remoteAddress` không loopback
  (`shouldAcceptConnection`), và kiểm lại trong `handle()`.

**AC2 — Per-launch client token, non-persistent, request thiếu/sai token bị từ chối (401/403):**
- `src/server/token.ts`: `generateClientToken()` = `randomBytes(32)` hex (256-bit), sinh **mỗi
  launch**. Module này **không import filesystem** → không có code path ghi token ra đĩa. So sánh
  constant-time (`timingSafeEqual` trên digest sha256). `checkClientToken` phân loại
  `missing`/`invalid`/`ok`.
- `http-service.ts` guard: route mặc định `requiresToken !== false`; `missing → 401 unauthorized`,
  `invalid → 403 forbidden`, `ok → tiếp tục`. Token nhận qua `Authorization: Bearer` hoặc
  `x-cowork-token`.
- Token không bao giờ được log (redaction: `fail()` trả message generic cho lỗi internal).

**AC3 — Typed boundary contract (không generic passthrough, không catch-all route):**
- `src/boundary/contract.ts`: `BOUNDARY_PROTOCOL_VERSION` + `SuccessEnvelope<T>`/`ErrorEnvelope`
  (versioned envelope), `BoundaryErrorCode` (closed set), `RouteDefinition`/`BoundaryRouter` (mọi
  route được **khai báo tường minh**), `BoundaryClient` (client interface có kiểu).
- `src/boundary/client.ts`: `createBoundaryClient()` — client có kiểu, gắn token mỗi request.
- HTTP surface tối thiểu hiện tại: `GET /v1/health` + token-guard middleware + versioned envelope.

## 3. Test — lệnh chính xác + PASS thật

Lệnh (chạy trong `service/`):

```
node --import tsx --test "tests/**/*.test.ts"
```

Output tail thật (sau khi áp dụng các fix từ security review — 18 test):

```
✔ a mounted router is reachable and wraps results in the versioned envelope (54.286ms)
✔ a route may opt out of the token guard ONLY via explicit publicUnauthenticated (10.2107ms)
✔ mounting a publicUnauthenticated route is audited; other routes stay token-guarded (6.3872ms)
✔ an unknown route returns a not_found error envelope (7.7331ms)
✔ mounting a duplicate method+path is rejected (fail closed) (1.1568ms)
✔ an oversized body is rejected with payload_too_large (9.1815ms)
✔ binds an ephemeral loopback port and reports a loopback address (20.4916ms)
✔ refuses a non-loopback bind host (never 0.0.0.0) (0.3627ms)
✔ connection filter accepts only loopback peers (0.1441ms)
✔ a foreign Host header is rejected (DNS-rebinding defense) (21.4388ms)
✔ isAllowedHostHeader accepts only loopback authorities at the bound port (0.1888ms)
✔ isLoopbackAddress classifies IPv4/IPv6 loopback forms (0.1743ms)
✔ generateClientToken yields unique 256-bit hex tokens (6.5263ms)
✔ checkClientToken classifies missing / invalid / ok (0.333ms)
✔ an empty/too-short configured token is rejected (fail-closed footgun guard) (1.1468ms)
✔ each fresh launch produces a new, distinct token (26.6916ms)
✔ wrong/absent token is rejected; correct token is accepted (31.2828ms)
✔ the live token is never written to disk by the service (26.4204ms)
ℹ tests 18
ℹ pass 18
ℹ fail 0
```

Typecheck strict: `tsc -b service/tsconfig.json` → EXIT 0 (src). Tests cũng typecheck sạch dưới
strict (composite=false, noEmit) → EXIT 0.

Mapping test → acceptance:
- **P7 loopback bind negative** (`loopback-bind.test.ts`): bind ephemeral loopback + báo địa chỉ
  loopback; `createService({host:"0.0.0.0"|"::"|LAN})` ném `LoopbackBindError`; `shouldAcceptConnection`
  chỉ chấp nhận peer loopback; phân loại IPv4/IPv6 loopback.
- **boundary token non-persistence** (`token.test.ts`): token duy nhất 256-bit; hai launch → hai
  token khác nhau; request thiếu token → 401, sai token → 403, đúng token → 200; **quét toàn bộ cây
  thư mục `service/` (trừ node_modules/.git) khẳng định token đang chạy KHÔNG xuất hiện trong bất kỳ
  file nào** (non-persistence).
- **boundary contract/mount** (`boundary.test.ts`): router mount được gọi và bọc trong versioned
  envelope; route có thể opt-out token; route lạ → `not_found`; mount trùng route bị chặn; body quá
  cỡ → 413 `payload_too_large`.

## 4. Boundary-contract shape + mount seam cho task hạ nguồn

- **Mount seam:** downstream task (workspace/session/permission/files/provider/credential/diagnostics/
  execution) mỗi task export một `BoundaryRouter` (`{ name, routes: RouteDefinition[] }`) rồi gọi
  `service.mount(router)` **hoặc** truyền qua `startService({ routers: [...] })`. Registry chặn trùng
  `method + path` (fail closed). Mỗi handler nhận `RouteContext` (method/url/params/body) và trả
  `RouteResult { status, data }`; service tự bọc `data` vào `SuccessEnvelope`.
- **Envelope:** `{ protocol, ok: true, data }` | `{ protocol, ok: false, error: { code, message } }`.
- **Client:** downstream mở rộng interface `BoundaryClient` + factory `createBoundaryClient` bằng các
  method có kiểu riêng (mỗi method ↔ một route đã khai báo). Không có generic IPC passthrough.
- **start/stop/health:** `startService()` trả `{ service, address, baseUrl, clientToken, client }`.
  `service.start()/stop()/address()` + `GET /v1/health` là các seam mà **runtime-llm-engineer** dùng
  cho `.bat`/supervisor (ADR 0004) — CGHC-002 chỉ cung cấp seam, không sở hữu wiring supervisor.

## 5. Token model — đảm bảo per-launch + non-persistence thế nào

- **Per-launch:** `clientToken` mặc định `generateClientToken()` gọi trong constructor → mỗi lần
  `createService()`/`startService()` là một token mới, ngẫu nhiên 256-bit. Test khẳng định hai launch
  cho hai token khác nhau.
- **Non-persistence:** token chỉ nằm ở field trong bộ nhớ tiến trình. `token.ts` **không** import
  `node:fs` nên không tồn tại code path ghi đĩa. Handshake giao token cho shell/renderer dự kiến qua
  launch (ví dụ stdout khi spawn), **không ghi file** (MED-1). Test quét cây thư mục khẳng định token
  đang chạy không lọt vào file nào.

## 6. Assumptions

- `GET /v1/health` **yêu cầu token** (fail-closed): shell lấy token lúc launch rồi mới poll readiness.
  Nếu sau này cần một liveness probe không cần token, phải khai báo route **`publicUnauthenticated: true`**
  tường minh (được audit khi mount) — không còn opt-out ngầm `requiresToken:false`.
- Handshake truyền token từ service → shell (qua stdout/spawn) thuộc CGHC-004 (supervisor), không nằm
  trong task này; ở đây chỉ trả `clientToken` từ `startService()`.
- Dùng `node:http` thuần (không framework) để giữ dependency tối thiểu và headless-testable.
- Root `tsconfig.json` reference cả `core/contracts` và `runtime` (chưa tồn tại) nên `tsc -b` ở root
  sẽ fail cho tới khi các package đó được tạo; typecheck của CGHC-002 chạy trực tiếp
  `tsc -b service/tsconfig.json` (EXIT 0). Không sửa root tsconfig (ngoài phạm vi task).

## 7. Open risks (gate CGHC-004/007/009/012/016/021)

- **Streaming/SSE (S2/EV, gate CGHC-009/…):** transport hiện là request/response + envelope. Route
  SSE sẽ cần handler tự quản lý `ServerResponse` (không đi qua `writeEnvelope`). Seam cho phép điều
  này (handler nhận ctx, tự viết response) nhưng contract cho khung EV/terminal-state (ADR 0003
  MED-2) chưa được đặc tả — task execution/session phải bổ sung.
- **Token handshake (CGHC-004):** cơ chế truyền token service→shell chưa hiện thực; nếu chọn kênh ghi
  file sẽ vi phạm MED-1 — phải giữ non-persistent (stdout/env handshake).
- **Permission Deny reply path (CGHC-012):** boundary hiện chưa có route permission; enforcement
  “Deny chặn trên đĩa + reply tường minh cho runtime” (ADR 0003 §Permission) là của permission task,
  chỉ mount lên seam này.
- **Provider/credential (CGHC-016/021):** cần đảm bảo redaction value-based khi log ở boundary; hiện
  service không log secret, nhưng scrubber (SEC-2) là của diagnostics/credential task.
- **IPv6 loopback:** mặc định bind `127.0.0.1`. Nếu shell/renderer kết nối `::1` cần khởi động service
  với `host:"::1"` (đã hỗ trợ, baseUrl bọc `[::1]`).

## 8. Security review fixes (review = PASS_WITH_FINDINGS, 0 Critical/High)

Đã đóng 1 MEDIUM + 4 LOW từ independent security review; re-run 18 test PASS + typecheck EXIT 0.

- **MEDIUM — chặn opt-out token ngầm.** Bỏ `requiresToken?: boolean`; route chỉ có thể bỏ guard bằng
  marker tường minh **`publicUnauthenticated: true`**. `RouterRegistry` **ghi lại + phát audit event**
  (`unauthenticated_route_mounted` qua `onAudit` sink) mỗi khi mount một route như vậy, nên nó luôn
  hiện trong review. Default = token-required. Test: mount public route được audit; route thường vẫn
  bị guard (401); `/v1/health` giữ token-required; `/v1/open` (test-only) đã đổi sang marker mới.
  Code: `contract.ts` (marker + `BoundaryAuditEvent`/`BoundaryAuditSink`), `router-registry.ts`
  (audit), `http-service.ts` (`publicUnauthenticated !== true` → guard).
- **LOW — không echo message lỗi tuỳ ý.** `http-service.ts::fail()` chỉ trả `err.message` cho
  **error class thuộc boundary** (`instanceof PayloadTooLargeError`/`InvalidJsonBodyError`); mọi giá
  trị throw khác → message generic cố định theo code (`Internal boundary error.`). Đã xoá
  `errorCodeOf`/`messageOf`/`statusOf` (đọc `err.code` tuỳ ý). Chặn handler CGHC-007/009 tương lai lỡ
  ném path/secret vào envelope.
- **LOW — Host-header validation (DNS-rebinding).** `loopback.ts::isAllowedHostHeader()` chỉ chấp nhận
  `127.0.0.1`/`localhost`/`[::1]` đúng cổng bound; host lạ/cổng sai → **403 `invalid_host`**. Không
  bao giờ phát CORS header nới lỏng. Test dùng raw `node:http` request (fetch chặn set `Host`) khẳng
  định host lạ bị từ chối và host loopback đúng cổng được phục vụ; thêm unit test cho `isAllowedHostHeader`.
- **LOW — socket/request timeout.** Constructor set `headersTimeout=15s`, `requestTimeout=30s`,
  `keepAliveTimeout=5s`, và per-socket `setTimeout(120s)` (destroy khi idle). Body vẫn bounded và đọc
  **sau** guard token. (Các timeout này governs receipt request, không cắt response body dài; route SSE
  tương lai phải gửi heartbeat để giữ socket sống — ghi ở carry-forward.)
- **LOW — từ chối token cấu hình rỗng/ngắn.** `token.ts::assertConfiguredToken()` ném
  `WeakClientTokenError` khi `clientToken` được cấu hình < 32 ký tự (tránh footgun khoá hết client);
  token mặc định vẫn sinh ngẫu nhiên. Test khẳng định `""`/`"short"` bị từ chối, token ≥32 được nhận.

## 9. Carry-forward gating cho downstream (KHÔNG hiện thực ở task này)

- **CGHC-007/009/016 — route nhạy cảm PHẢI giữ token guard**, tuyệt đối không dùng
  `publicUnauthenticated`. Mọi route public phải là quyết định tường minh, được audit và review; SSE
  route tự quản `ServerResponse` nhưng vẫn qua guard.
- **CGHC-004 — token handshake PHẢI non-persistent:** truyền token service→shell qua stdout/env lúc
  spawn, **không** ghi file/registry, **không** log. `startService()` chỉ trả `clientToken` in-memory.
- **CGHC-021 — redaction PHẢI bọc error path** trước khi bất kỳ message handler nào tới client;
  `fail()` hiện đã fail-safe (generic cho lỗi ngoài boundary) nhưng scrubber value-based (SEC-2) là của
  task này.
- **SSE heartbeat:** route streaming phải gửi heartbeat định kỳ (< `SOCKET_IDLE_TIMEOUT_MS` = 120s) để
  idle-timeout không cắt stream; hoặc nâng timeout cho route đó.
