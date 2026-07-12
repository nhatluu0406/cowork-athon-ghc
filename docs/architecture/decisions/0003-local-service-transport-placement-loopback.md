---
title: "Local Service: Transport (HTTP + SSE), Placement (Standalone), Loopback-Only (P7)"
document_type: "architecture-decision-record"
language: "vi"
status: "accepted"
---

# ADR 0003 — Local Service: Transport (HTTP + SSE), Placement (Standalone), Loopback-Only (P7)

- Status: **Accepted** — FROZEN in Loop L4 (Architecture Review), 2026-07-11. Được phê duyệt sau đợt critique đa vai trò + threat model. Thay thế bản nháp Proposed của L3.
- Date: 2026-07-11
- Loop: L3 (Architecture Candidates)
- Deciders: product-architect (L3); sẽ được phê duyệt bởi đợt critique + freeze ở L4.
- Requirement drivers: P7 (loopback), S2/S3 (streaming + cancel), EV1–EV7 (event stream), invariant
  "UI là một client của một local application service bound to loopback".
- Related ADRs: 0001 (runtime), 0002 (shell), 0004 (lifecycle), 0005 (provider port).

## Context

L2 (`desktop-shell-and-lifecycle.md` §3; discovery-report §3.5) đã trình bày sub-decision
transport/placement/loopback vốn gắn kết với nhau:

- Reference UI (React/Vite) là một client thuần của một local **HTTP** service; realtime là **SSE**
  proxy từ runtime (`proxyOpencodeRequest`, `server.ts:887`); service bind `127.0.0.1`
  (`config.ts:48`).
- **Placement trong reference là embedded-in-Electron-main** (`runtime.mjs:1203`
  `startEmbeddedServer`), chỉ spawn các sidecar OpenCode/orchestrator làm child.
- Transport candidates: HTTP+SSE (baseline đã được reference chứng minh), +WebSocket (bidirectional,
  hữu ích cho S3 cancel), Electron-IPC-only (bỏ socket — câu chuyện P7 mạnh nhất nhưng gắn service
  vào shell và làm phức tạp headless testing).

## Decision

### Transport — HTTP + SSE (baseline)

Adopt **HTTP + Server-Sent Events** làm transport baseline giữa UI client và local application
service, và giữa service và OpenCode runtime. SSE hợp với streaming token/step/event một chiều (S2,
EV1–EV7); nó dễ dàng bind-loopback và test được bằng công cụ HTTP thông thường. **Cancel (S3)** là
một HTTP request bình thường từ client tới service (service abort runtime stream), nên không cần
kênh bidirectional cho POC. **WebSocket chỉ được adopt nếu** xuất hiện một nhu cầu
S3/interactive-control mà request/response + SSE không phục vụ gọn gàng được; nó không nằm trong
baseline POC. Electron-IPC-only bị bác (xem Alternatives).

### Placement — Standalone supervised local service process

Adopt một **standalone Node local application service process** (không embed trong Electron main),
được supervise bởi shell (ADR 0004). Lý do, đối chiếu các tiêu chí đã nêu:

- **Invariant "UI là một client của một local application service bound to loopback"** — một
  standalone service là hiện thực đúng nghĩa đen nhất: renderer, shell, và integration test đều là
  các HTTP client ngang hàng của cùng một loopback service; business logic nằm ở đúng một nơi.
- **Headless testability** — service chạy và được test **không cần Electron**, nên UI↔service,
  service↔runtime, permission round-trip, và các test P7 chạy dưới harness Node `--test` không cần
  GUI. Embed trong Electron main sẽ buộc phải có một harness GUI/E2E cho các test boundary.
- **Single-owner lifecycle** — một chuỗi supervision sạch (ADR 0004): shell sở hữu đúng một child
  (service); service sở hữu đúng một child (OpenCode runtime). One owner per child.

Service bind loopback only. Shell với tới nó như một HTTP client (cộng thêm một preload bridge tối
thiểu cho các lời gọi native-only); nó không host business logic.

### Loopback-only (P7)

- Service bind tường minh vào `127.0.0.1` và/hoặc `::1`, **không bao giờ** `0.0.0.0`. Bind
  non-loopback là OOS2 và sẽ đòi hỏi ADR tường minh riêng; nếu thiếu ADR đó, mọi bind non-loopback
  là một defect.
- Port được bind được cấp phát động bằng cách bind **loopback host với port `0`** — tức
  `listen({ host: "127.0.0.1", port: 0 })` (và/hoặc `::1`), rồi đọc ephemeral port được OS gán.
  `port: 0` chọn một port trống; nó **không** mở rộng interface — host luôn là loopback, không bao
  giờ `0.0.0.0` (pattern `findFreePort`/`portAvailable` của reference bind `127.0.0.1`,
  `runtime.mjs:391-417`). Port được gán được ghi vào record `.runtime/pids/*.json` của service
  (ADR 0004).
- Per-instance auth: service phát một token per-launch không đoán được cho các client của chính nó
  (renderer/shell) để một tiến trình local co-resident không thể gọi boundary một cách tầm thường;
  OpenCode child được đặt phía sau một secret Basic-auth per-instance riêng (pattern reference
  `managed-opencode.ts:69-78`), không bao giờ phơi ra renderer.

**P7 acceptance test (choice-independent):**
1. Khi service đang chạy, kết nối tới port của nó từ một **non-loopback interface** (host LAN IP)
   và assert rằng kết nối bị **refused**.
