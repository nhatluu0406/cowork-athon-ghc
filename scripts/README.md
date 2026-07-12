# Cowork GHC — Windows Lifecycle Scripts

Five double-clickable `.bat` files control the Cowork GHC local environment. Each one
self-locates the project root from its own path (`%~dp0`), so you can double-click it
straight from File Explorer — you do **not** need to open a terminal, `cd` anywhere,
edit the files, or run as Administrator.

Each script is a thin entry point that calls the tested Node backend
`tools/app/cli.mjs` where needed — the **app lifecycle CLI** (distinct from the
loop-engineer controller). Complex logic lives there, not in the batch file. The CLI
reuses the loop-engineer supervision (pid identity), reaper (identity-gated stop), and
cleanup manifest allowlist, so `stop`, `clean`, and `status` agree on what "running"
means.

> Prerequisite: **Node.js LTS** on PATH (`node`, `npm`). Install from https://nodejs.org.
> If Node is missing, every script stops with a clear message and exit code 9.

## Lifecycle

```text
init → build → start → stop → clean
```

| Step | Script | Purpose |
|------|--------|---------|
| First-time setup | `scripts\init.bat` | Install dependencies, dev build, verify OpenCode binary |
| Package app | `scripts\build.bat` | `npm run typecheck` + `npm run package:win` |
| Run packaged app | `scripts\start.bat` | Launch `dist-app\win-unpacked\Cowork GHC.exe` |
| Stop app | `scripts\stop.bat` | Graceful-then-force stop of tracked Cowork processes |
| Clean generated data | `scripts\clean.bat` | Remove allowlisted build/cache/runtime temp only |

## npm build commands (not the same thing)

| Command | What it builds |
|---------|----------------|
| `npm run build:renderer` | Renderer only (`app/ui/dist`) |
| `npm run build:shell` | Electron shell bundle only (`app/shell/dist`) |
| `npm run build:app` | Renderer + shell (dev run prerequisites) |
| `npm run package:win` | Full packaged Electron app under `dist-app/` |

`scripts\init.bat` runs `npm run build:app` (dev prerequisites). It does **not** create
the packaged executable. Use `scripts\build.bat` for that.

## Window behavior

All five scripts **pause at the end** (success or failure) so you can read the output
before the window closes. Press a key to close. Logs are written (redacted) under
`.runtime/logs/`.

## init.bat — prepare the environment (idempotent)

- Verifies the toolchain (`npm`) and reports how to install Node.js if it is missing.
- Creates runtime directories under `.runtime/` (`pids`, `logs`, `state`, `temp`).
- Installs dependencies (`npm install`) and builds the dev app (`npm run build:app`).
- Verifies the pinned OpenCode binary is present under
  `node_modules/opencode-ai/bin/opencode.exe`.
- Safe to run repeatedly. It does not overwrite user config or credentials and does not
  install system software silently.
- Does **not** run `npm run package:win` or create `dist-app\win-unpacked\Cowork GHC.exe`.
- Re-run `init.bat` when dependencies or the lockfile change.

### First-time setup

```bat
scripts\init.bat
```

## build.bat — package the Windows desktop app

- Verifies `node`, `npm`, root `package.json`, and that `node_modules/` exists.
- If dependencies are missing, tells you to run `scripts\init.bat` first (does not auto-run init).
- Runs `npm run typecheck`.
- Runs `npm run package:win` (canonical packaged build command).
- Verifies the executable exists at:
  `dist-app\win-unpacked\Cowork GHC.exe`
- On success, prints the executable path and tells you to run `scripts\start.bat`.
- On failure, prints the failed stage and exits non-zero. It never claims success when the exe is missing.
- Does not create an installer in this workflow; it produces the unpacked packaged app only.
- Does not print credentials or environment secrets.

### Build packaged app

```bat
scripts\build.bat
```

Output:

```text
dist-app\win-unpacked\Cowork GHC.exe
```

## start.bat — start the packaged app

- Requires the packaged executable from `scripts\build.bat`.
- If the executable is missing, it does **not** auto-build; it tells you to run
  `scripts\build.bat` and exits with code 3.
- Launches only `dist-app\win-unpacked\Cowork GHC.exe` (no dev Electron fallback from this entry point).
- Uses the app lifecycle CLI to track the launched PID under `.runtime/pids/app-shell.json`
  so `stop.bat` can terminate exactly that process tree, never by generic image name.
- If a tracked app is already live, it reports so and exits 0 (no duplicate start).
- The packaged app bundles OpenCode under `resources/opencode/opencode.exe`; it does not
  require a global OpenCode install.
- Still requires `init.bat` to have been run at least once (`.runtime/` and dependencies).

### Start packaged app

```bat
scripts\start.bat
```

**Backward compatibility:** `node tools/app/cli.mjs start --root <repo>` still exists for
automation and tests. When no packaged exe is present it can still fall back to the dev
Electron entry (`app/shell/dist/main.cjs`). `start.bat` is the user-facing packaged-only
entry point.

## stop.bat — stop Cowork GHC

- Reads tracked process state from `.runtime/pids/`, sends a graceful shutdown first,
  and only force-terminates Cowork GHC's own tracked process trees if graceful shutdown fails.
- Uses identity-gated `taskkill /PID <pid> /T /F` — never kills by generic image name
  (e.g. all `node.exe` or unrelated `opencode.exe` processes).
- Stopping the tracked `app-shell` tree stops the packaged Electron app and its owned
  local service / OpenCode children.
- If nothing is running, that is a valid result (exit 0), not an error.

### Stop

```bat
scripts\stop.bat
```

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
  the reference source under `.loop-engineer/source`, your **credentials**, your
  **workspace**, or the packaged output under `dist-app/` (not in the allowlist).
- Refuses to run if the project root cannot be determined, if a target would escape the
  project (path traversal), or if Cowork GHC appears to be running (run `stop.bat` first).

### Clean

```bat
scripts\clean.bat
```

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
| 0 | success or a valid no-op — **init** completed (including an idempotent re-run), **build** produced the packaged exe, **start** launched (or an app was already live), **stop** had nothing to stop or stopped everything, **clean** finished / previewed a dry-run, **status** reported |
| 2 | **init**/**build**: `npm` is missing — or **build**: dependencies not installed (run `init.bat`) — or **clean**: refused because the cleanup manifest is missing/malformed or names an unsafe (absolute/UNC/drive/traversal) path |
| 3 | **start**: packaged app not built (run `build.bat` first) or environment not initialized (run `init.bat` first) |
| 4 | **init**/**build**: `npm install` or build failed — or **clean**: refused because Cowork GHC appears to be running (run `stop.bat` first) |
| 5 | **init**: the pinned OpenCode binary is missing — or **stop**: a tracked process is still alive and could neither be identity-verified-and-killed nor proven dead |
| 6 | **build**: packaged executable missing after `package:win` — or **start**: could not launch / record the app — or **clean**: refused because the project root could not be determined with certainty |
| 7 | **stop**: a tracked process could not be stopped — or **clean**: a target could not be deleted (locked file, or a symlink that escapes the project root) |
| 9 | Node.js not found on PATH (checked by the `.bat` entry point before it calls the CLI) |
| other non-zero | see the matching log under `.runtime/logs/` |
