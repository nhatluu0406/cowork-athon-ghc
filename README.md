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

## Giới hạn hiện tại (known limitations)

Xem [docs/quality/known-limitations.md](docs/quality/known-limitations.md) và
[docs/product/current-status.md](docs/product/current-status.md).

## Cho agent (Claude / Codex)

- Điểm vào: [`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md).
- Tài liệu canonical: [`docs/README.md`](docs/README.md).
- Chế độ mặc định: **LEAN** (một agent, slice nhỏ, test tập trung).
