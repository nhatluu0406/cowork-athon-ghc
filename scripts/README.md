# Cowork GHC — Windows Lifecycle Scripts

There are now **four** double-clickable, user-facing `.bat` entry points. Each self-locates the
project root from its own path (`%~dp0`), so you can double-click it from File Explorer — no
terminal, no `cd`, no editing, no Administrator.

Each script is a thin entry point that calls the tested Node backend under `tools/app/cli.mjs`
(supervision / identity-gated stop / cleanup allowlist live there).

> Prerequisite: **Node.js LTS** on PATH (`node`, `npm`). If Node is missing, every script stops
> with a clear message and a non-zero exit code.

## The four lifecycle scripts

| Step | Script | Purpose |
|------|--------|---------|
| First-time setup | `scripts\init.bat` | Install dependencies, dev build, verify the pinned OpenCode binary |
| Package the app | `scripts\build.bat` | `npm run typecheck` + `npm run package:win` |
| Run packaged app | `scripts\start.bat` | Launch `dist-app\win-unpacked\coworkghc.exe` |
| Stop the app | `scripts\stop.bat` | Graceful-then-force stop of tracked Cowork process trees |

The packaged executable is **`coworkghc.exe`** (lowercase, no space). The product/display name
shown in the titlebar, installer and shortcut stays **Cowork GHC**, and the user-data folder
remains `%APPDATA%\Cowork GHC`.

## Everything else moved out of `scripts\`

To keep the four entry points obvious, all other helpers now live under `tools\` (or as npm
scripts). They are developer/native-build tooling, not day-to-day product controls.

### npm scripts (run from the repo root)

| Command | What it does |
|---------|--------------|
| `npm run clean` | Remove only allowlisted build/cache/runtime temp (`scripts\cleanup-manifest.json`) |
| `npm run verify:fast` | Typecheck + focused provider/conversation tests + renderer build |
| `npm run demo:seed` | Create `demo-workspace\` with representative sample files |
| `npm run build:app` | Renderer + shell dev build (dev-run prerequisite) |
| `npm run package:win` | Full packaged Electron app under `dist-app\` |

### `tools\dev\` — developer helpers (double-clickable)

`clean.bat`, `verify-fast.bat`, `demo-seed.bat`, `demo-reset.bat`, `set-provider-key.bat`.
These mirror the npm scripts above plus demo reset and provider-key entry.

### `tools\native-build\` — native/toolchain build helpers

Build the optional native components (only needed by developers building the Go/Rust services;
**not** required to run the current packaged app). Includes `build-backend.bat` (Go),
`build-llm-svc*.bat` (Rust), and the MSVC / protoc / vendor setup helpers. Each requires the
matching toolchain (Go, Rust+MSVC) on PATH; without it they exit with a clear message.

> The Go/Rust D3 knowledge-graph stack is **not** wired into or bundled with the current
> packaged app — see `docs/architecture/local-first-strategy.md`.

### `tools\system-test\` — containerized dev/test harness (Docker; developer-only)

## Lifecycle order

```text
init  →  build  →  start  →  stop
```

All four scripts **pause at the end** (success or failure) so you can read the output. Logs are
written (redacted) under `.runtime\logs\`.

## Exit codes

`0` is always success or a valid no-op. Non-zero codes are command-scoped; see the matching log
under `.runtime\logs\`. Common codes: `2` npm/deps missing, `3` not built / not initialized,
`4` install or build failed, `5` OpenCode binary missing / process could not be proven dead,
`6` packaged exe missing, `7` a tracked process could not be stopped, `9` Node.js not on PATH.

## Resetting user data

`npm run clean` / `clean.bat` never removes sessions, history, or credentials. Use
`tools\dev\demo-reset.bat` for an explicit demo-safe reset (runtime temp + the packaged
`%APPDATA%\Cowork GHC` profile; OS credential store preserved).
