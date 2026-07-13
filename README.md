# Cowork GHC

**Cowork GHC** là một sản phẩm **AI cowork desktop cho Windows 11 (máy local)**. UI là client của một
**local application service** chạy trên loopback; service điều phối một **OpenCode runtime** (tiến trình
con) và gọi LLM qua một **endpoint có thể thay thế** (provider-neutral). Đây là sản phẩm riêng — OpenWork
chỉ là tham khảo nghiên cứu (xem `docs/references/openwork-reference.md`).

> **Trạng thái: POC đang phát triển — CHƯA phải bản release dùng được.**
> Packaged `.exe` build được và mở được GUI, nhưng **chưa có luồng người dùng hoàn chỉnh** trong bản
> đóng gói. Xem [Giới hạn hiện tại](#giới-hạn-hiện-tại-known-limitations).

## Kiến trúc (ngắn)

```
┌─────────────────────────────┐
│ Cowork GHC desktop (Electron)│  UI (app/ui) + native shell (app/shell)
│  renderer  ⇄  main process   │  shell sở hữu vòng đời service + child
└───────────────┬─────────────┘
                │ HTTP/SSE, loopback-only, token-guarded
┌───────────────▼─────────────┐
│ Local application service    │  service/ (workspace, credential, provider,
│  (bind 127.0.0.1 / ::1)      │  session, permission, streaming, settings)
└───────────────┬─────────────┘
                │ spawn + supervise (PID/port/identity)
┌───────────────▼─────────────┐
│ OpenCode runtime (child)     │  runtime/ — pinned binary, isolated env
└───────────────┬─────────────┘
                │ provider-neutral
┌───────────────▼─────────────┐
│ Replaceable LLM endpoint     │  cloud API / OpenAI-compatible (không lock 1 vendor)
└─────────────────────────────┘
```

Nguyên tắc: business logic không nằm trong UI; mutation filesystem đi qua execution boundary;
**permission enforce tại execution boundary** (Deny thật sự chặn); một credential store OS-backed
(Windows Credential Manager); secret không bao giờ vào log/UI/screenshot.

## Cấu trúc repository

| Path | Nội dung |
|---|---|
| `core/contracts/` | Type/contract dùng chung (EV, provider, permission, workspace, session, ref). |
| `service/` | Local application service (loopback), business logic. |
| `runtime/` | Tích hợp OpenCode runtime (pin, spawn, isolation). |
| `app/shell/` | Electron main process (shell, IPC, security, service ownership). |
| `app/ui/` | Renderer (client của service). |
| `scripts/` | `.bat` Windows (init/build/start/stop/clean/demo-reset/verify-fast). |
| `tools/app/` | App lifecycle CLI (init/start/stop/clean/status) + supervision/reaper. |
| `docs/` | Tài liệu canonical — bắt đầu tại `docs/README.md`. |

## Yêu cầu (prerequisites)

- **Windows 11** (target chính).
- **Node.js ≥ 22** (repo phát triển trên v24) + npm 11.
- Toolchain build khác (electron-builder, tsx) được cài qua `npm install`.

## Lệnh phát triển

```bash
npm install                # cài dependency workspaces
npm run typecheck          # tsc -b (TypeScript strict)
npm test                   # node --test qua tsx, toàn bộ *.test.ts
npm run build:app          # build renderer + shell
npm run package:win        # đóng gói Electron (Windows) -> dist-app/ (không commit)
npm run app -- status      # app CLI
scripts\verify-fast.bat    # typecheck + focused tests + renderer build
```

## Windows scripts

`scripts/*.bat` là entry mỏng gọi `tools/app/cli.mjs`, trả exit code trung thực:

- `init.bat` — chuẩn bị môi trường (idempotent).
- `build.bat` — typecheck + package Windows app.
- `start.bat` — khởi động packaged app.
- `stop.bat` — dừng process Cowork GHC đã track.
- `clean.bat` — xoá generated/downloaded theo allowlist (không đụng credential/history).
- `demo-reset.bat` — reset demo-safe state (giữ keyring).
- `verify-fast.bat` — kiểm tra nhanh trước commit.

Chi tiết: `scripts/README.md`. Tài liệu: `docs/README.md`.

## Bảo mật credential

- Key LLM lưu ở **Windows Credential Manager** (OS-backed), state chỉ giữ **handle tham chiếu**.
- Key **không bao giờ** xuất hiện trong log, error, frontend state, screenshot, hay browser local storage.
- Key được inject vào tiến trình con qua biến môi trường tại lúc spawn; **không** ghi `auth.json`.
- **Không commit** `.env`/secret (xem `.gitignore`).

## Giới hạn hiện tại (known limitations)

Xem [docs/quality/known-limitations.md](docs/quality/known-limitations.md) và
[docs/product/current-status.md](docs/product/current-status.md).

## Cho agent (Claude / Codex)

- Điểm vào: [`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md).
- Tài liệu canonical: [`docs/README.md`](docs/README.md).
- Chế độ mặc định: **LEAN** (một agent, slice nhỏ, test tập trung).
