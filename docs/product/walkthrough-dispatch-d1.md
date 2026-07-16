---
title: "Walkthrough — khởi động Cowork GHC và dùng Dispatch (D1)"
document_type: "walkthrough"
language: "vi"
status: "accepted"
date: "2026-07-16"
---

# Walkthrough — khởi động Cowork GHC và dùng Dispatch (D1)

Tài liệu này hướng dẫn **khởi động** app và **đi hết một lượt** tính năng Dispatch / fan-out (D1),
gồm cách trỏ vào một LLM chạy local qua `http` (private-gpt gateway hoặc Ollama) bằng dev skip mới.
Nguồn sự thật về trạng thái: `docs/product/current-status.md`.

## 0. Điều kiện tiên quyết

- Windows 11, **Node.js ≥ 22**, npm 11.
- `npm install` ở repo root (cài dependency của tất cả workspaces).
- Một endpoint LLM. Ba lựa chọn:
  - **Local loopback (khuyến nghị cho dev/demo):** private-gpt gateway `http://127.0.0.1:8080`
    hoặc Ollama `http://localhost:11434` — cần **dev skip** ở mục 2.
  - Endpoint `https` thật (không cần skip).
  - Mock LLM deterministic (`COWORK_GHC_E2E_MOCK_LLM_BASE_URL`) cho verification không cần LLM thật.

## 1. Khởi động nhanh (packaged app)

```powershell
scripts\init.bat     # chuẩn bị môi trường (idempotent)
scripts\start.bat    # khởi động packaged app
scripts\stop.bat     # dừng các process đã track
```

Lệnh dev tương đương (chạy từ source, không packaged):

```powershell
npm install
scripts\verify-fast.bat   # typecheck + focused tests + renderer build (chạy trước khi commit)
```

## 2. Dùng LLM chạy local qua http (dev skip) — gỡ chặn live dispatch

Mặc định outbound SSRF policy chặn `http` (yêu cầu `https`), nên `http://127.0.0.1:8080` bị từ chối
với `scheme_not_https`. Bật **dev skip** (opt-in, OFF mặc định — xem
[ADR 0012](../architecture/decisions/0012-dev-loopback-http-override.md)):

```powershell
$env:COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP = "1"   # chỉ nới loopback http; private/link-local/metadata VẪN chặn
scripts\start.bat
```

Khi bật, app log một banner WARN "DEV loopback-http override ACTIVE …". Skip này **chỉ** cho phép
`http` khi mọi địa chỉ resolve là loopback (`127.0.0.1`/`::1`) — không nới được gì khác, và **không**
bật được từ request body/PWA/model (chỉ từ env ở tiến trình).

> ⚠️ Chỉ dùng cho dev/demo. Khi bật, service sẽ POST kèm `Authorization` (key provider) tới đúng
> loopback port bạn cấu hình — đừng trỏ nhầm port, và đừng để env này lọt vào bản phát hành.

Lưu key provider vào Windows Credential Manager (không bao giờ nằm trên command line / file / env):

```powershell
scripts\set-provider-key.bat custom   # nhập/paste key ở prompt ẩn; "custom" = provider id (không phải key)
```

Rồi trong app: **Provider settings** → custom OpenAI-compatible → `base_url = http://127.0.0.1:8080/v1`
→ **Test connection** → chọn model.

## 3. Walkthrough Dispatch / fan-out (D1)

### 3.1. Agent & task đã có sẵn

- Built-in agents (read-only): `researcher`, `implementer`, `reviewer`
  (`service/src/agents/builtins.ts`). `researcher`/`reviewer` khai `edit: "deny"` và **thật sự
  không ghi được file** — preset được enforce ở execution boundary (xem 3.4).
- Built-in task templates: `tpl-investigate`, `tpl-implement-verified`, `tpl-fanout-review`
  (`service/src/tasks/builtins.ts`).

### 3.2. Chạy một task từ composer (desktop)

Gõ trong ô soạn:

| Lệnh | Tác dụng |
|---|---|
| `/dispatch` | Liệt kê task có thể chạy (kèm id, loop mode, hình fan-out) |
| `/dispatch run <task-id>` | Chạy một task đã lưu (fan-out các branch) |
| `/dispatch runs` | Liệt kê các lượt chạy |
| `/dispatch cancel <run-id>` | Hủy một lượt chạy (hủy cả nhóm) |

Theo dõi trực quan ở **bề mặt Dispatch**: catalog task + run view live (status, attempts, verified,
trạng thái từng branch), poll 3s **chỉ khi** đang chạy.