2. Kiểm tra các listening socket (`Get-NetTCPConnection` / `netstat`) và assert rằng service chỉ
   listen **only** trên các địa chỉ loopback.

### Permission Deny — explicit reply, no stuck runtime (UX HIGH / runtime cancel)

Một **Deny** phải gửi một **explicit deny reply** trở lại runtime để unblock permission request
đang treo của nó và đưa session về một **actionable terminal/error state**. Nó dùng đường
permission-reply / `abortSession` của OpenCode. Một Deny KHÔNG ĐƯỢC âm thầm drop hoặc không-bao-giờ
forward reply: làm vậy sẽ để runtime chờ mãi mãi. "Deny blocks the action on disk" vẫn đúng (enforce
tại boundary, ADR 0006/§5 của design doc), **và** reply hướng-runtime là tường minh nên không session
nào bị treo. (Xem cách diễn đạt đã sửa trong `cowork-ghc-implementation-design.md` §5.)

### SSE reconnect + authoritative snapshot resync (frontend MED-1)

Service phơi một **state-snapshot / resync endpoint**. Khi SSE reconnect, client re-sync
**authoritative server state** từ endpoint này thay vì replay event-sourcing phía client. Điều này
bảo toàn single-source-of-truth và ngăn một client đang reconnect hiển thị state
`waiting`/`completed` cũ sau một stream bị rớt.

### EV event / client-state contract (frontend MED-2)

Boundary định nghĩa một shape cấp-contract: các **EV event type** và **tập terminal-state** khiến
EV1–EV7 / S6 trung thực (ví dụ `completed`, `errored`, `cancelled`, `denied`). Contract này là
**bề mặt load-bearing mà L5 phải đặc tả đầy đủ**. UI không bao giờ render một state `completed` giả;
một session là `completed` chỉ khi terminal event của contract nói vậy.

### Two-hop SSE streaming — coalescing / backpressure

Streaming đi qua hai hop (OpenCode → service → renderer). Mỗi hop áp dụng một contract
**coalescing / backpressure / re-render** để token streaming không làm ngập UI thread
(batch/tick-coalesce token; drop-to-latest cho progress tần suất cao; không bao giờ force re-render
per-token). Đây là phần đồng hành cấp-transport của frontend streaming rule.

## Consequences

- Positive: boundary sạch nhất + câu chuyện headless test mạnh nhất; shell-neutral (hỗ trợ điều
  kiện xem lại Tauri của ADR 0002); chuỗi supervision single-owner.
- Negative: thêm một supervised process so với mô hình embedded, và tồn tại một socket (loopback)
  thực — được giảm thiểu bởi bind loopback tường minh + token per-launch + P7 test.
- SSE-only nghĩa là S3 cancel là request-driven; chấp nhận được cho POC và có thể mở lại qua
  WebSocket nếu cần.

## Alternatives considered

- **Embedded-in-Electron-main (mô hình reference)** — bị bác cho POC: câu chuyện
  P7-by-no-socket mạnh nhất nhưng gắn service vào shell, làm yếu headless testability, và làm mờ
  invariant "UI là một client của một local service". (Nó vẫn là fallback nếu standalone process tỏ
  ra tốn kém về vận hành.)
- **+WebSocket now** — bị bác làm baseline (nhiều bộ phận chuyển động hơn mức S3 cần); chỉ adopt
  khi có nhu cầu interactive-control đã được chứng minh.
- **Electron-IPC-only / named pipes / UDS** — bị bác: IPC-only gắn service vào shell và phá vỡ
  headless testing; ergonomics named-pipe của Windows nặng hơn và ít thân thiện test hơn một
  loopback port (`desktop-shell-and-lifecycle.md` §3).

## Requirements traceability

| Requirement | How this ADR satisfies it |
|---|---|
| P7 | Loopback-only bind + per-launch token + explicit non-loopback-refused / loopback-only-socket test. |
| S2 | SSE streaming of tokens/steps without blocking the UI. |
| S3 | Cancel = HTTP request → service aborts the runtime stream (no WebSocket needed). |
| EV1–EV7 | Real runtime events carried over SSE and mapped at the service boundary. |
| "UI is a client" invariant | Standalone loopback service; UI/shell/tests are equal HTTP clients. |

## Resolved at L4

- **Permission Deny (UX HIGH / runtime cancel):** Deny gửi một explicit deny reply
  (permission-reply / `abortSession`) unblock runtime và đưa session về terminal state; nó không
  bao giờ bị âm thầm drop. Deny vẫn block trên disk.
- **Reconnect resync (frontend MED-1):** một state-snapshot / resync endpoint re-sync authoritative
  server state khi SSE reconnect.
- **EV contract (frontend MED-2):** EV event type + tập terminal-state được định nghĩa như bề mặt
  load-bearing mà L5 phải đặc tả đầy đủ; không có `completed` giả.
- **Two-hop streaming:** thêm contract coalescing/backpressure/re-render.
- **MED-1 token distinction:** boundary client token (một secret per-launch) là **distinct** với
  supervision identity của ADR 0004 (tuple PID/start-time/exePath/port không-secret); trust boundary
  single-user, single-machine được ghi ở đây và trong ADR 0004.

## Open items carried to L5/L6

- Xác nhận standalone vs embedded (đây là placement call load-bearing).
- Xác nhận baseline SSE-only (WebSocket hoãn) là chấp nhận được cho S3.
- Đặc tả đầy đủ EV event / terminal-state contract, shape của resync endpoint, và các tham số
  coalescing (L5).
