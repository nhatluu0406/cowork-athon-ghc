---
language: "vi"
status: "draft"
created_at: "2026-07-17"
topic: "P3 — Bounded port-in-use retry khi khởi động live service + document plugin-gate seam"
---

# Thiết kế: P3 — Port-in-use retry hardening (+ document plugin-gate)

## 1. Mục tiêu & phạm vi

Làm cứng luồng khởi động live service trước một race hiếm-nhưng-khó-chẩn-đoán: cổng loopback được
cấp phát (bind port 0 → đọc số → đóng socket) có thể bị process khác chiếm giữa lúc cấp và lúc
child OpenCode / socket service thật sự bind → spawn/bind chết, launch fail với thông báo mơ hồ.

P3 = **bounded retry chỉ trên tín hiệu cổng-bận rõ ràng**, cộng **document plugin-gate seam** (không
code cho phần plugin — seam no-op là cố ý).

### Phát hiện định hình scope (đã xác minh trong code)

1. `allocateLoopbackPort()` (`service/src/composition/live-launch.ts:319`) bind port 0, đọc số,
   **đóng socket**, trả số → cửa sổ TOCTOU tới lúc bind thật. Có **hai** lần cấp phát độc lập:
   child OpenCode port (`live-launch.ts:147`) và service port (`live-launch.ts:189`).
2. `supervisor.start()` (`service/src/runtime/supervisor.ts:118`) có `portChecker` pre-check → ném
   `RuntimePortInUseError` (typed, `code = "runtime_port_in_use"`, `errors.ts:35`) cho **child port**.
   Supervisor là **single-shot** (`RuntimeAlreadyStartedError` nếu gọi lại) → retry KHÔNG thể gọi lại
   `start()`; phải chạy lại toàn bộ build (supervisor + cổng mới).
3. `startLiveCoworkService` (`compose-live.ts:244`) gọi `supervisor.start()` TRƯỚC `composed.start()`
   (socket service, dòng 249). Nếu **service port** bị chiếm, `composed.start()` ném raw Node
   `EADDRINUSE`, và catch tại `compose-live.ts:377-382` đã stop pump + supervisor → không rò child.
4. `createLiveStartService` (`app/shell/src/service/live-service-adapter.ts:45`) là điểm DUY NHẤT thấy
   cả `resolveOptions()` (đúc supervisor + cổng mới) lẫn `startLive()` (nơi bind fail) → chỗ retry sạch.
5. Plugin `tool.execute.before` (`ms365-plugin-file.ts:95`) là **no-op cố ý**: child không đọc được
   session scope của chính nó; `Ms365SessionScope` ở router mới là guard fail-closed thật. Thêm gate
   ở plugin = bảo mật giả.

### Trong phạm vi
- Bounded retry ở `createLiveStartService`: bắt tín hiệu cổng-bận → chạy lại `resolveOptions()` +
  `startLive()` (cổng ephemeral mới mỗi lần), tối đa `maxAttempts` (default 3).
- Predicate `isPortInUse(err)`: `err.code === "runtime_port_in_use"` (child) **HOẶC**
  `err.code === "EADDRINUSE"` (service socket). Đọc property, KHÔNG `instanceof` (qua package boundary).
- Document plugin-gate seam trong `docs/quality/known-limitations.md` (một mục ngắn, không code).

### Ngoài phạm vi (YAGNI / ràng buộc)
- Sửa `allocateLoopbackPort` để "giữ socket tới lúc bind" — bất khả thi: child là process con tự bind
  cổng qua CLI arg; không giữ socket hộ nó được.
- Retry trên `runtime_health_timeout` hoặc `runtime_spawn_failed` — sẽ CHE lỗi binary/pin thật, làm
  launch fail chậm gấp N lần. Chỉ retry tín hiệu cổng-bận không mơ hồ.
- Thêm cơ chế gate mới trong plugin (child không đọc được scope → mọi quyết định là đoán mò).
- Sleep giữa các lần retry (cổng ephemeral mới ngẫu nhiên; đụng lại liên tiếp gần bất khả).
- Đổi contract, sửa supervisor/errors (đã có `code` ổn định), sửa router/gate/session-scope.

## 2. Quyết định thiết kế (đã chốt với PO)

