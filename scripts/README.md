# Cowork GHC — Windows Lifecycle Scripts

Four double-clickable `.bat` files control the Cowork GHC local environment. Each one
self-locates the project root from its own path (`%~dp0`), so you can double-click it
straight from File Explorer — you do **not** need to open a terminal, `cd` anywhere,
edit the files, or run as Administrator.

Each script is a thin entry point that calls the tested Node backend
`tools/app/cli.mjs` — the **app lifecycle CLI** (distinct from the loop-engineer
controller). Complex logic lives there, not in the batch file. The CLI reuses the
loop-engineer supervision (pid identity), reaper (identity-gated stop), and cleanup
manifest allowlist, so `stop`, `clean`, and `status` agree on what "running" means.

> Prerequisite: **Node.js LTS** on PATH (`node`, `npm`). Install from https://nodejs.org.
> If Node is missing, every script stops with a clear message and exit code 9.

## Window behavior
All four scripts **pause at the end** (success or failure) so you can read the output
before the window closes. Press a key to close. Logs are written (redacted) under
`.runtime/logs/`.

## init.bat — prepare the environment (idempotent)
- Verifies the toolchain (`npm`) and reports how to install Node.js if it is missing.
- Creates runtime directories under `.runtime/` (`pids`, `logs`, `state`, `temp`).
- Installs dependencies (`npm install`) and builds the app (renderer + shell + service).
- Verifies the pinned OpenCode binary is present under
  `node_modules/opencode-ai/bin/opencode.exe`.
- Safe to run repeatedly. It does not overwrite user config or credentials and does not
  install system software silently.
- Re-run `init.bat` when dependencies or the lockfile change.

## start.bat — start Cowork GHC
- Ensures the environment is initialized (prompts you to run `init.bat` otherwise).
- Launches the desktop app: a packaged build under `dist-app/` if present, otherwise the
  development Electron run of `app/shell/dist/main.cjs`. The Electron main process is the
  ONE owner that brings up the live loopback service + the supervised OpenCode child.
- Tracks the launched app's PID under `.runtime/pids/app-shell.json` (Win32-identity
  captured when available) so `stop.bat` can terminate exactly that process, never by name.
- If a tracked app is already live, it reports so and exits 0 (no double-start).

## stop.bat — stop Cowork GHC
- Reads tracked process state from `.runtime/pids/`, sends a graceful shutdown first,
  and only force-terminates Cowork GHC's own processes if graceful shutdown fails.
- It never kills processes by generic name (e.g. `node.exe`) and never touches
  processes it did not start.
- If nothing is running, that is a valid result (exit 0), not an error.

## clean.bat — remove generated/downloaded data only
- On double-click it first prints exactly what would be deleted, then asks for
  confirmation (default **No**). For automation you can run `clean.bat --yes`.
- Deletes only paths in the `generated`, `downloaded-library`, and `runtime-temporary`
  categories of `scripts/cleanup-manifest.json`, and refuses any path that overlaps a
  preserved path.
- **Deletes (when present):** `node_modules/`, build outputs (`dist`, `build`, `out`),
  framework caches (`.turbo`, `.vite`, `.next`), `coverage`, `test-results`,
  `src-tauri/target`, downloaded tools (`.tools`, `.cache`), and runtime temp
  (`.runtime/pids|logs|temp|state`).
- **Never deletes:** `.git/`, source code, `docs/`, `.agent-workflow/`, `.claude/`,
  `.agents/`, `CLAUDE.md`, `AGENTS.md`, `tools/`, `scripts/`, `.loop-engineer/state`,
  `.loop-engineer/checkpoints`, `.loop-engineer/evidence`, `.loop-engineer/reports`,
  the reference source under `.loop-engineer/source`, your **credentials**, or your
  **workspace**.
- Refuses to run if the project root cannot be determined, if a target would escape the
  project (path traversal), or if Cowork GHC appears to be running (run `stop.bat` first).

## set-provider-key.bat — store a provider API key (hidden prompt)
- Double-click to store a provider API key in **Windows Credential Manager** (the single
  OS-backed credential store). It is a thin entry point that calls the neutral CLI
  `service/src/credential/cli.ts`.
- Optional first argument is the **provider id** (a non-secret identifier). It defaults to
  the custom OpenAI-compatible endpoint (alias `custom`) — e.g. a DeepSeek endpoint used
  behind OpenCode. The provider id is NOT the key.
- The key is typed at a **hidden local prompt** (no terminal echo). It is never passed on
  the command line, never written to a file/`.env`, never put in an environment variable,
  and never printed. On success only a non-secret confirmation is shown (provider id +
  account handle + character count).
- Related subcommands (run the CLI directly):
  `node --import tsx service/src/credential/cli.ts status <providerId>` (is a key stored?)
  and `... remove <providerId>` (delete it). Neither ever reveals the value.
- This action only STORES the key; it makes no network call and does not test the key, and
  it never writes OpenCode `auth.json`/`env.json`.

### Ghi chú bảo mật (tiếng Việt)
Đây là hành động cục bộ **an toàn duy nhất** để nạp API key của provider (ví dụ khóa
DeepSeek dùng như một endpoint tương thích OpenAI sau OpenCode). Bạn nhập khóa tại một
**prompt ẩn ngay trên máy** (bàn phím không hiển thị ký tự). Khóa được lưu vào **Windows
Credential Manager** và **không bao giờ** xuất hiện trong cửa sổ chat, mã nguồn, đối số dòng
lệnh (argv), lịch sử shell, tệp `.env`, biến môi trường, hay log. Nhấn **Enter** để gửi,
**Backspace** để xóa, **Ctrl+C** để hủy (khi hủy sẽ không lưu gì và thoát với mã khác 0).
Chỉ một dòng xác nhận không chứa bí mật được in ra (provider id + tên account + số ký tự đã
lưu). Lệnh này chỉ *lưu* khóa; nó không gọi mạng và không kiểm tra khóa.

## Resetting user application data
`clean.bat` never removes sessions, history, or credentials. Resetting user application
data is a separate, explicit action (a future in-app reset / dedicated option), not a
side effect of `clean.bat`.

## Exit codes
Codes are command-scoped (the same number can mean different things for different commands);
`0` is always success or a valid no-op. See the matching log under `.runtime/logs/`.

| Code | Meaning |
|------|---------|
| 0 | success or a valid no-op — **init** completed (including an idempotent re-run), **start** launched (or an app was already live), **stop** had nothing to stop or stopped everything, **clean** finished / previewed a dry-run, **status** reported |
| 2 | **init**: `npm` is missing — or **clean**: refused because the cleanup manifest is missing/malformed or names an unsafe (absolute/UNC/drive/traversal) path |
| 3 | **start**: the environment is not initialized (run `init.bat` first) or the app is not built yet — reported honestly instead of faking a started process |
| 4 | **init**: `npm install` or the app build failed — or **clean**: refused because Cowork GHC appears to be running (run `stop.bat` first) |
| 5 | **init**: the pinned OpenCode binary is missing — or **stop**: a tracked process is still alive and could neither be identity-verified-and-killed nor proven dead |
| 6 | **start**: the app could not be launched / its PID could not be tracked — or **clean**: refused because the project root could not be determined with certainty |
| 7 | **stop**: a tracked process could not be stopped — or **clean**: a target could not be deleted (locked file, or a symlink that escapes the project root) |
| 9 | Node.js not found on PATH (checked by the `.bat` entry point before it calls the CLI) |
| other non-zero | see the matching log under `.runtime/logs/` |
