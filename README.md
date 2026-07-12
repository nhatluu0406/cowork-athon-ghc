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
| `scripts/` | `.bat` Windows (init/start/stop/clean) — entry mỏng → CLI. |
| `tools/loop-engineer/` | Controller state máy (status/verify) + lifecycle CLI. |
| `tools/app/` | App CLI được `.bat` gọi. |
| `docs/` | Tài liệu (tiếng Việt): scope, kiến trúc, ADR, master plan, references. |
| `.agent-workflow/` | Workflow/roles/loops/schemas trung lập (nguồn sự thật cho agent). |
| `.loop-engineer/` | State máy (`state/`), evidence, checkpoints, reports, `HANDOFF.md`, `MANIFEST.md`. |

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
```

Trạng thái workflow (state máy, không thay đổi source):

```bash
node tools/loop-engineer/cli.mjs status    # loop/task/gate + next hợp lệ
node tools/loop-engineer/cli.mjs verify    # validate schema + state
```

## Windows scripts

`scripts/*.bat` là entry mỏng (`%~dp0` tự định vị root) gọi CLI trung lập, trả exit code trung thực:

- `init.bat` — chuẩn bị môi trường (idempotent).
- `start.bat` — khởi động Cowork GHC + local service.
- `stop.bat` — dừng process Cowork GHC gọn gàng.
- `clean.bat` — xoá **chỉ** dữ liệu generated/downloaded theo allowlist (không đụng source/docs/state/
  credential/workspace). Xem `scripts/README.md`.

## Bảo mật credential

- Key LLM lưu ở **Windows Credential Manager** (OS-backed), state chỉ giữ **handle tham chiếu**.
- Key **không bao giờ** xuất hiện trong log, error, frontend state, screenshot, hay browser local storage.
- Key được inject vào tiến trình con qua biến môi trường tại lúc spawn; **không** ghi `auth.json`.
- **Không commit** `.env`/secret (xem `.gitignore`).

## Giới hạn hiện tại (known limitations)

- **Chưa có usable packaged user journey.** Local service chưa tự khởi động/kết nối thành công từ
  packaged app.
- **UNVERIFIED trong bản đóng gói:** folder/workspace picker, provider/model/credential settings, luồng
  nhập LLM token an toàn từ GUI, và một live OpenCode session hoàn chỉnh.
- Chất lượng GUI/UX so với các sản phẩm tham chiếu là `UNVERIFIED`.
- Token LLM (ví dụ DeepSeek) **chưa được nhập** qua luồng credential an toàn.

## Phạm vi & trạng thái loop

- **Release target = Windows desktop app.** **Web (Next.js) = `DEFERRED`**
  ([ADR 0007](docs/architecture/decisions/0007-web-application-deferral.md)): không cài Next.js, không
  tạo `apps/web`, không thêm active web loop trước khi desktop POC đạt L9 `PASS` hoặc product owner kích hoạt.
- **Loop hiện tại: L6 (Implementation) = `RUNNING`, gate `PARTIAL`.** Packaged acceptance chưa đạt.
  **Không bắt đầu L7.** Chi tiết bàn giao: `.loop-engineer/HANDOFF.md`.

## Cho agent (Claude / Codex)

- Điểm vào Codex + agent chung: [`AGENTS.md`](AGENTS.md). Điểm vào Claude Code: [`CLAUDE.md`](CLAUDE.md).
- Nguồn sự thật workflow: `.agent-workflow/`. State máy: `.loop-engineer/state/`.
- Chế độ vận hành mặc định: **`LEAN`** (một Agent Lead tuần tự, review theo slice, checkpoint có chọn lọc).
