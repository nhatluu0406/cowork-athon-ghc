---
language: "vi"
status: "active"
updated_at: "2026-07-17"
---

# Cowork GHC — Thiết kế hệ thống (diagram-ready)

Tài liệu này mô tả hệ thống đang chạy (theo Git HEAD) ở dạng **có cấu trúc đủ để sinh ra
bản vẽ**: từ các bảng node/edge/boundary/layout bên dưới có thể dựng trực tiếp
**một trang HTML** (SVG/CSS grid) hoặc **một file Excalidraw** mà không cần đọc thêm code.

- Sự thật trạng thái (WORKS/PARTIAL/…) thuộc `product/current-status.md`; tài liệu này chỉ
  ghi **hình dạng** hệ thống và gắn nhãn trạng thái tại thời điểm `updated_at`.
- Chuỗi runtime chuẩn: `renderer → typed preload → loopback local service → SQLite + vault
  → supervised OpenCode runtime → provider / MCP / workspace`.

---

## 1. Mô hình tầng (cột của bản vẽ)

Bản vẽ chính là sơ đồ khối 6 cột, trái → phải theo hướng dữ liệu đi ra ngoài:

| Cột | ID tầng | Tên | Màu nền gợi ý | Chứa gì |
|---|---|---|---|---|
| C0 | `clients` | Người dùng & thiết bị ngoài | `#e9ecef` xám | Người dùng desktop, điện thoại (PWA), Discord |
| C1 | `renderer` | Renderer (Electron, sandboxed) | `#a5d8ff` xanh dương | UI 7 surface, service-client, EV stream client |
| C2 | `shell` | Electron Shell (main process) | `#b2f2bb` xanh lá | Window/security, preload bridge, service controller |
| C3 | `service` | Local Service (loopback HTTP) | `#ffec99` vàng | Router `/v1/*`, domain logic, permission gate, dispatch, remote gateway |
| C4 | `data-runtime` | Dữ liệu & Agent runtime | `#ffc9c9` đỏ nhạt (data) / `#d0bfff` tím (runtime) | SQLite vault, logs, workspace FS, OpenCode child |
| C5 | `external` | Hệ thống ngoài (network) | `#e9ecef` xám, viền đứt | LLM provider, MCP server, MS Graph |

## 2. Danh mục node

Quy ước `type`: `actor` (người/thiết bị), `component` (khối code), `store` (dữ liệu),
`process` (tiến trình OS riêng), `external` (dịch vụ ngoài), `frame` (khung nhóm).
`status`: WORKS / PARTIAL / FLAG-OFF (tắt mặc định) / AWAITING (chỉ là slot).

### C0 — clients

| ID | Nhãn (hiển thị) | Type | Code | Status |
|---|---|---|---|---|
| `user` | Người dùng desktop | actor | — | WORKS |
| `phone` | Điện thoại — PWA remote | actor | `service/src/remote-gateway/pwa.ts` | FLAG-OFF (`CGHC_REMOTE_ENABLED`) |
| `discord` | Discord channel | actor | `service/src/remote-gateway/` (adapter) | FLAG-OFF (`CGHC_DISCORD_ENABLED`) |

### C1 — renderer (app/ui)

