---
task: CGHC-018
title: "File mutation qua boundary + audit + no-escape (F1/F2/F3/F6/P5)"
language: "vi"
status: DONE
priority: CRITICAL
created_at: "2026-07-11"
---

# CGHC-018 — Bằng chứng file mutation + audit

## 1. Bất biến bảo mật

(1) Không thao tác file nào thoát khỏi workspace được cấp — chặn tại boundary, **re-validate trên
real path đã resolve** cho mọi tool event; (2) Deny/chưa-duyệt ⇒ KHÔNG mutation trên đĩa; (3) mutation
chỉ chạy sau một Allow được ghi (qua `PermissionGate.proceed`); (4) audit không secret; (5) reply
adapter live không rò credential trong lỗi/log.

## 2. Thành phần (`service/src/files/`, mọi file < 250 dòng)

- `file-service.ts` (167) — bề mặt DUY NHẤT chạm filesystem. Mọi read/create/edit/delete/move đi qua
  `WorkspaceGuard.assertRealPathInside` TRƯỚC khi chạm đĩa; mọi mutation chạy trong
  `gate.proceed(requestId, …)`. `FsPort` inject được (mặc định `node:fs/promises`).
- `tool-permission-proxy.ts` (185) — map tool OpenCode → `PermissionActionKind` (fail-closed với tool
  lạ), re-validate target (escape ⇒ refuse + deny TRƯỚC khi chạm đĩa), submit vào gate; move validate
  CẢ HAI đầu.
- `runtime-permission-proxy.ts` (118) — `createLiveRuntimeReplyPort`: adapter HTTP LIVE cho
  RuntimeReplyPort (`POST …/permission/{requestID}/reply`, endpoint inject được); transport mỏng;
  đường lỗi redact; chỉ rethrow `RuntimeReplyError` cố định không secret.
- `reply-redaction.ts` (57) — scrub generic `Bearer …` + `scheme://…` TRƯỚC, rồi exact-secret
  (base URL/token) longest-first ⇒ URL bị mask nguyên khối, không để lại phần đuôi path.
- `errors.ts` (52) — `FileOperationError` + `mapDiskError` strip errno/stack/abs-path.

## 3. Acceptance → test

| Acceptance | Test |
|---|---|
| F1 qua-service + UI-không-ghi-fs | `files-mutation` (create/edit chỉ chạy trong proceed) |
| F3 delete chỉ khi duyệt; chưa-duyệt/deny xoá KHÔNG gì; approved delete audit elevated | `files-mutation` (denied/pending/approved delete) |
| F6 assert bytes trên đĩa | mọi test mutation đọc `readFile`/`stat` trên temp thật |
| F2 move dưới permission | `files-mutation` (approved move di dời; denied move giữ nguyên 2 đầu) |
| No-escape real-path | `files-tool-proxy` (`..` + junction/symlink escape refuse+deny+audit; secret ngoài không chạm) |
| P5 audit không secret | `files-audit-no-secret` (secret trong description vắng ở cả 2 audit store) |
| LOW-2 reply adapter redact | `files-reply-redaction` (URL+bearer trong lỗi transport không tới reporter; rethrow không secret) |

## 4. Review độc lập (security-reviewer ≠ implementer) → PASS, 0 Critical/High

Xác nhận: không fs call nào bỏ qua guard; deny/pending/unknown/expired không chạm đĩa; proxy fail-closed
với tool lạ; audit không rò secret (thử `sk-live-…` trong description); redactor generic-first chặn rò
path/permission-id; `RuntimeReplyError` cố định không secret. Reviewer xác nhận nhánh junction escape
THẬT sự chạy trên máy này (không green-wash). Deferral CGHC-028 (round-trip OpenCode live) được đánh giá
**chấp nhận**: transport inject + `mapResponse`/endpoint unit-tested; redaction generic + exact backstop.

**Findings (LOW, non-blocking):**
- **LOW-3 — ĐÃ SỬA**: test symlink-escape trước đây có thể im lặng no-op nếu không tạo được junction.
  Đổi sang `t.skip(reason)` trung thực (không giả pass); trên máy này test CHẠY và assert.
- **LOW-1 (carry-forward hardening)**: TOCTOU khi `create` — `writeFile(realPath)` có thể theo symlink
  cắm ở leaf giữa check và write (leaf chưa tồn tại nên realpath không resolve leaf như link). Rủi ro
  dư rất thấp (leaf symlink tồn tại bị bắt ở check; vector cắm in-app duy nhất là `command_exec` đã
  duyệt = RCE). Hardening đề xuất: mở leaf với `wx`/`O_EXCL` hoặc `O_NOFOLLOW`/`fstat`-sau-open (lưu ý
  Windows). Ghi nhận follow-up, không blocking.
- **LOW-2 (carry-forward, approval-tier)**: `create` ghi đè file đang tồn tại chỉ dưới approval
  `standard` trong khi `file_move` được `elevated` với lý do "có thể ghi đè/huỷ target". Cân nhắc
  elevate create-ghi-đè hoặc phân biệt create-new vs overwrite. Ghi nhận cho vòng hardening/UI.
- **LOW-4 (carry-forward, coverage)**: thiếu test overwrite-chưa-duyệt-giữ-nguyên và move escape chỉ ở
  SOURCE (destination-only đã có) — được phủ generic qua guard, là gap coverage.

## 5. Kiểm chứng

- Full suite: **325 pass / 0 fail / 0 skip**; `tsc -b` sạch. Files 35–185 dòng (< 250).
- Live round-trip OpenCode ⇒ deferred CGHC-028 (adapter đánh dấu not-yet-live-tested).
