---
title: "CGHC-023 — clean.bat allowlist + safety guards — bằng chứng"
document_type: "implementation-evidence"
language: "vi"
task: "CGHC-023"
loop: "L6"
requirement: "LC4"
---

# CGHC-023 — clean.bat allowlist

## Đã xây dựng

- `tools/loop-engineer/clean.mjs` (~225 dòng, zero-dependency ESM) — SINGLE source of truth cho clean:
  validate manifest, assess allowlist (reject absolute/UNC/drive/traversal/root trên RAW string trước
  normalize), root-certainty (4 marker riêng của project), running-guard (identity Win32 CreationDate
  qua `liveRecords`, không phải bare PID), xóa có guard chống symlink-escape. Exit code trung thực,
  không bao giờ always-0.
- `tools/loop-engineer/lifecycle.mjs` — `cmdClean` delegate sang `clean.mjs cleanCommand` (inject
  `log` + seam `isRunning` identity-verified); re-export `normRel`/`assessCleanTarget`/`resolveCleanTargets`
  để `lifecycle.test.mjs` giữ nguyên. KHÔNG thêm surface `clean` thứ hai vào `cli.mjs` (tránh hai entry
  cho một thao tác hủy — đúng rule no-duplicate lifecycle logic; `cli.mjs` không bị sửa).
- `scripts/cleanup-manifest.json` (đã có, đúng; `preserve` là superset của protected set),
  `scripts/clean.bat` (thin `%~dp0`, preview → confirm mặc-định-No → `--yes` mới xóa thật, propagate
  exit code, no admin/policy/download/fake-success), `scripts/README.md` (bảng exit-code).

## Bảng exit code

| Code | Nghĩa |
|------|-------|
| 0 | success / no-op / dry-run preview |
| 2 | INVALID_MANIFEST (thiếu/malformed, hoặc entry absolute/UNC/drive/traversal — refuse trước khi xóa) |
| 4 | RUNNING (Cowork GHC đang chạy — check trước mọi thao tác xóa) |
| 6 | ROOT_UNCERTAIN (không chứng minh chắc chắn root) |
| 7 | DELETE_FAILED (file locked, symlink-escape, hoặc junction-onto-protected) |

## Test — lệnh + kết quả thật

```
node --test tools/loop-engineer/tests/*.test.mjs   # tests 77  pass 77  fail 0
node tools/loop-engineer/cli.mjs verify            # verify: PASS
```

`clean.test.mjs` (22 test): manifest validation; allowlist + non-allowlisted/preserve-overlap refusal;
absolute/UNC/bare-drive rejection (whole-run refuse, 0 xóa); traversal refusal; running→exit 4;
root-uncertain→exit 6 (manifest chưa cả load); missing-manifest→nonzero; dry-run mặc định; happy path
xóa đúng allowlisted-existing; symlink-escape→DELETE_FAILED; delete-fail→nonzero; **HIGH-1** case-variant
(`Docs`/`.GIT`/`CLAUDE.MD`…) bị preserve trên Windows + không tới `rm`; **MEDIUM-1** junction in-root trỏ
lên protected path bị từ chối ở realpath time.

## Review độc lập (security-reviewer ≠ owner) + xử lý

**Ban đầu CHANGES_REQUIRED** (1 HIGH + 1 MEDIUM + 1 LOW). Reviewer TỰ dựng được manifest entry xóa
protected path → hợp lệ, đã fix trước DONE:
- **HIGH-1 (ĐÃ FIX):** preserve overlap so sánh case-SENSITIVE nhưng fs Windows case-INSENSITIVE → entry
  đổi hoa/thường (`Docs`, `.GIT`, `CLAUDE.MD`) bị phân loại deletable và xóa protected path. Fix:
  `overlap()` fold case trên win32 (`foldCase`, `clean.mjs`); trên fs case-sensitive KHÔNG fold (giữ đúng
  semantics). Thêm 2 regression test.
- **MEDIUM-1 (ĐÃ FIX):** symlink guard chỉ chặn escape RA NGOÀI root, không chặn junction in-root trỏ lên
  protected path. Fix: `runClean` nhận `preserve`, sau khi realpath thì đối chiếu realpath-relative với
  preserve (`overlap`) → junction `.runtime/logs → docs` bị từ chối. Thêm regression test.
- **LOW-1 (chấp nhận):** manifest chưa validate duplicate/case-collision giữa cleanable và preserve —
  overlap vẫn bắt lúc assess; chỉ là surface authoring mistake sớm hơn. Ghi nhận.

Đã verify sau fix: 77/77 controller PASS, `verify: PASS`, tsc không liên quan (mjs).

## Đã xác nhận sạch (không finding)

Reject absolute/UNC/drive trên RAW string trước `normRel`; traversal/root hard-refuse abort cả run;
running-guard dùng identity re-match (degrade sang "refuse" khi thiếu PowerShell — hướng an toàn);
protected set (`.git`/docs/`.agent-workflow`/`.claude`/`CLAUDE.md`/`AGENTS.md`/`.loop-engineer state|
checkpoints|source`/workspace/credentials) không bao giờ deletable.

## Carry-forward

- CGHC-006: khi có service loopback thật + graceful shutdown, độ chính xác running-detection tự cải
  thiện qua chính seam `liveRecords`; không cần đổi `clean.mjs`.
