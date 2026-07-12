---
title: "CGHC-004 — Windows process supervision identity (bằng chứng thực thi)"
document_type: "implementation-evidence"
language: "vi"
task: "CGHC-004"
loop: "L6"
requirement: "LC1"
adr: "0004"
---

# CGHC-004 — Supervision identity (`.runtime/pids/*.json` + Win32 identity)

## Bối cảnh thực thi

Owner subagent (`runtime-llm-engineer`) đã tạo module `tools/loop-engineer/supervision.mjs` hoàn
chỉnh nhưng **stall** (watchdog 600s) ngay trước khi nối dây `lifecycle.mjs`, viết test và evidence.
Loop Engineer Lead (orchestrator) hoàn tất phần còn lại: nối dây `runningPids` qua `supervision.mjs`,
viết test `tools/loop-engineer/tests/supervision.test.mjs`, và evidence này. **Reviewer ≠ implementer
vẫn được giữ**: review độc lập do `code-reviewer` thực hiện (không phải người viết code).

## Đã xây dựng

- `tools/loop-engineer/supervision.mjs` (zero-dependency ESM, cùng phong cách controller):
  - `.runtime/pids/<role>.json` writer/reader/parser: `buildPidRecord`, `parsePidRecord` (TOTAL,
    không bao giờ throw), `writePidRecord`, `readPidRecords`.
  - **Nguồn identity DUY NHẤT** `win32ProcessInfo(pid, runner)` đọc `Win32_Process` qua
    `Get-CimInstance` → `{ pid, startedAt (canonical ISO), exePath }`. `capturePidRecord` chỉ ghi
    identity khi process còn sống (không ghi identity không kiểm chứng được).
  - Re-match + prune: `identityMatches` (PID + `startedAt` + `exePath` phải khớp CẢ BA),
    `verifyRecord` → `match|stale`, `pruneStaleRecords` → `{ live, pruned }` (seam cho CGHC-005).
- `tools/loop-engineer/lifecycle.mjs`: `runningPids` giờ đi qua `readPidRecords`/`pruneStaleRecords`
  (bỏ hẳn `readdirSync` — vốn **không** được import trong `lifecycle.mjs`, là một `ReferenceError`
  tiềm ẩn khi thư mục pids có file). "Không có process" là `0` hợp lệ và **không** spawn PowerShell;
  chỉ khi có record mới prune theo identity; nếu không có PowerShell/CIM thì fallback về record thô
  (báo là chưa kiểm chứng), không giả thành công.

## Acceptance → nơi thỏa mãn

1. **Schema pid-file đầy đủ** (`role/pid/port/host/startedAt/exePath/runtimeVersion`): `buildPidRecord`
   (`supervision.mjs`), cộng `schemaVersion` + `ppidRole`. Test `buildPidRecord validates …`.
2. **Identity = PID + start-time (Win32 CreationDate) + exePath; một owner mỗi child; PID tái dùng bị
   từ chối**: `identityMatches`/`verifyRecord`. Test `identityMatches rejects a reused PID …` và
   `verifyRecord classifies match vs stale …` (runner tiêm). Một file `<role>.json` mỗi role.
3. **Prune stale; nothing-running = 0**: `pruneStaleRecords`. Test
   `pruneStaleRecords keeps live, deletes stale files, and nothing-running is a valid 0`.

## M2 (carry-forward từ review CGHC-001) — nguồn `startedAt` duy nhất

`startedAt` **chỉ** đến từ `Win32_Process.CreationDate` (trong `win32ProcessInfo`), chuẩn hóa qua
`normalizeStartedAt` ở CẢ capture lẫn re-match, nên chuỗi 7 chữ số thập phân của CIM và chuỗi ISO
mili-giây gộp về cùng một mốc → so khớp tất định. Không dùng wall-clock lúc spawn. Test
`normalizeStartedAt collapses Win32 7-digit fractional …` chứng minh. Nếu vi phạm (hai đồng hồ khác
nhau) thì re-match luôn trượt → child mồ côi không bị kill, hoặc fallback PID-only mis-kill (phá LC3).

## Seam cho CGHC-005 (reaper) & bảo mật

- CGHC-005 tiêu thụ `verifyRecord`/`pruneStaleRecords` + `win32ProcessInfo`; **kill** (loopback
  shutdown → `taskkill /PID /T /F` / Job Object) và **orphan reaper** thuộc CGHC-005, KHÔNG làm ở đây.
- pid-file chỉ mang **identity**; **boundary client token (ADR 0003/CGHC-002) KHÔNG bao giờ được ghi**
  vào pid-file hay bất kỳ file nào — truyền cho child non-persistent (stdout/env lúc spawn).
- child cwd = workspace root đã grant (CGHC-007 `grant.rootPath`); không tin cwd của child — seam ghi chú.

## Test — lệnh + kết quả thật

```
node --test tools/loop-engineer/tests/*.test.mjs
# ℹ tests 44  ℹ pass 44  ℹ fail 0  (34 test controller cũ + 10 test supervision mới)
```

Test `real spawned child: capture identity, verify match, then stale after exit` **đã chạy thật**
trên host này (PowerShell/CIM khả dụng, không skip): spawn một node child, `win32ProcessInfo` trả
`exePath` khớp `node.exe` + `startedAt` hợp lệ, `capturePidRecord` → `verifyRecord === 'match'`; sau
khi kill → `verifyRecord === 'stale'` (PID chết phân loại stale, không bao giờ mis-match). Controller
`verify` = PASS, `status` hoạt động bình thường (không phá `verify`/`status`/`run`/`task`/`slice` hay
YAML parser). `cli.mjs` **không** bị sửa.

## Giả định & rủi ro

- Chưa có real start (`cmdStart` vẫn NOT_READY exit 3 tới khi CGHC-006 hiện thực start thật); writer
  `capturePidRecord` là seam CGHC-006 gọi khi spawn runtime thật.
- `pruneStaleRecords` gọi PowerShell mỗi record khi có record — chấp nhận cho CLI; đường "nothing
  running" đã short-circuit tránh PowerShell.
- Rủi ro: môi trường chặn CIM/PowerShell → fallback record thô (chưa kiểm chứng identity); cần
  CGHC-005/006 cân nhắc khi thực hiện kill để không bao giờ kill theo tên ảnh chung.