| Chủ đề | Quyết định |
|---|---|
| Vị trí retry | `createLiveStartService` (shell adapter) — bọc `resolveOptions` + `startLive` |
| Tín hiệu retry | `runtime_port_in_use` (child) + `EADDRINUSE` (service socket) — cả hai |
| KHÔNG retry | health-timeout, spawn-fail, config-invalid, not-configured |
| Số lần | `maxAttempts` default 3, injectable cho test |
| Nhận diện lỗi | Đọc `err.code` (property), không `instanceof` (qua package boundary) |
| Sleep giữa các lần | Không (cổng mới ngẫu nhiên; retry tức thì) |
| Plugin gate | Chỉ document (no-op cố ý); giữ nguyên hook + comment |

## 3. Kiến trúc

```
createLiveStartService(resolveOptions, startLive, opts?):
  for attempt in 1..maxAttempts:
    options = await resolveOptions()          // fresh supervisor + 2 cổng ephemeral mới mỗi lần
    try:
      live = await startLive(options)         // supervisor.start (child port) → composed.start (service port)
      return toStartedService(live)
    catch err:
      if isPortInUse(err) && attempt < maxAttempts:
        log?.("live_start_port_retry attempt=<N>")
        continue
      throw err                               // lỗi khác / hết lượt → ném honest
```

**Thành phần chạm:**
- `app/shell/src/service/live-service-adapter.ts`: thêm vòng retry + `isPortInUse` + tham số
  `{ maxAttempts?: number; log?: (line: string) => void }` (injectable, default 3 / no-op). Chữ ký
  `createLiveStartService(resolveOptions, startLive?, opts?)` — thêm tham số thứ ba OPTIONAL, không phá
  call site hiện có.
- `docs/quality/known-limitations.md`: mục plugin-gate seam.

**Không đụng:** service package (errors có `code` sẵn), supervisor, router, gate, contract, renderer.

## 4. Data flow

```
Cổng child bị chiếm giữa allocate↔bind:
  supervisor.start → portChecker fail → RuntimePortInUseError(code=runtime_port_in_use)
  → supervisor tự abortStart (kill child, clear .runtime/), socket service CHƯA mở → không rò
  → createLiveStartService bắt → retry: resolveOptions cấp child port mới

Cổng service bị chiếm giữa allocate↔bind:
  supervisor.start OK (child chạy) → composed.start → raw EADDRINUSE
  → catch compose-live.ts:377-382 stop pump + supervisor.stop → không rò
  → createLiveStartService bắt (code=EADDRINUSE) → retry: resolveOptions cấp service port mới
```

## 5. Error handling

| Tình huống | Xử lý |
|---|---|
| Port bận (child/service), còn lượt | Log `live_start_port_retry attempt=<N>`; `continue` → resolveOptions cấp cổng mới |
| Port bận, hết lượt | Ném lỗi cuối (không nuốt) — launch fail honest |
| `runtime_health_timeout` / `runtime_spawn_failed` | Ném ngay, KHÔNG retry (không che lỗi binary/pin) |
| `ServiceLaunchNotConfiguredError` (từ resolveOptions) | Ném ngay — giữ honest not-connected, không retry |
| Cleanup giữa các lần | Đã xác minh: child-port → supervisor.abortStart; service-port → catch stop pump+supervisor. Không rò child/socket. |

## 6. Testing

`app/shell/tests/live-service-adapter.test.ts`:
1. `startLive` ném `{code:"runtime_port_in_use"}` lần 1, OK lần 2 → trả StartedService; `resolveOptions`
   gọi đúng 2 lần (cổng mới lần 2).
2. `{code:"EADDRINUSE"}` lần 1, OK lần 2 → cũng retry (nhánh service-port).
3. Bận cả `maxAttempts` (default 3) lần → ném lỗi cuối; `resolveOptions` gọi đúng 3 lần.
4. `{code:"runtime_health_timeout"}` → ném ngay; `resolveOptions` gọi đúng 1 lần (KHÔNG retry).
5. `ServiceLaunchNotConfiguredError` từ `resolveOptions` → ném ngay, không retry.
6. Backward-compat: gọi `createLiveStartService(resolveOptions)` (không opts) vẫn hoạt động; lỗi cổng
   với default 3 lần.
7. Regression: `npm run typecheck`, focused shell tests, `scripts\verify-fast.bat`.

## 7. Bảo mật & review

- Retry chỉ xoay cổng loopback ephemeral; KHÔNG chạm secret/token/credential.
- Lỗi ném ra đã typed + secret-free (errors.ts) — log chỉ `attempt=<N>`, không nội dung lỗi thô.
- Không đổi contract/service/router/gate. Predicate + retry thuần ở shell adapter.
- Chạm runtime/process launch → theo CLAUDE.md nên có independent review ở whole-branch.