| ID | Nhãn | Type | Code | Status |
|---|---|---|---|---|
| `ui-shell` | App shell + product rail (7 surface) | component | `app/ui/src/app-shell.ts`, `surface-registry.ts` | WORKS |
| `ui-cowork` | Surface Cowork (chat + timeline + Inspector) | component | `conversation-controller.ts`, `timeline-view.ts`, `session-panel.ts` | WORKS |
| `ui-workspace` | Workspace Companion (preview/edit, PDF/Office) | component | `workspace-companion-pane.ts`, `workspace-navigator.ts` | WORKS — Wave 4 |
| `ui-skills-mcp` | Surface Kỹ năng & MCP (hub) | component | `skills-panel.ts`, `mcp-panel.ts` | WORKS |
| `ui-dispatch` | Surface Dispatch (board + run views) | component | `dispatch-board.ts`, `dispatch-plan.ts` | WORKS (dev; chưa packaged) |
| `ui-settings` | Settings full-screen (provider, chẩn đoán, remote) | component | `settings-view.ts`, `provider-profiles-panel.ts`, `remote-panel.ts` | WORKS |
| `ui-permission` | Permission modal + File Work Review | component | `permission-modal.ts`, `activity-panel.ts` | WORKS |
| `ui-svc-client` | Service client + EV stream client | component | `service-client.ts`, `ev-stream-client.ts` | WORKS |
| `ui-microsoft` | Surface Microsoft 365 (shell disconnected) | component | rail `microsoft` | PARTIAL (D2 flag-off) |
| `ui-code` | Surface Code (Claude Code, 3 cột) | component | rail `code` | WORKS |
| `ui-gateway` | Surface Gateway (slot D4) | component | rail `gateway` | AWAITING |
| `ui-knowledge` | Surface Knowledge (slot D3) | component | rail `knowledge` | AWAITING |

### C2 — shell (app/shell)

| ID | Nhãn | Type | Code | Status |
|---|---|---|---|---|
| `sh-window` | BrowserWindow + app:// protocol + CSP + chặn điều hướng | component | `create-window.ts`, `security/*` | WORKS |
| `sh-preload` | Typed preload bridge (contextBridge, 7 key) | component | `preload.ts`, `ipc/bridge.ts` | WORKS |
| `sh-ipc` | IPC handlers (allowlist channel) | component | `ipc/register-handlers.ts`, `ipc/channels.ts` | WORKS |
| `sh-svc-ctl` | Service controller (tiered start: settings-only → live) | component | `service/service-controller.ts`, `tiered-start-service.ts` | WORKS |
| `sh-paths` | Data-path resolver (`<userData>`) | component | `service/cowork-data-paths.ts` | WORKS |

7 key của bridge (đúng bằng, không hơn): `getBootstrap`, `connectLive`, `pickWorkspaceFile`,
`pickWorkspaceFolder`, `saveTextFile`, `setDevToolsEnabled`, `setWindowTheme`.

### C3 — service (service/src) — vẽ thành 1 frame lớn chứa các node con

| ID | Nhãn | Type | Code | Status |
|---|---|---|---|---|
| `svc-http` | Loopback HTTP server + bearer token guard | component | `server/` (mount router) | WORKS |
| `svc-compose` | Composition root (SSOT wiring) | component | `composition/compose-service.ts` | WORKS |
| `svc-session` | Session + streaming (`/v1/session`) — EV mapper/reducer, stream hub, coalesce | component | `session/`, `execution/` | WORKS |
| `svc-conv` | Conversations (`/v1/conversations`) — persist message + turn summary, compaction | component | `conversation/` | WORKS |
| `svc-perm` | Permission gate + ToolPermissionProxy + preset enforce (`/v1/permission`) | component | `permission/` | WORKS |
| `svc-freview` | File Work Review (`/v1/file-review`) — snapshot SHA-256 + unified diff | component | `file-review/`, `files/` | WORKS |
| `svc-workspace` | Workspace (`/v1/workspace`) — đọc/ghi trong boundary, PPTX/XLSX/DOCX engine | component | `workspace/` (`pptx.ts`, `file-content.ts`) | WORKS — Wave 4 |
| `svc-skills` | Skills catalog (`/v1/skills`) — CRUD, enable/disable | component | `skills/` | WORKS |
| `svc-mcp` | MCP config (`/v1/mcp`) — stdio/URL, reachability adapter | component | `mcp/` | WORKS — Phase 1 (toolCount 0) |
| `svc-provider` | Provider + profiles (`/v1/providers`, `/v1/provider-profiles`) — verify fingerprint | component | `provider/`, `provider-profiles/` | WORKS — BASIC |
| `svc-auth` | Local auth (`/v1/auth`) — unlock/lock vault | component | `db/auth-router.ts`, `credential/` | WORKS |
| `svc-settings` | Settings (`/v1/settings`) | component | `diagnostics/settings-router.ts` | WORKS |
| `svc-diag` | Diagnostics (`/v1/diagnostics`) — log sink, telemetry counters, export redacted | component | `diagnostics/` | WORKS — Wave 6 |
| `svc-tasks` | Tasks + workflow builder (`/v1/tasks`) — loop runner, verify-evidence hook | component | `tasks/` | WORKS (dev) |
| `svc-dispatch` | Dispatch runs (`/v1/dispatch`) — run registry, fan-out branch runner | component | `dispatchers/`, `agents/` | WORKS (dev; chưa packaged — ADR 0011) |
| `svc-remote` | Remote gateway — pairing, listener riêng, reverse-proxy allowlist, PWA, QR (`/v1/remote`) | component | `remote-gateway/` | FLAG-OFF (`CGHC_REMOTE_ENABLED`) |
| `svc-ms365` | MS365 connector + SharePoint tools (`/v1/ms...`) | component | `ms365/` | FLAG-OFF (`CGHC_MS365_ENABLED`) |
| `svc-ssrf` | SSRF policy (outbound guard) | component | `boundary/` | WORKS |

