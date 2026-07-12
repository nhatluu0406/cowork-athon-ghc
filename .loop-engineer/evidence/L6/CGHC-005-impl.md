---
title: "CGHC-005 — Windows orphan reaper + graceful-then-force stop (bằng chứng)"
document_type: "implementation-evidence"
language: "vi"
task: "CGHC-005"
loop: "L6"
requirement: "LC3"
adr: "0004"
---

# CGHC-005 — Windows orphan reaper + graceful stop

## Bối cảnh thực thi

Owner subagent (`runtime-llm-engineer`) hoàn tất code + test thì gặp **API stream stall** ngay trước
khi chạy full-suite/verify và viết evidence (last log: "All 11 pass including the real spawned-child
reap … Now the full suite plus verify and status."). Loop Engineer Lead xác minh trạng thái trên đĩa
và viết evidence này. Review độc lập sẽ do `security-reviewer` thực hiện (reviewer ≠ implementer).

## Đã xây dựng

- `tools/loop-engineer/reaper.mjs` (153 dòng, zero-dependency ESM):
  - `taskkillTreeArgs(pid)` → **luôn** `['/PID', pid, '/T', '/F']`; **không có** đường sinh `/IM`
    (giết theo image name bị LC3 cấm — sẽ giết nhầm `node.exe`/`opencode.exe` khác).
  - `killProcessTree(pid, exec)` — force-kill một cây tiến trình đã được identity-gate; `exec` tiêm được.
  - `requestGracefulShutdown(record)` — seam loopback shutdown; hiện là **no-op trung thực** (service
    chưa start; CGHC-006 thay thân hàm bằng HTTP loopback shutdown + poll, hợp đồng reaper giữ nguyên).
  - `pidAlive(pid)` — `process.kill(pid, 0)` (ESRCH=chết, EPERM=sống) — chỉ chứng minh **liveness**,
    KHÔNG phải identity → chỉ dùng để prune record chết chắc chắn, không bao giờ để cấp phép kill.
  - `orderLeafFirst` — dừng lá trước (agent-runtime → local-service → app-shell).
  - `reapRecords` — với mỗi pid-file: `verify !== 'match'` → prune, **không kill**; `=== 'match'` →
    graceful → nếu thoát thì prune, nếu không thì force-kill cây → re-verify đã biến mất → prune;
    nếu vẫn sống thì báo `failed` (KHÔNG leo thang sang image-name kill). Mọi kill gate trên
    `verify(...) === 'match'` tươi. Seam `verify/kill/requestShutdown/records/onEvent` tiêm được.
  - `reapUnverifiable` — khi không có PowerShell/CIM: **KHÔNG kill**; chỉ prune PID chết chắc chắn;
    record sống-nhưng-không-verify-được để nguyên + báo `unverifiable`.
  - `stopAll` — chọn `reapRecords` (có CIM) hoặc `reapUnverifiable` (không CIM); `empty` khi không có record.
- `tools/loop-engineer/lifecycle.mjs` — `cmdStop` gọi `stopAll` (seam `deps.stopAll` cho test), log
  pruned/killed/unverifiable/failed; exit code trung thực: 0 khi mọi tiến trình được xử lý hoặc không
  có gì chạy; **5** khi còn tiến trình tracked không kill/không chứng minh chết được.

## Acceptance → nơi thỏa mãn

1. **Windows reaper** (reference sweep Unix-only): `reaper.mjs` — chỉ tác động record có
   `verifyRecord === 'match'`; stale/reused-PID → prune, không kill.
2. **Graceful-then-force**: `requestGracefulShutdown` → `killProcessTree` (`taskkill /PID /T /F` cây)
   hoặc Job-Object-tương-đương; SIGTERM không dùng làm graceful trên Windows (ADR 0004).
3. **Không bao giờ giết theo image name; chỉ tiến trình của mình đã verify; stale PID xử lý không
   lỗi; nothing-running = 0**: `taskkillTreeArgs` chỉ `/PID`; `reapUnverifiable` từ chối kill;
   `stopAll` trả `empty`.

## Test — lệnh + kết quả thật

```
node --test tools/loop-engineer/tests/*.test.mjs
# ℹ tests 55  ℹ pass 55  ℹ fail 0  ℹ skipped 0  (44 trước đó + 11 reaper)
node tools/loop-engineer/cli.mjs verify   # verify: PASS
```

`tests/reaper.test.mjs` gồm: `taskkillTreeArgs` chỉ sinh `/PID …/T /F` (không `/IM`); `reapRecords`
chỉ kill record `match` (killer tiêm, assert argv); stale/reused-PID bị prune không kill;
`reapUnverifiable` không kill khi thiếu CIM; và **real spawned-child reap** (không skip → PowerShell +
taskkill sống trên host này): spawn child → capture identity → `taskkill /PID /T /F` thật → xác nhận
biến mất. `verify`/`status`/`run`/`task`/`slice` và YAML parser không bị phá; `cli.mjs` không bị sửa.

## Carry-forward / seam

- CGHC-006 (real start): thay thân `requestGracefulShutdown` bằng loopback HTTP shutdown + liveness
  poll; `capturePidRecord` sau khi child sống; token non-persistent; bắt null-`ExecutablePath`.
- Không-CIM: luôn có đường prune-provably-dead; không bao giờ fallback sang image-name kill.

## Review độc lập (security-reviewer) + fix

PASS_WITH_FINDINGS, 0 Critical/High; grep xác nhận KHÔNG có đường `/IM`/image-name kill, không mis-kill
trong build hiện tại. Hai finding đã xử lý ngay (an toàn hơn là để lại):
- **MEDIUM (TOCTOU) — ĐÃ FIX:** thêm `safeVerify(verify, record) === 'match'` **tươi ngay trước
  force-kill** (sau graceful wait). Trước đây chỉ gate ở entry (line ~100); khi CGHC-006 biến
  `requestShutdown` thành loopback poll tốn thời gian thật, PID có thể bị tái dùng trong cửa sổ chờ →
  giờ force-kill luôn được re-match identity sau chờ. 'error'/non-'match' → KHÔNG kill.
- **LOW (verify throw) — ĐÃ FIX:** `verify` ném (PowerShell lỗi giữa chừng) → `safeVerify` trả `'error'`
  → báo `failed` (exit 5), KHÔNG kill, KHÔNG abort cả vòng lặp bằng exception (hướng an toàn).
Sau fix: 55/55 controller test vẫn xanh, verify PASS. Gating CGHC-006: giữ fresh pre-kill gate; graceful
poll phải bounded + re-verify identity; no-CIM luôn prune-only (không bao giờ image-name kill).

## Rủi ro

- Graceful shutdown hiện là no-op → reaper đi thẳng tới force-kill; đúng cho tới khi service tồn tại.
- `taskkill`/PowerShell phải có trên host (có ở đây); môi trường thiếu → đường `reapUnverifiable`
  (prune-only) chạy, không kill sai.
