---
task: CGHC-014
title: "Two-hop SSE streaming: coalescing/backpressure + snapshot/resync (S2, EV5, R7)"
language: "vi"
status: DONE
created_at: "2026-07-11"
---

# CGHC-014 — Bằng chứng two-hop SSE streaming

## 1. Phạm vi

Hop 1 (runtime OpenCode `/event` → service) đã có ở CGHC-012 (mapper) + CGHC-013 (registry).
Task này làm **hop 2** (service → renderer) với hợp đồng **coalescing/backpressure** để token
streaming (S2) không làm nghẽn UI thread (risk R7), cộng **snapshot/resync** để stream rớt không
để lại view `waiting`/`completed` cũ, và **EV5** tiến độ chạy dài.

## 2. Thành phần (`service/src/execution/` + `service/src/server/`, mọi file < 250 dòng)

- `stream-coordinator.ts` (165) — core thuần, transport-agnostic: gộp token liên tiếp vào MỘT
  accumulator, flush khi hết window (mặc định 40ms, inject) hoặc chạm count-cap (48); mọi kind
  đổi-trạng-thái (plan/step/tool_call/file_mutation/progress/error/terminal) flush token đang chờ
  TRƯỚC rồi phát ngay. `terminal` là phát cuối; noise sau terminal bị bỏ; không bịa/không đảo.
- `session-resync.ts` (47) — `planResync(view, clientLastSeq)`: snapshot authoritative + `resumeSeq`.
- `progress-ticker.ts` (62) — EV5 ticker theo interval (không busy-loop), dừng ở terminal.
- `session-stream.ts` (149) — hop-2 core: raw frame → `createEvMapper` → `apply` (registry) →
  coordinator → `emit`; apply-TRƯỚC-emit nên snapshot không bao giờ tụt sau cái renderer đã thấy;
  `close()` flush token đang chờ + huỷ mọi timer (không leak).
- `ev-sse.ts` (đã tăng cường) — khung SSE `data:`/blank-line; decode fail-safe.
- `server/ev-stream-router.ts` (93) — `GET` snapshot có **token guard** (401 khi thiếu token),
  không bịa view cho session lạ, payload không secret.

## 3. Chính sách coalescing/backpressure (đảm bảo)

Token gộp vào một buffer duy nhất (5000 delta → 1 emission trong test) ⇒ buffering có chặn, consumer
chậm không gây phình vô hạn/không mất event đổi-trạng-thái. Thứ tự được giữ (token luôn seq thấp hơn
event trạng thái kế tiếp; flush token trước). `terminal` finality: sau terminal mọi push bị bỏ.

## 4. Resync hội tụ

Client trình `seq` cuối; `planResync` trả `SessionView` fold hiện tại làm snapshot client **nhận trọn**,
`resumeSeq = lastSeq`. Nên: terminal đã lỡ có trong snapshot (không mất), `running/waiting/completed`
cũ bị ghi đè, event live `seq > resumeSeq` áp sạch, tail gửi lại `seq <= lastSeq` bị reducer bỏ idempotent
(không double terminal). Client "vượt trước" bị kéo về authoritative.

## 5. Review độc lập (ux-performance-reviewer ≠ implementer) → PASS, 0 Critical/High

Xác nhận ordering, terminal finality, coalescing có chặn, resync hội tụ — test virtual-time có phủ
định thật (terminal giữa burst token, client-ahead). Findings:

- **MEDIUM (accepted boundary) → carry-forward CGHC-015**: response SSE dài-hạn (nửa live của hop 2)
  CHƯA mount vì dispatcher boundary (`http-service.ts`, orchestrator-owned) ghi một envelope JSON/handler,
  không trao `ServerResponse` để stream. Đã giao: core transport-agnostic + `encodeEvSseFrame`/
  `encodeSseHeartbeat` + `close()`; nửa snapshot/resume đã live qua endpoint có token-guard. CGHC-015
  phải: nối `createSessionStream` vào response SSE dài-hạn + **test E2E slow-consumer** (kiểm R7 ở tầng
  socket thật trước L9) + chặn cadence của progress ở tầng transport.
- **LOW → ĐÃ SỬA**: `isEvEvent` chỉ kiểm `kind`/`seq`/`sessionId` ⇒ nhận `terminal` thiếu `state`.
  Đã thêm kiểm field bắt buộc theo kind (terminal→state hợp lệ, token→delta string, error→message
  string) để đúng cam kết "corrupt không bịa được EV". Test thêm: terminal thiếu/`state` lạ + token
  thiếu delta bị bỏ; terminal hợp lệ vẫn decode.
- **LOW → ĐÃ SỬA**: thêm test `close()` giữa window (flush token + `scheduler.pending()===0`, không leak).

## 6. Kiểm chứng

- New streaming tests (sau fix): 10 pass ở coalesce+sse-frame; toàn bộ streaming suite 19→21 test.
- Full repo tại thời điểm land CGHC-014: **273 pass / 0 skip / 0 fail**, `tsc -b` sạch (full re-verify
  cuối cùng chạy lại sau khi CGHC-018 land để tránh compile giữa lúc agent song song ghi file).
- Carry-forward CGHC-015: mount SSE dài-hạn + E2E slow-consumer + bound progress cadence.