### C4 — data & runtime

| ID | Nhãn | Type | Code | Status |
|---|---|---|---|---|
| `db` | SQLite `<userData>/cowork-ghc.db` (migration 1–3) | store | `service/src/db/` | WORKS |
| `vault` | Encrypted vault — scrypt KEK bọc AES-256-GCM master key (chỉ ở memory sau unlock) | store | `db/vault-crypto.ts`, `vault-credential-store.ts` | WORKS |
| `logs` | `data/logs` — JSON-lines xoay vòng, đã scrub secret | store | `diagnostics/log-file-sink.ts` | WORKS — Wave 6 |
| `ws-fs` | Workspace folder (filesystem, trong boundary) | store | — | WORKS |
| `skill-fs` | Skill files (filesystem) | store | `skills/` | WORKS |
| `opencode` | OpenCode child — supervised, pin **v1.18.1** (fallback 1.17.20) | process | `runtime/src/` (`pin.ts`, `provider-env.ts`, `redact.ts`) | WORKS — PINNED |

### C5 — external

| ID | Nhãn | Type | Status |
|---|---|---|---|
| `llm` | LLM provider — DeepSeek preset / custom OpenAI-compatible (HTTPS; loopback-http chỉ khi dev skip ADR 0012) | external | WORKS |
| `mcp-srv` | MCP servers (stdio hoặc URL) | external | Phase 1 — reachability only |
| `msgraph` | Microsoft Graph / SharePoint | external | FLAG-OFF (D2) |

## 3. Danh mục cạnh (edge)

Quy ước `style`: `solid` = luôn hoạt động; `dashed` = sau flag/điều kiện; nhãn ghi giao thức.

