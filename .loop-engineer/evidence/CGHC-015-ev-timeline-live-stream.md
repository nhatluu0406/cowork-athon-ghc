---
task: CGHC-015
title: "EV timeline UI + live SSE stream (EV1–EV7, S6) — honest render, no fake completed, no secret/stack leak"
language: "vi"
status: DONE
created_at: "2026-07-11"
---

# CGHC-015 — Bằng chứng EV timeline UI + luồng SSE trực tiếp

## 1. Phạm vi giao (hai nửa: service transport + renderer UI)

Hoàn tất phần LIVE SSE mà CGHC-014 để lại (carry-forward MEDIUM: chỉ nửa snapshot/resume
được mount) + renderer timeline trung thực EV1–EV7 + tiêu thụ luồng ở renderer.

### Service transport (`service/src/server/`, `service/src/execution/`)
- `session-stream-hub.ts` — `SessionEventSource` (`view`/`subscribe`) + `createSessionStreamHub`
  gắn với session registry; nguồn phát EV cho route trực tiếp.
- `session-stream-route.ts` — `GET /v1/session/stream?sessionId&sinceSeq` là route STREAMING
  token-guarded: sau cổng token fail-closed, handler SỞ HỮU response (SSE headers + frame EV
  coalesced + heartbeat) tới khi terminal hoặc client ngắt. Không bao giờ bọc envelope. Dedupe
  theo `sinceSeq` (bỏ `seq <= sinceSeq`) → terminal giao đúng một lần (qua snapshot HOẶC live).
  Đã terminal lúc kết nối → mở rồi đóng ngay (không keep-alive giả). Ngắt kết nối → teardown
  subscription + heartbeat qua `SseWriter.onClose`.
- `sse-writer.ts` — `createSseWriter` (open/write/end/fail/onClose); loopback, không CORS.
- `router-registry.ts` — SEAM mount cho boundary: từ chối trùng `method+path`, và mọi route
  opt-out token (`publicUnauthenticated`) đều bị AUDIT (đóng lỗ bypass token). Đây là viên gạch
  cho COMPOSITION ROOT.
- Dispatcher (`http-service.ts`) phân nhánh `isStreamingRoute` SAU cổng token → trao `SseWriter`.

### Renderer UI (`app/ui/src/`)
- `timeline-view.ts` — render THUẦN của `SessionView` (fold qua `reduceEv`); DOM bằng
  `textContent` (không `innerHTML`); marker terminal CHỈ khi `view.terminal !== null` (EV7 —
  không bịa "hoàn thành"); vùng lỗi (EV6) đi qua `sanitizeErrorMessage` + nút recovery điều
  hướng được bằng bàn phím; ARIA `role=status/alert`, `aria-live`. Cập nhật tăng dần: chỉ dựng
  lại một danh sách khi slice của nó đổi tham chiếu → token-only chỉ chạm node text (không thrash).
- `ev-stream-client.ts` — snapshot-first (`EV_SNAPSHOT_PATH`) rồi live SSE (`EV_STREAM_PATH`) từ
  `sinceSeq = resumeSeq`; fold từng frame qua `reduceEv`; coalesce render (một `onView`/tick);
  teardown `AbortController`; token chỉ ở header `Authorization: Bearer`, KHÔNG vào DOM/log.

## 2. Acceptance → test

- **EV1–EV4 render trung thực**: chuỗi plan→tokens→tool→file→terminal dựng đúng cấu trúc
  (todo/step/tool/file mutation có path) — `timeline-view.test.ts`.
- **EV6 không rò secret/stack**: positive control (secret `sk-FAKE…` + JWT `access_token=eyJ…`
  + chuỗi giống stack CÓ trong event thô) → KHÔNG xuất hiện trong `outerHTML`; có nút recovery.
- **EV7 không bịa completed**: chuỗi không terminal → DOM không có trạng thái hoàn thành; terminal
  thật → hiện đúng một lần; "first terminal wins" (terminal sau không ghi đè).
- **Token không render**: sau snapshot→stream→terminal, token 64-hex không có trong DOM.
- **Slow-consumer R7 ở mức SOCKET**: `session-stream-live-e2e.test.ts` dựng server thật + socket
  thật: token-guard fail-closed (401/403/200), backpressure (600 delta thô → 2 frame token,
  plan/tool/terminal không rớt), terminal đúng-một-lần-và-cuối, dedupe `sinceSeq`, đã-terminal
  đóng ngay, ngắt kết nối teardown (unsubscribe + clear heartbeat) — mọi await có timeout, không
  chờ giây thực (inject interval scheduler).

## 3. Review độc lập (reviewer ≠ implementer) → 3 HIGH, 0 Critical → ĐÃ SỬA + tái kiểm

