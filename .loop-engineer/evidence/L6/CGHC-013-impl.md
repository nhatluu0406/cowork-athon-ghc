---
title: "CGHC-013 — Session orchestration (create/continue/rename/history, cancel, status) — bằng chứng"
document_type: "implementation-evidence"
language: "vi"
task: "CGHC-013"
loop: "L6"
requirement: "S1 / S3 / S6 / S4"
---

# CGHC-013 — Session orchestration

## Đã xây dựng

`service/src/session/` (mọi file < 250 dòng): `seams.ts` (SessionStore = seam OpenCode store
create/list/get/rename/replay; RuntimeHealth = seam supervision alive; StreamCanceller = seam cancel),
`task-registry.ts` (lớp runtime per-session: gate cancel/freeze S3 + suy ra status S6), `session-service.ts`
(domain: create/continueSession/rename/list + rebuild-from-store S4), `meta.ts` (StoredSession → SessionMeta
secret-free), `index.ts` (barrel). One session mechanism: OpenCode store = SSOT nội dung; app chỉ giữ light
metadata (id/title/workspace/timestamps/ModelRef handle/status). Không viết auth.json/env.json; không secret
vào state/log; default suite không chạm live network/LLM.

## Acceptance → nơi thỏa mãn

- **S1:** create/continue/rename/list qua store seam; `meta.ts` chỉ copy metadata + `ModelRef` handle.
- **S3 (cancel stops mutation):** `task-registry.cancel` → `canceller.cancel(handle)` (dừng tại nguồn) →
  fold terminal `cancelled` thật (nguyên nhân là user cancel, không fabricate `completed`) → `frozen=true`;
  `apply` DROP mọi frame sau freeze.
- **S6 (status trung thực):** `status()` lấy từ `view.status` (chỉ từ EV thật); non-terminal + child chết →
  `runtime_down`; terminal giữ status lịch sử.
- **S4 (restart):** `rebuildView` replay frame store qua CGHC-012 mapper + reducer (không từ memory).

## Test — lệnh + kết quả thật

```
node --import tsx --test "service/**/*.test.ts"   # tests 156  pass 156  fail 0
npx tsc -b                                          # No errors found (exit 0)
```

15 test session (service/create/continue/rename/list; cancel-stops-mutation; status idle→running→terminal +
runtime_down; restart rebuild-from-store) + 3 regression bổ sung (dưới).

## Review độc lập (code-reviewer ≠ owner) + xử lý

**PASS_WITH_FINDINGS, 0 Critical/High.** S1/S3/S4/S6 đạt trong scope; gate freeze cancel airtight. Hai MEDIUM
đã fix trước DONE + regression test:

- **MEDIUM-1 (ĐÃ FIX) — rò mutation sau terminal non-cancel:** reducer trần vẫn append `file_mutation`/
  `tool_call`/`token` sau terminal (chỉ status bị freeze); registry trước đây chỉ freeze khi cancel → một run
  `completed`/`errored` không freeze → frame trễ vẫn append (UI thấy mutation "sau khi run xong"). Fix HAI lớp:
  (a) `task-registry.apply` freeze on ANY terminal (không chỉ cancel); (b) **defense in depth trong
  `ev-reducer.foldOne`**: khi `view.terminal !== null` và event không phải `terminal` → return view nguyên
  (mọi consumer trực tiếp `reduceEv` — CGHC-014 streaming, CGHC-016 permission — thừa hưởng). Regression:
  reducer post-terminal drop + registry completed-freeze.
- **MEDIUM-2 (ĐÃ FIX) — register clobber task đang live:** `continueSession` gọi `register` khi reopen → drop
  `StreamHandle` in-flight (orphan stream, cancel sau không abort được) + un-freeze task cancelled. Fix: guard
  trong `continueSession` — nếu có task live non-terminal thì trả view in-memory nguyên, chỉ rebuild-from-store
  khi KHÔNG có task live (đúng restart path). Regression: reopen giữ live handle → cancel abort đúng stream.
- **LOW-1 (chấp nhận):** `list()` báo `idle`/`runtime_down` cho session chưa-load (dưới-báo, hướng an toàn,
  không fabricate completed) — đúng với light metadata; note cho UI contract.
- **LOW-2 (chấp nhận):** synthetic cancel-terminal chỉ in-memory; cancel-không-stream reopen rebuild thành
  `idle` (trung thực — không có gì đang chạy).

## Ảnh hưởng CGHC-012 (đã DONE)

Chỉnh `ev-reducer.foldOne` là **hardening additive**: mọi test CGHC-012 (no-fabricated-completed, first-
terminal-wins, idempotent) vẫn xanh; ý nghĩa acceptance CGHC-012 KHÔNG đổi (post-terminal frame vốn không nên
tồn tại trong replay đúng thứ tự). Ghi nhận như carry-forward gia cố CGHC-012, KHÔNG invalidate.

## Carry-forward

- **CGHC-014 (two-hop SSE + resync):** gọi `bindStream(sessionId, handle)` khi stream bắt đầu; feed EV qua
  `apply`; trả `view` khi resync; cấp `SessionStore`/`RuntimeHealth` thật (OpenCode /session + /event, supervisor
  CGHC-001). Giữ `startSeq` liên tục khi resume.
- **CGHC-016 (permission):** thêm transition `waiting_approval` + terminal `denied`; reducer "first terminal
  wins" + freeze gate đã sẵn sàng, chỉ cần EV mà reducer fold.
