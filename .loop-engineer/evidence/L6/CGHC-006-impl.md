---
title: "CGHC-006 — Windows lifecycle scripts (init/start/stop) — bằng chứng"
document_type: "implementation-evidence"
language: "vi"
task: "CGHC-006"
loop: "L6"
requirement: "LC2"
adr: "0004"
---

# CGHC-006 — init/start/stop.bat + lifecycle CLI

## Đã xây dựng / xác nhận

Phần lớn `.bat` đã tồn tại đúng chuẩn thin-entry (nền từ CGHC-004/005); khoảng trống thật là **test phủ
exit-code contract + root-independence** cộng vài hardening/doc.

- `tools/loop-engineer/lifecycle.mjs`: `cmdInit(root, deps={})` thêm seam inject `toolPresent`/`install`
  (mặc định = `toolPresent` gốc + `execSync('npm install')` — production KHÔNG đổi) để test được exit-code
  mà không chạy npm thật; export `cmdInit/cmdStart/cmdStop`. `cmdStop` vẫn delegate `stopAll` (reaper
  identity-gated CGHC-005) — không nhân đôi logic stop.
- `tools/loop-engineer/tests/lifecycle.test.mjs`: +7 test (exit-code + root-independence + static `.bat`
  Node-9 contract). `NPM_PRESENT` inject thêm `install: () => {}` no-op (LOW-2) → đảm bảo CẤU TRÚC không
  test nào shell ra `npm install` thật.
- `scripts/README.md`: mở rộng bảng exit-code (init/start + code 5 stop-unverifiable).
- Xác nhận không đổi (đã đúng): `scripts/{init,start,stop,clean}.bat` — thin, self-locate `%~dp0..`,
  `where node` → `exit /b 9`, gọi `lifecycle.mjs <cmd> --root "%ROOT%"`, propagate `exit /b %RC%`.

## Bảng exit code (init/start)

| Code | Nghĩa |
|------|-------|
| 0 | success / no-op (init xong kể cả chạy lại; start would-be-ready; stop nothing; clean xong/dry-run) |
| 2 | init: thiếu npm toolchain / `npm install` fail (hoặc clean: manifest xấu) |
| 3 | start: NOT READY — chưa init, hoặc runtime chưa build (trung thực, không fake process) |
| 5 | stop: tracked process không kill-được-cũng-không-chứng-minh-chết |
| 9 | Node.js không có trên PATH (kiểm ở `.bat` trước khi gọi CLI) |

## Test — lệnh + kết quả thật

```
node --test tools/loop-engineer/tests/*.test.mjs   # tests 84  pass 84  fail 0
node tools/loop-engineer/cli.mjs verify            # verify: PASS
```

## Acceptance → nơi thỏa mãn (file:line)

- **init idempotent → 0, tạo `.runtime/`:** `ensureRuntimeDirs` (`lifecycle.mjs:43-45`,
  `mkdirSync recursive`); no `package.json` → nhánh no-install → 0. Test assert 0 cả hai lần + `.runtime/*`
  còn.
- **start NOT READY → 3:** `cmdStart` trả 3 cả khi thiếu `.runtime` lẫn khi runtime chưa build; KHÔNG ghi
  pid giả. Test assert `!existsSync(server.json)`.
- **stop nothing → 0:** `cmdStop` trả 0 khi `mode==='empty'` (`reaper.mjs`).
- **root-independence:** `DEFAULT_ROOT = resolve(HERE,'..','..')` từ module URL; `main` lấy root từ
  `--root`/DEFAULT_ROOT, KHÔNG bao giờ `process.cwd()`. Test chdir sang CWD lạ, assert hiệu ứng chỉ nằm
  dưới root truyền vào.
- **Node-missing → 9:** enforce trong `.bat`; static test đọc cả 3 `.bat` assert `where node`/`exit /b 9`/
  `%~dp0`/`--root`/`exit /b %RC%`.

## Review độc lập (code-reviewer ≠ owner)

**PASS_WITH_FINDINGS, 0 Critical/High.** Production không đổi; exit-code trung thực + nhất quán với
clean.mjs (mỗi code single-owner trong 1 command); root CWD-independent có test chứng minh; seam inject
không thể trigger `npm install` hay spawn process thật trên bất kỳ test path nào; module guard không tự
chạy khi import; `cli.mjs` verify/status/run/task/slice + YAML parser không đụng. LOW-1 (start dùng chung
code 3 cho hai điều kiện NOT_READY — chấp nhận, log phân biệt). LOW-2 (harden `NPM_PRESENT`) **đã áp
dụng**.

## Carry-forward (hoãn có chủ đích)

- **Wiring start service thật** (spawn OpenCode child + service loopback + đăng ký PID + supervised start)
  hoãn tới integration/CGHC-028; hiện `cmdStart` trung thực NOT_READY (3) vì chưa package runtime binary.
- `requestGracefulShutdown` vẫn là no-op stub tới khi service tồn tại (CGHC-014/integration); hợp đồng
  reaper giữ nguyên.