### UX/performance (ux-performance-reviewer)
- **HIGH-1 (ĐÃ SỬA)**: EOF sạch KHÔNG có terminal (service restart/proxy/ngủ/mất mạng) khiến UI
  kẹt "đang chạy" mãi mãi, không lỗi, không recovery — vi phạm honest-visibility. Sửa: khi reader
  kết thúc mà `view.terminal === null` và không phải `stop()` chủ động → `surfaceDisconnect()`
  bơm lỗi client-side "Mất kết nối luồng sự kiện." + recovery `retry`; `reconnect()` chạy lại
  snapshot→`sinceSeq`. `stop()` chủ động thì KHÔNG hiện lỗi. Có test EOF-trước-terminal + test
  click recovery reconnect.
- MEDIUM-1 (sửa): guard `renderStatus` (không viết lại live-region mỗi token). MEDIUM-2 (sửa):
  tương phản dark-mode `--err`/`--ok` đạt AA. MEDIUM-4 + LOW-1 + LOW-S4 (sửa): release reader khi
  terminal, `signal` cho snapshot fetch, chặn buffer SSE 1 MiB. MEDIUM-6 (sửa): thêm test
  node-identity (no-thrash), coalescing async, stop() teardown.

### Security co-sign (security-reviewer)
- **HIGH-S1 (ĐÃ SỬA)**: message lỗi EV là văn bản tùy ý từ provider/runtime; trước đây CHỈ có
  scrubber phía UI redact — `SecretScrubber` value-based của service không được áp. Sửa: tạo module
  browser-safe dùng chung `sanitizeErrorMessage` (`service/src/execution/error-sanitize.ts`) và áp
  NGAY TẠI mapper (điểm nghẽn duy nhất) cho `ErrorEvent.message` (và message của terminal
  `cancelled`) → cả luồng live LẪN snapshot đều được redact server-side. Thêm SEAM inject
  `redactError` để COMPOSITION ROOT nạp scrubber value-based (redact theo GIÁ TRỊ khóa thật, độc
  lập hình dạng) = `(msg) => sanitizeErrorMessage(secretScrubber.scrub(msg))`.
- **HIGH-S2 (ĐÃ SỬA)**: pattern scrubber có lỗi word-boundary (`access_token=`/`refresh_token=`
  lọt) + thiếu nhiều lớp khóa. Sửa trong module dùng chung: bắt `(?:access|refresh|id|auth|api|
  client)?[_-]?(?:token|key|secret|password)[=:]…`, thêm `ghp_`/`github_pat_`/JWT/`AKIA`/Slack
  `xox…`/Google `AIza…`/Bearer/base64, giữ hex 32+; quantifier có chặn trên + cap input 20k/output
  2k (chống backtracking/DoS). 5 test positive-control + test strip stack `\r\n`.
- MEDIUM-S3 (sửa): thêm test redaction đi qua UI (64-hex + `access_token=<jwt>` không tới DOM).
- **LOW-S5 (ĐÃ SỬA)**: hằng route `EV_SNAPSHOT_PATH`/`EV_STREAM_PATH` chuyển về
  `@cowork-ghc/contracts` (một nguồn), server routes + UI cùng import (bỏ khai báo trùng ở UI).

Xác nhận PASS: cổng token fail-closed TRƯỚC mọi byte SSE (chứng minh ở socket), không sink XSS
(`textContent`), token không tới DOM/log, không đường bịa completed. Một nguồn chân lý: UI xóa
`ev-error-scrub.ts` cục bộ, import `sanitizeErrorMessage` từ `@cowork-ghc/service/execution`.

## 4. Kiểm chứng

- Full suite: **402 pass / 0 fail / 0 skip**; `tsc -b` sạch. File nguồn < 250 dòng.
- E2E socket: 6/6 pass. UI tests: 14 pass (8 gốc + 6 mới). Redaction service: 10 pass.
- Grep xác nhận UI không còn regex secret/hằng route cục bộ.

## 5. Carry-forward (đã ghi nhận, KHÔNG chặn DONE)

- **COMPOSITION ROOT**: nạp `SecretScrubber` value-based vào `redactError` của `createEvMapper`
  (nửa bền của HIGH-S1); mount route live-stream + snapshot qua `RouterRegistry` gắn `SessionStreamHub`.
- **CGHC-025** (renderer hardening): (a) EV5 render tiến độ dài (reducer/`SessionView`/contracts chưa
  surface `ProgressEvent.label/ratio`; docstring đã sửa cho trung thực + đánh dấu deferred); (b)
  MEDIUM-5 — `textEl.textContent = view.text` tái tuần tự O(N²) trên output dài → append delta /
  gộp theo `requestAnimationFrame`.
