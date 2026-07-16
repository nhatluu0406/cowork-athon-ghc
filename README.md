<div align="center">
  <img src="docs/assets/cowork-ghc-logo-256.png" width="112" alt="Cowork GHC logo" />

# Cowork GHC

**Local-first AI workspace for Windows — chat, files, Skills, providers, permissions, and agent-assisted work in one desktop app.**

[![Windows 11](https://img.shields.io/badge/Windows-11-0078D4?logo=windows11&logoColor=white)](#requirements)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](#technology)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](#technology)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](#requirements)
[![License](https://img.shields.io/badge/License-MIT-orange)](LICENSE)
[![Status](https://img.shields.io/badge/Status-POC%20Demo-orange)](docs/product/current-status.md)

[Features](#features) · [Quick start](#quick-start) · [Configuration](#configuration) · [Architecture](#architecture) · [Roadmap](docs/product/roadmap.md) · [Documentation](docs/README.md)

</div>

---

## Overview

Cowork GHC is a Windows desktop AI cowork environment. It connects a local workspace to an LLM through a supervised OpenCode runtime, keeps credentials in Windows Credential Manager, asks for permission before sensitive actions, and preserves conversations and file-work evidence locally.

The current target is a polished, local-first POC for product demonstration—not a cloud multi-user release.

## Features

### Cowork chat

- New Chat startup and persistent conversation history
- Streaming assistant responses and bounded multi-turn context
- Conversation search, rename, and delete
- Text attachments with secret-like file blocking
- Permission modes: ask first, workspace automation, and read-only
- Verified file-action handling and File Work Review foundations

### Workspace Companion

- Workspace folder picker and guarded file navigation
- Preview for text, Markdown, images, PDF, DOCX, and XLSX within current safety limits
- Direct editing for supported small text/Markdown files
- Agent-driven file refresh with protection for unsaved edits
- Cowork conversation available alongside workspace work

### Provider profiles

- Multiple saved provider connections
- DeepSeek preset
- Custom OpenAI-compatible endpoint, model ID, and API token
- API keys stored in Windows Credential Manager
- Active provider/model presentation and readiness state

### Skills

- Built-in and user-managed local `SKILL.md` files
- Create, edit, delete, enable, and disable user Skills
- Built-in Skills remain read-only
- Skill provenance stored without persisting raw Skill instructions in chat history

### Desktop product shell

- Commercial light and dark visual system
- Native Windows titlebar controls and Snap Layout compatibility
- Product surfaces for Cowork, Dispatch, Gateway, Knowledge, Microsoft 365, and Code
- D1–D4 surfaces are integration mount points; their backends are not yet merged

## Screenshots

> Keep accepted packaged screenshots under `docs/demo/screenshots/` and update them only at a UI milestone.

| Cowork | Workspace | Settings |
|---|---|---|
| `docs/demo/screenshots/01-new-chat.png` | `docs/demo/screenshots/03-workspace.png` | `docs/demo/screenshots/02-provider-settings.png` |

## Architecture

```text
Electron renderer
    ↓ typed preload bridge
Electron main process
    ↓ loopback HTTP/SSE + capability-scoped IPC
Local application service
    ↓ supervised child process
OpenCode runtime
    ↓ provider profile
LLM endpoint
```

Core principles:

- local-first application state;
- renderer does not receive unrestricted Node.js or IPC access;
- filesystem actions stay inside the active workspace boundary;
- permission is enforced at the execution boundary;
- secrets never belong in UI state, logs, screenshots, or profile JSON;
- assistant prose is not proof that a file mutation succeeded.

See [System overview](docs/architecture/system-overview.md).

## Technology

| Layer | Technology |
|---|---|
| Desktop shell | Electron 33 |
| Renderer | TypeScript, Vite, DOM-based UI modules |
| Local service | Node.js, TypeScript, loopback HTTP/SSE |
| Agent runtime | OpenCode child process |
| Packaging | electron-builder |
| Credential storage | Windows Credential Manager via `@napi-rs/keyring` |
| Application persistence | Local JSON files written atomically; no SQL database in the current POC |
| Tests | Node test runner through `tsx` |

## Repository structure

```text
app/
  shell/            Electron main process, preload bridge, packaging
  ui/               Renderer and UI shell
core/contracts/     Shared typed contracts
service/            Local application service and business boundaries
runtime/            OpenCode runtime integration
skills/             Packaged built-in Skills
scripts/            Windows entry scripts
tools/              App lifecycle and focused verification utilities
docs/               Canonical product, architecture, quality, and demo docs
```

## Requirements

- Windows 11
- Node.js 22 or newer
- npm
- A compatible LLM API key for chat/runtime use

## Quick start

```bat
npm install
scripts\init.bat
scripts\build.bat
scripts\start.bat
```

Stop the app cleanly:

```bat
scripts\stop.bat
```

Create a safe demo workspace:

```bat
scripts\demo-seed.bat
```

## Configuration

### Provider connection

1. Open **Settings → Nhà cung cấp**.
2. Select **Thêm kết nối**.
3. Choose the DeepSeek preset or an OpenAI-compatible connection.
4. Enter display name, endpoint, model ID, and API token.
5. Test the connection and set the desired profile active.

Saved API tokens are stored in Windows Credential Manager. Profile JSON contains only non-secret metadata and credential status/handles.

### Permission mode

The composer supports:

- **Hỏi trước** — ask before file mutation or command execution;
- **Tự động trong workspace** — allow supported workspace operations according to the implemented policy;
- **Chỉ đọc** — deny mutations and execution.

For product demos, use **Hỏi trước**.

### Theme

Open **Settings → Chung** and select:

- Theo hệ thống
- Sáng
- Tối

## Development commands

```bash
npm run typecheck
npm test
npm run build:renderer
npm run build:app
npm run package:win
npm run verify:release
```

Fast pre-commit verification on Windows:

```bat
scripts\verify-fast.bat
```

## Windows scripts

| Script | Purpose |
|---|---|
| `scripts/init.bat` | Prepare the local environment idempotently |
| `scripts/build.bat` | Typecheck and package the Windows application |
| `scripts/start.bat` | Start the packaged application |
| `scripts/stop.bat` | Stop only Cowork-owned processes |
| `scripts/clean.bat` | Remove allowlisted generated artifacts |
| `scripts/demo-reset.bat` | Reset demo-safe state without deleting keyring credentials |
| `scripts/demo-seed.bat` | Create representative demo files |
| `scripts/verify-fast.bat` | Run the normal focused pre-commit checks |

See [scripts/README.md](scripts/README.md).

## Security model

- Credentials are stored in Windows Credential Manager.
- Renderer state never receives saved plaintext API keys.
- Workspace paths are validated and confined by the local service.
- Secret-like attachments and previews are blocked or redacted.
- Diagnostics use secret scrubbing.
- OpenCode runs as a supervised child process with bounded configuration.

## Current status

Cowork GHC is a POC demo candidate. Core chat, provider, Skill, workspace, theme, and permission foundations exist; remaining demo work is tracked explicitly rather than hidden behind broad “PASS” claims.

## Slash commands

Gõ trong composer. `/help` liệt kê toàn bộ lệnh đang có.

| Lệnh | Tác dụng |
|---|---|
| `/help` | Liệt kê các lệnh được hỗ trợ |
| `/remote` | Mở panel ghép nối điện thoại (URL + mã + QR). `/remote off` thu hồi mọi thiết bị |
| `/clear` | Nén lịch sử hội thoại rồi tải lại view từ service |
| `/compact` | Nén lịch sử hội thoại, giữ nguyên view |
| `/bug` | Xuất thông tin chẩn đoán của client |
| `/review` | Sinh prompt review từ các tệp đang mở trong workspace |

Registry nằm ở `app/ui/src/commands/registry.ts` (hàm `createDefaultRegistry`) — thêm lệnh mới bằng
`registry.register({ name, description, type, handler })`. Hai `type`:

- `client_side` — handler chạy một hành động trong UI, không gửi gì cho LLM.
- `prompt_template` — handler trả về một chuỗi; chuỗi đó vào composer rồi được gửi như prompt.

`/clear` và `/compact` gọi `POST /v1/conversations/{id}/compact`. Nén là **thao tác phá huỷ**: nó
thay toàn bộ transcript bằng bản tóm tắt. Provider lỗi thì lệnh báo lỗi và **giữ nguyên lịch sử**.

> **Lưu ý:** slash commands hiện chỉ chạy trên desktop. Registry nằm ở tầng UI nên PWA trên điện
> thoại gửi thẳng text thô — gõ `/help` trên điện thoại sẽ gửi đúng chữ `/help` cho LLM.

## Dispatch (agents, tasks, fan-out)

Contract và store đã có ở service; **UI surface Dispatch vẫn chờ backend D1**, nên màn hình đó
không hiển thị dữ liệu D1 giả. Hiện nó dùng làm chỗ **ghép nối điện thoại nhanh** (QR) mà không
cần gõ `/remote`.

| Endpoint | Tác dụng |
|---|---|
| `GET/POST/PUT/DELETE /v1/agents` | Agent catalog: built-in (researcher/implementer/reviewer, read-only) + agent do user tạo |
| `GET/POST/PUT/DELETE /v1/tasks` | Task template: built-in (`tpl-investigate`, `tpl-implement-verified`, `tpl-fanout-review`) + task do user tạo |
| `POST /v1/tasks/{id}/instantiate` | Dùng lại template bằng 1 thao tác (1-touch reuse) |

Contract ở `core/contracts/src/dispatch.ts`: `TaskDefinition` / `AgentDefinition` / `LoopPolicy`.
Permission preset của agent **chỉ được thu hẹp** (`isNarrowingPreset`) — một agent không bao giờ tự
nới quyền vượt `LIVE_SESSION_PERMISSION_POLICY`. Fan-out chạy với concurrency mặc định 3, cap cứng 5
(`service/src/dispatchers/fanout.ts`).

Thêm agent/task mới: sửa `service/src/agents/builtins.ts` hoặc `service/src/tasks/builtins.ts` cho
loại built-in; loại user-local đi qua router CRUD và lưu vào `.runtime/`.

## Điều khiển từ điện thoại (Remote — tính năng tùy chọn)

Cowork GHC có một **cổng remote** để theo dõi và điều khiển từ điện thoại/trình duyệt khác, tương tự
Remote Control của Claude Code. **Tắt mặc định**; bật bằng biến môi trường. Chi tiết kiến trúc:
[ADR 0010](docs/architecture/decisions/0010-remote-gateway-and-pwa-surface.md) và
[`agent-harness-plan.md`](agent-harness-plan.md).

Một feature, **3 channel** (dùng chung một pairing registry + một permission gate):

| Channel | Kiểu | Bật bằng |
|---|---|---|
| `lan-qr` | PWA qua LAN, ghép nối bằng QR/mã một lần | `CGHC_REMOTE_ENABLED=1` + `CGHC_REMOTE_LAN=1` |
| `tunnel` | PWA qua Tailscale/VPN (gateway giữ loopback) | `CGHC_REMOTE_ENABLED=1` (không đặt `CGHC_REMOTE_LAN`) |
| `discord` | Bot Discord: notify + `deny` + gửi prompt | `CGHC_DISCORD_ENABLED=1` + token/channel/allowlist |

### Bật gateway PWA (lan-qr / tunnel)

```powershell
$env:CGHC_REMOTE_ENABLED = "1"     # bật feature remote
$env:CGHC_REMOTE_LAN     = "1"     # tùy chọn: bind LAN cho cùng Wi-Fi (chưa TLS — chỉ demo)
$env:CGHC_REMOTE_PORT    = "7777"  # tùy chọn: cố định port (mặc định ephemeral)
scripts\start.bat
```

Có hai chỗ ghép nối, dùng chung một pairing registry:

- Gõ **`/remote`** ở ô soạn → panel overlay: địa chỉ mở trên điện thoại, **mã ghép nối một lần +
  QR**, danh sách thiết bị đã ghép, **thu hồi tất cả** (`/remote off`).
- Mở tab **Dispatch** → mục "Truy cập nhanh bằng điện thoại" với cùng QR đó, không cần gõ lệnh.
  Tab này vẫn báo D1 **chờ tích hợp**; ghép nối điện thoại không liên quan tới backend D1.

Trên điện thoại (cùng Wi-Fi hoặc qua VPN): mở URL gateway → quét QR (tự điền mã) hoặc nhập mã →
đặt tên thiết bị → **Kết nối**. Sau đó điện thoại có thể:

- xem danh sách hội thoại, transcript, và **stream trực tiếp** của phiên đang chạy;
- **Cho phép 1 lần / Từ chối** khi agent xin quyền (Deny chặn thật ở execution boundary);
- **gửi prompt** tới phiên đang chạy.

### Bật channel Discord (notify + deny + prompt)

```powershell
$env:CGHC_DISCORD_ENABLED         = "1"
$env:CGHC_DISCORD_BOT_TOKEN       = "<bot token>"      # chỉ nằm trong process, không bao giờ log
$env:CGHC_DISCORD_CHANNEL_ID      = "<channel id>"     # 1 channel/thread trong guild riêng của bạn
$env:CGHC_DISCORD_ALLOWED_USER_IDS = "<id1>,<id2>"     # allowlist — ngoài danh sách bị bỏ qua
scripts\start.bat
```

Bot chỉ kết nối **outbound** (không mở cổng vào máy). Nó đẩy thông báo **đã lược bỏ nội dung nhạy
cảm** khi agent xin quyền / phiên kết thúc, và nhận lệnh từ user trong allowlist:

- `deny <requestId>` — từ chối một yêu cầu quyền (chặn thật ở gate);
- `pending` — liệt kê yêu cầu đang chờ;
- văn bản thường — gửi làm prompt cho phiên gần nhất;
- `approve …` — **bị từ chối theo thiết kế**: phê duyệt hành động ghi tệp bắt buộc từ PWA/desktop
  (nếu tài khoản Discord bị chiếm, kẻ tấn công chỉ chặn được việc, không cho phép được việc).

Bot **không bao giờ** gửi nội dung tệp/diff/secret lên Discord — chỉ tóm tắt ngắn + deep link mở app.

### Giới hạn của Remote (MVP — đọc kỹ)

- `CGHC_REMOTE_LAN` **chưa có TLS** → chỉ dùng demo cùng Wi-Fi; kênh `tunnel` (Tailscale/VPN) an
  toàn hơn cho dùng thật. TLS + cert pinning cho `lan-qr` là hạng mục hardening kế tiếp.
- Device token **lưu trong bộ nhớ theo phiên chạy** → khởi động lại app thì điện thoại ghép nối lại.
- Việc runtime OpenCode live tiêu thụ lệnh qua Discord **chưa được kiểm chứng end-to-end** với bot
  thật (unit test dùng transport giả). Chưa có xác minh packaged cho toàn bộ remote.
- Chưa có Web Push (thông báo khi rời app do Discord đảm nhiệm).

- [Current status](docs/product/current-status.md)
- [Product plan](docs/product/product-plan.md)
- [Roadmap](docs/product/roadmap.md)
- [Demo acceptance](docs/quality/demo-acceptance.md)
- [Known limitations](docs/quality/known-limitations.md)

## Contributing with coding agents

Read in this order:

1. [AGENTS.md](AGENTS.md)
2. [docs/README.md](docs/README.md)
3. [Current status](docs/product/current-status.md)
4. [Roadmap](docs/product/roadmap.md)
5. The current Git diff

Default workflow is LEAN: one agent, one bounded slice, focused verification, one meaningful commit.