| ID | Từ → Đến | Nhãn trên mũi tên | Style |
|---|---|---|---|
| E01 | `user` → `ui-shell` | thao tác UI | solid |
| E02 | `ui-shell` → `sh-preload` | `window.coworkShellBridge` (7 key) | solid |
| E03 | `sh-preload` → `sh-ipc` | `ipcRenderer.invoke` (channel allowlist) | solid |
| E04 | `sh-svc-ctl` → `svc-http` | spawn + health check; cấp `baseUrl` + token | solid |
| E05 | `ui-svc-client` → `svc-http` | HTTP `127.0.0.1:<port>` + Bearer token | solid |
| E06 | `svc-http` → `ui-svc-client` | SSE — EV stream (token/tool/permission/terminal, đã coalesce) | solid |
| E07 | `svc-*` (mọi domain) → `db` | better-sqlite3 (repo) | solid |
| E08 | `svc-auth` → `vault` | unlock: scrypt KEK → mở master key trong memory | solid |
| E09 | `svc-provider`/`svc-mcp`/`svc-ms365` → `vault` | đọc/ghi secret mã hoá (account `mcp:<id>:header`, …) | solid |
| E10 | `svc-session` → `opencode` | spawn supervised + HTTP/SSE tới child server; key inject **env-only** | solid |
| E11 | `opencode` → `llm` | HTTPS chat completions (qua `svc-ssrf` policy) | solid |
| E12 | `opencode` → `svc-perm` | permission ask (tool call) → gate | solid |
| E13 | `svc-perm` → `ui-permission` | pending → modal Hỏi trước / Tự động / Chỉ đọc | solid |
| E14 | `svc-freview` → `ws-fs` | snapshot before/after + diff (verified evidence) | solid |
| E15 | `svc-workspace` → `ws-fs` | đọc/ghi file trong workspace boundary | solid |
| E16 | `svc-skills` → `skill-fs` | CRUD Skill files; OpenCode load on-demand | solid |
| E17 | `svc-mcp` → `mcp-srv` | stdio spawn / URL (SSRF-guarded) | solid |
| E18 | `svc-diag` → `logs` | ghi log đã scrub; export bundle redacted qua save-dialog của shell | solid |
| E19 | `svc-dispatch` → `svc-session` | mỗi branch fan-out = 1 child session thật (CÙNG session service) | solid |
| E20 | `svc-dispatch` → `svc-perm` | bind `sessionId → permissionPreset` trước `sendPrompt` (deny-by-policy `agent_preset`) | solid |
| E21 | `phone` → `svc-remote` | pair (code 1 lần TTL 2', QR) → device token; poll 3s | dashed |
| E22 | `svc-remote` → `svc-http` | reverse-proxy **allowlist** (conversations/session/permission/tasks/dispatch — phone không CRUD task) | dashed |
| E23 | `svc-remote` → `discord` | notify redacted + nhận `deny`/prompt (outbound-only) | dashed |
| E24 | `svc-ms365` → `msgraph` | Graph API (manual token; device-code gated) | dashed |
| E25 | `svc-ms365` → `opencode` | advertise tool endpoint qua env `CGHC_MS365_TOOL_ENDPOINT` | dashed |
| E26 | `sh-window` → `ui-shell` | load `app://` + CSP + chặn navigation/window.open | solid |

## 4. Ranh giới tin cậy (vẽ thành khung viền đậm, có nhãn)

| ID | Khung | Bao gồm node | Bất biến |
|---|---|---|---|
| B1 | Renderer sandbox | toàn bộ C1 | Không chạm DB, không thấy secret bytes; chỉ preload + HTTP token |
| B2 | Main process | toàn bộ C2 | Giữ token service; CSP/no-navigation; save-dialog là đường ghi file duy nhất của renderer ra ngoài workspace |
| B3 | Local trust zone | C3 + `db`/`vault`/`logs` | Loopback-only; mọi secret mã hoá; log/telemetry local-only, không egress |
| B4 | Child runtime | `opencode` | Exact pin; key env-only; mutation phải qua permission gate + File Work Review |
| B5 | Network egress | C5 | Mọi outbound qua SSRF policy (https; loopback-http chỉ dev skip ADR 0012) |
| B6 | Remote surface (flag) | `phone`, `discord`, `svc-remote` | Listener riêng + allowlist; LAN mode chưa TLS (dev/demo) |

## 5. Luồng chính (vẽ được thành sequence hoặc mũi tên đánh số trên sơ đồ khối)

### F1 — Khởi động & mở khoá
1. `sh-svc-ctl` start service tier **settings-only** → health OK.
2. Người dùng nhập mật khẩu → E05 `POST /v1/auth` → E08 scrypt KEK mở master key (memory).
3. Có provider + workspace hợp lệ → tier **live**: resolve launch config → sẵn sàng spawn `opencode`.

### F2 — Một lượt chat (streaming)
1. `ui-cowork` gửi prompt → E05 `POST /v1/session`.
2. `svc-session` đảm bảo child session (E10), inject key env-only.
3. Child gọi `llm` (E11); frame SSE trả về → EV mapper/reducer → stream hub → coalesce → E06 về renderer.
4. Kết thúc turn: `svc-conv` persist message hiển thị + **turn summary** (không lưu raw SSE/token delta).

### F3 — Permission + File Work Review
1. Child xin quyền ghi file (E12) → gate tạo pending.
2. Pending hiện ở: modal desktop (E13), PWA phone (E21–22, nếu bật), Discord (E23, chỉ deny).
3. Allow → mutation chạy; `svc-freview` chụp snapshot before/after + diff (E14) = **bằng chứng verified** (prose của model không bao giờ là bằng chứng).
4. Preset agent (`edit: "deny"`) enforce tại proxy — deny-by-policy ghi reason `agent_preset`, không phải quyết định user.

### F4 — Dispatch fan-out (D1, ADR 0011)
1. Chọn task ở `ui-dispatch` (hoặc `/dispatch run <id>`, hoặc 1-touch từ phone) → E05 `POST /v1/dispatch`.
2. Run registry tạo run; loop runner (`run_once`/`retry_until_verified`/`scheduled`) với guardrail maxTurns/maxDurationMs.
3. Mỗi branch = 1 child session thật (E19) + bind preset (E20) → MỘT permission gate chung.
4. `retry_until_verified` chỉ `verified` khi hook evidence xác nhận file thật; hết lượt = `exhausted`, không bao giờ `completed` giả.
5. Board poll 3s chỉ khi đang chạy.

### F5 — Remote pairing (flag)
1. Bật `CGHC_REMOTE_ENABLED` → listener riêng; `/remote` trong composer mở panel + QR (`/v1/remote`).
2. Phone nhập code 1 lần (TTL 2 phút) → device token (SHA-256 digest, in-memory per-launch).
3. PWA: list conversations → transcript → live EV stream → duyệt permission → gửi prompt (E22 allowlist).

### F6 — Chẩn đoán (Wave 6)
1. Log ghi qua sink xoay vòng, mọi record qua secret scrubber (E18).
2. Telemetry = counter allowlist trong SQLite; toggle gate collection.
3. Export: `/v1/diagnostics` trả bundle redacted → shell save-dialog (renderer không chọn đường ghi).

## 6. Đặc tả layout (đủ để sinh Excalidraw)

Canvas hướng ngang, gốc trên-trái. Cột rộng **240px**, khoảng cách cột **80px**, node cao
**56px** (frame cao theo nội dung), khoảng cách dọc giữa node **24px**.

| Cột | x trái | Node (thứ tự y từ trên xuống, y bắt đầu 80) |
|---|---|---|
| C0 | 40 | `user`, `phone`, `discord` |
| C1 | 360 | frame `renderer` chứa: `ui-shell`, `ui-cowork`, `ui-workspace`, `ui-skills-mcp`, `ui-dispatch`, `ui-settings`, `ui-permission`, `ui-svc-client`, (hàng phụ: `ui-microsoft`, `ui-code`, `ui-gateway`, `ui-knowledge`) |
| C2 | 680 | frame `shell` chứa: `sh-window`, `sh-preload`, `sh-ipc`, `sh-svc-ctl`, `sh-paths` |
| C3 | 1000 | frame `service` (rộng 2 node ≈ 520px) chứa: hàng 1 `svc-http`, `svc-compose`; hàng 2 `svc-session`, `svc-conv`; hàng 3 `svc-perm`, `svc-freview`; hàng 4 `svc-workspace`, `svc-skills`; hàng 5 `svc-mcp`, `svc-provider`; hàng 6 `svc-auth`, `svc-settings`; hàng 7 `svc-diag`, `svc-tasks`; hàng 8 `svc-dispatch`, `svc-remote`; hàng 9 `svc-ms365`, `svc-ssrf` |
| C4 | 1640 | trên: frame `data` chứa `db`, `vault`, `logs`, `ws-fs`, `skill-fs`; dưới: frame `runtime` chứa `opencode` |
| C5 | 1960 | `llm`, `mcp-srv`, `msgraph` |

- **Màu node** theo tầng (bảng §1); node FLAG-OFF/AWAITING: viền **đứt** + badge chữ nhỏ
  (`flag`, `slot`). Node `store` vẽ hình trụ hoặc chữ nhật bo góc đậm; `process` chữ nhật
  viền kép; `actor` hình người/chữ nhật bo tròn.
- **Mũi tên**: solid đen cho edge solid; đứt xám cho dashed; nhãn đặt giữa cạnh, chữ 12px.
- **Khung boundary** B1–B6 (§4): viền đậm 2px không tô nền, nhãn góc trên-trái; B3 bao trùm
  frame `service` + frame `data`; B6 bao `phone`+`discord`+`svc-remote` (vẽ nét đứt vì flag).
- **Chú giải (legend)** đặt góc dưới-trái: 6 màu tầng + 3 kiểu viền (solid/dashed/boundary)
  + 2 kiểu mũi tên.
- Số luồng F2/F3/F4 có thể vẽ thành **badge tròn đánh số** đặt trên các edge tương ứng
  (F2: E05→E10→E11→E06; F3: E12→E13→E14; F4: E19→E20).

## 7. Hướng dẫn sinh HTML

Trang HTML một file, tự chứa (không CDN), sáng/tối theo `prefers-color-scheme`:

1. **Hero**: tên hệ thống + chuỗi runtime chain (§ mở đầu) + ngày `updated_at`.
2. **Sơ đồ khối**: render §6 bằng CSS grid 6 cột hoặc SVG tĩnh; mỗi node là card có
   badge trạng thái (WORKS xanh, PARTIAL vàng, FLAG-OFF xám viền đứt, AWAITING xám nhạt).
3. **Bảng tương tác**: §2 và §3 render thành bảng có filter theo tầng; click node
  highlight các edge liên quan (id node/edge dùng đúng ID trong tài liệu này).
4. **Luồng**: §5 render thành 6 tab/accordion, mỗi flow là ordered list; nếu muốn vẽ
   sequence diagram thì participant = các node ID xuất hiện trong flow.
5. **Boundary**: §4 render thành card cảnh báo với bất biến an ninh.
6. **Cờ tính năng**: bảng dưới đây render kèm ghi chú "OFF mặc định".

| Flag | Tác dụng | Mặc định |
|---|---|---|
| `CGHC_REMOTE_ENABLED` | Bật remote gateway + PWA | OFF |
| `CGHC_REMOTE_LAN` / `CGHC_REMOTE_PORT` | Bind LAN (chưa TLS — dev/demo) / port cố định | OFF |
| `CGHC_DISCORD_ENABLED` | Discord notify + deny + prompt | OFF |
| `CGHC_MS365_ENABLED` | MS365 connector + advertise tool cho child | OFF |
| `COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP` | Nới SSRF cho **loopback http** (dev-only, ADR 0012, banner WARN) | OFF |
| `COWORK_GHC_E2E_MOCK_LLM_BASE_URL` | Mock LLM loopback cho verification | unset |

## 8. Nguồn đối chiếu

- Boundary & bất biến: `architecture/system-overview.md` (owner canonical).
- Trạng thái từng capability: `product/current-status.md`.
- Thiết kế đóng băng L4 + ADR supersede D1: `architecture/cowork-ghc-implementation-design.md`, `architecture/decisions/0011-dispatch-fanout-activation.md`.
- EV event format: `architecture/ev-stream-events.md`.
- Giới hạn đã biết (file delete không tin cậy, MCP toolCount 0, PDF/Office edge cases…): `quality/known-limitations.md`.
