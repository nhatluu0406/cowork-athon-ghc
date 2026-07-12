---
task: CGHC-017
title: "Permission prompt UI — Allow/Deny modal mapped to real execution-boundary enforcement (P2/F5)"
language: "vi"
status: DONE
created_at: "2026-07-11"
---

# CGHC-017 — Bằng chứng Permission UI (modal Allow/Deny)

Hai lớp: transport service (permission router → PermissionGate) + modal UI. Deny ở UI ánh xạ tới
CHẶN thật ở biên thực thi (`gate.proceed`), KHÔNG phải xử lý UI-only.

## 1. Part A — transport service (`service/src/permission/router.ts`, mount trong composition)

- `createPermissionRouter(gate)` token-guarded (không `publicUnauthenticated`):
  - `GET /v1/permission/pending` → `SuccessEnvelope<{pending: PendingPermissionView[]}>`; projection
    NON-SECRET map tường minh: `requestId`, `sessionId`, `approvalLevel`, `requestedAt`,
    `action:{kind, description, targetPath?}` (không spread raw state).
  - `POST /v1/permission/decision {requestId, decision, scope?}` → `gate.resolve(...)`; outcome trung
    thực: `resolved` (200) | `already_resolved` (200, idempotent — allow trễ KHÔNG ghi đè deny) |
    `unknown` (404, không bịa success). Body validate ở biên (`PermissionRequestError` extends
    `BadRequestError` → 400, không 500).
  - Route KHÔNG tự thực hiện mutation — chỉ ghi quyết định; CHẶN/CHO PHÉP ở `gate.proceed` (biên thực thi).
- Mount vào `compose-service.ts` trên CÙNG một `permissionGate` (không authority thứ hai).

## 2. Part B — modal UI (`app/ui/src/permission-modal.ts` + `permission-controller.ts`)

- Modal `role=dialog aria-modal` labelled: P2 render `action.kind` (thuật ngữ người đọc) + `description`
  + `targetPath`; P4 `approvalLevel` (elevated có cảnh báo bằng CHỮ + viền, không chỉ màu — WCAG 1.4.1);
  F5 mô tả người-đọc + slot diff labelled ẩn (KHÔNG bịa diff khi projection chưa mang diff content).
- Fail-safe: ESC + backdrop → Deny; KHÔNG có đường dismissal→Allow; nút `type=button` không form nên
  Enter không submit ngầm; focus mặc định trên Deny; focus trap Tab/Shift-Tab; focus phục hồi khi đóng.
- Controller (transport + lifecycle, business logic ngoài view): poll `pending`, hiện head; POST decision;
  outcome `already_resolved`/`unknown` → note trung thực (không "hoàn thành/thành công/granted"); idle
  (0 pending) → không modal; token chỉ ở header, không vào DOM.

## 3. Acceptance → test

- **P2**: modal có Allow+Deny, kind/description/targetPath; elevated đánh dấu.
- **F5**: description luôn hiện; diff slot present-but-hidden khi chưa có diff.
- **Deny ánh xạ enforcement thật**: (service) `composition-loopback-e2e` — POST deny qua HTTP →
  `gate.proceed` trả `not_allowed`, file KHÔNG được tạo trên đĩa, deny audited; allow `once` cho proceed
  chạy đúng một lần. (UI) controller test — click Deny phát POST `{requestId, decision:"deny"}` đúng payload.

## 4. Review độc lập x2 (reviewer ≠ implementer) → CẢ HAI PASS, 0 Critical/High/Medium

- **Security co-sign PASS**: không phá được "enforcement ở biên, không ở UI" và "deny không thể bị gỡ chặn":
  `proceed` chỉ chạy khi `allowed`; once-allow consumed; unknown/spoof requestId không tạo allow; allow trễ
  sau deny → `already_resolved` giữ deny; `finalizeDeny` ghi+audit trước reply; reply-fail report-and-swallow
  (không strand/500). Token không vào DOM; route token-guarded fail-closed; mount một lần. 2 Info (targetPath
  cố ý hiện path trong workspace đã cấp; once-allow consumed sau khi `perform` trả về).
- **UX/perf PASS**: fail-safe (không dismissal→Allow) + focus management đúng và có test; a11y (dialog/aria/
  trap/restore, elevated không chỉ-màu, tương phản AA sáng+tối). 5 LOW → ĐÃ SỬA.

## 5. LOW fixes (đã áp, app/ui)

- L1 (honesty): outcome `resolved` khác lựa chọn người dùng → note trung thực. L2: POST decision lỗi →
  giữ note lỗi khi modal mở lại (không xóa), request vẫn pending/chặn. L3 (test): lifecycle poll start()/
  stop() (timer seam fake, không chờ thật). L4 (test): Shift-Tab reverse wrap + Enter/Space trên Deny fail-safe.
  L5 (UX): chỉ báo "Còn N yêu cầu đang chờ" khi >1 pending (số thật, giảm dần).

## 6. Kiểm chứng

- Full suite: **452 pass / 0 fail / 0 skip** (ổn định 2 lần). `tsc -b` sạch. Source < 250 dòng.
- Permission UI tests 28 pass; service permission-router + composition deny-enforcement pass.

## 7. Carry-forward

- **F5 full diff**: projection hiện mang `description`/`targetPath`, chưa mang diff content → làm giàu ở
  runtime (Tier 2). Modal đã sẵn slot, không bịa.
- **CGHC-025**: gate poll theo session/`visibilitychange` (Info: hiện poll loopback 2s vô điều kiện suốt
  vòng đời app); thêm `aria-describedby` cho dialog.