### 3.3. Fan-out hoạt động thế nào

Fan-out chạy với concurrency mặc định **3**, `maxConcurrency` per task, **trần cứng 5** enforce ở
service (`core/contracts/src/dispatch.ts`, `service/src/dispatchers/fanout.ts`). Mỗi branch = một
child session **thật** qua đúng session service + prompt seam + **MỘT** permission gate. Một branch
fail **không** biến cả nhóm thành success giả.

### 3.4. Permission gate + preset (điểm demo quan trọng)

Fan-out được điều phối ở service (`task` tool bị deny trong child policy nên branch không tự spawn
sub-agent vượt gate). Preset của agent **chỉ thu hẹp**: một branch `reviewer`/`researcher` thử ghi
file sẽ **tự bị từ chối** ở boundary (branch hiện `errored`), user **không** bị hỏi. Nhánh nào cần
**tạo file** để khoe kết quả thì dùng agent `implementer` (preset rỗng).

`retry_until_verified` chỉ báo `verified` khi có **bằng chứng file/disk thật**; hết lượt mà chưa có
là `exhausted` — **không bao giờ** `completed` giả.

### 3.5. Workflow builder từ prompt (Task 4.3)

Mô tả workflow bằng ngôn ngữ tự nhiên → LLM sinh **draft** `TaskDefinition` → validate bắt buộc qua
contract → trả draft để review → **confirm riêng mới lưu**. Không đường nào chạy draft chưa confirm.

## 4. Điều khiển từ điện thoại (Remote / PWA — tùy chọn)

```powershell
$env:CGHC_REMOTE_ENABLED = "1"
$env:CGHC_REMOTE_LAN     = "1"    # tùy chọn: bind LAN cùng Wi-Fi (CHƯA TLS — chỉ demo)
scripts\start.bat
```

Gõ **`/remote`** (hoặc mở tab **Dispatch**) → quét QR trên điện thoại → đặt tên thiết bị → Kết nối.
Từ điện thoại: xem hội thoại + stream live; **Allow/Deny** quyền (Deny chặn thật ở boundary); **gửi
prompt**; và **1-touch run** một task đã lưu + xem/hủy run. Route từ phone **chỉ** read + 1-touch-run
+ cancel — không tạo/sửa/xóa task được. Discord (tùy chọn) chỉ notify + `deny` + gửi prompt;
**không** approve được lệnh ghi.

> LAN mode chưa có TLS (device token đi plaintext) → chỉ demo cùng Wi-Fi; dùng thật nên đi `tunnel`
> (Tailscale/VPN). Device token lưu theo phiên chạy → khởi động lại thì ghép nối lại.

## 5. Skills

Skill registry quét thư mục để dò skill: mỗi skill là một **thư mục chứa `SKILL.md`** (frontmatter
`id/name/description/version` + body), bounded (tối đa 64 skill, 32KB/file), an toàn (từ chối symlink,
thoát root, binary, id trùng). UI có **skills-panel** + **skills-settings** để bật/tắt/preview; skill
được dùng hiện chip "Kỹ năng · name·version" trên message.

> **Hiện tại chỉ quét `.runtime/skills`** (source `user_local`). Thư mục `.agents/skills` (7 skill:
> docx/pdf/pptx/xlsx/data-visualization/documentation/cowork-ghc-commercial-ui) **chưa được nối** làm
> root `built_in`, và các `SKILL.md` đó dùng frontmatter kiểu Claude Code (`name`/`description`, thiếu
> `id`/`version`) nên nếu nối thẳng sẽ bị đánh dấu invalid — cần nối root **và** nới schema frontmatter
> (suy `id` từ tên thư mục, default `version`). Đây là hạng mục follow-up.

## 6. Dọn dẹp

```powershell
scripts\stop.bat          # dừng process đã track
scripts\demo-reset.bat    # reset state demo-safe (giữ keyring)
scripts\clean.bat         # xóa generated/downloaded theo allowlist (không đụng credential/history)
```

## Trạng thái so với Claude Code (tóm tắt)

| Tính năng | Trạng thái |
|---|---|
| Slash `/` command | ✅ Có (`/help /remote /clear /compact /bug /dispatch /review`) |
| Skill registry (quét thư mục) | ✅ Có cơ chế; hiện chỉ quét `.runtime/skills` — chưa nối `.agents/skills` |
| `@` command (chèn file/context) | ❌ Chưa có typeahead `@`-mention |
| Dispatch / fan-out (D1) | ✅ Có (chạy thật; packaged/live Checkpoint 5 cần provider — dùng dev skip mục 2) |
