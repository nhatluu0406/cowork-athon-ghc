---
task: CGHC-016
title: "Permission enforcement tại execution boundary (P1/P3/P4/P5/P6)"
language: "vi"
status: DONE
priority: CRITICAL
created_at: "2026-07-11"
---

# CGHC-016 — Bằng chứng permission enforcement

## 1. Bất biến bảo mật (load-bearing)

Không hành động nào được gated đi qua nếu **chưa có một quyết định Allow được ghi nhận và còn
hiệu lực**; một Deny (tường minh hoặc fail-closed) **thực sự chặn**. Enforcement nằm ở **gate**, không
phải UI — một object quyết định KHÔNG phải là uỷ quyền.

## 2. Thành phần (`service/src/permission/`, mọi file < 250 dòng)

- `permission-gate.ts` (220) — `createPermissionGate`: nguồn chân lý duy nhất cho request pending.
  `proceed(requestId, perform)` là điểm enforce THẬT: chỉ chạy callback khi state = `allowed`;
  từ chối với unknown/pending/expired/denied/đã-tiêu-thụ. `once` bị tiêu thụ sau một lần proceed.
- `ports.ts` — seam provider-neutral: `RuntimeReplyPort` (reply ra runtime), `SessionDenialSink`
  (đưa session về terminal), `PermissionAuditSink`/`PermissionAuditEvent` (P5), `TimerScheduler` (P6).
  Tách seam INBOUND (`submit`) và OUTBOUND (`reply`); mô hình hoá POST reply của runtime mà không
  hard-wire HTTP OpenCode (adapter live để dành CGHC-018).
- `approval-level.ts` — `classifyApprovalLevel` (P4): `file_delete`/`command_exec`/`file_move` →
  `elevated`; `file_create`/`file_edit` → `standard` (exhaustive `never`). Gate **tự tính lại** level
  khi `submit`, bỏ qua giá trị client gửi (client không thể hạ cấp một delete).
- `audit.ts` — `createInMemoryAuditSink` (P5), chỉ lưu event có cấu trúc.
- `session-denial.ts` — adapter bắc gate lên session CGHC-013 (fold `denied` TerminalEvent),
  idempotent theo "first terminal wins"; `noopSessionDenialSink` cho wiring headless.
- `timer.ts` — `createNodeScheduler` (timer thật, `unref`) sau seam injectable.
- `index.ts` — barrel cho CGHC-017 (UI) + CGHC-018 (file mutation).

## 3. Ánh xạ acceptance → cơ chế → test

| Acceptance | Cơ chế | Test |
|---|---|---|
| P1 — request phát sinh tại boundary | Chỉ vào qua `submit` (inbound port); gate không tự bịa request; validate requestId/sessionId | mọi test qua `submit` |
| P3 — Deny chặn trên đĩa + reply tường minh + không strand | `proceed` từ chối sau deny; `finalizeDeny` ghi denied + audit + `denySession` TRƯỚC khi await reply; session THẬT về `denied` | `permission-deny-no-strand` |
| Bypass bị chặn | `proceed` từ chối unknown/pending/expired/denied; `once` tiêu thụ | `permission-bypass-blocked` |
| P6 — fail-closed | Timer arm khi submit; hết timeout → auto-deny + reply deny + session terminal + audit `fail_closed_timeout`; Allow muộn KHÔNG hồi sinh (guard `status !== pending`) | `permission-fail-closed` |
| P4 — approval level | Gate tính lại từ action kind; client spoof `standard` cho delete → ghi `elevated` | `permission-round-trip` |
| P5 — audit không secret | Event chỉ mang field cấu trúc; `action.description` (free-form) KHÔNG được copy | `permission-round-trip` (secret trong description vắng mặt trong audit) |

## 4. Chống fail-open / TOCTOU (đã xác minh trong review)

- `resolve` cancel timer + ghi state đồng bộ TRƯỚC `await` đầu tiên; JS đơn luồng ⇒ timer
  fail-closed không thể chen giữa.
- Deny tường minh: nếu transport reply ném lỗi, state đã `denied` rồi; lỗi **propagate lên caller**
  (không nuốt). Fail-closed: lỗi transport route qua `onReplyError`, state vẫn denied.
- Duplicate `requestId` bị ném lỗi ⇒ không reset/kéo dài được timer.

## 5. Review độc lập (security-reviewer ≠ implementer runtime-llm-engineer) → PASS, 0 Critical/High

- Xác nhận: không bypass, không TOCTOU, không fail-open, không rò secret; không truy cập
  fs/credential/network; timer `unref`; không nuốt lỗi. Test không green-wash (đều assert mặt phủ định).
- **LOW-1 (coverage) — ĐÃ SỬA**: thêm test "explicit Deny khi transport reply ném lỗi" (dùng
  `failingReplyPort`): `resolve` reject, action vẫn bị chặn, session denied, audit ghi deny.
- **LOW-2 (defensive) — carry-forward CGHC-018**: `onReplyError` mặc định log raw error; adapter
  OpenCode live phải cung cấp reporter redact + đảm bảo lỗi transport không mang credential.
- **LOW-3 (resource) — follow-up**: map `states` chưa evict (giữ cả entry terminal). Không phải
  bypass (retention hỗ trợ audit); cân nhắc TTL/eviction cho entry terminal ở service chạy dài.

## 6. Kiểm chứng

- Permission suite: **18 pass / 0 fail / 0 skip** (17 + LOW-1). `tsc -b` sạch (đã xác minh trước khi
  các agent song song ghi thêm).
- Seam để lại: adapter OpenCode `requestId → POST /session/{id}/permissions/{permissionID}` cho
  CGHC-018; UI tiêu thụ `gate.pending()` cho CGHC-017; `waiting_approval` cần một EV kind trong
  contract (không sửa contract trong task này) — ghi nhận cho vòng UI.
