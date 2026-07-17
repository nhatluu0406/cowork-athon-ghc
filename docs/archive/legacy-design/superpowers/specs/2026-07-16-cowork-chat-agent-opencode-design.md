---
language: "vi"
status: "active"
updated_at: "2026-07-16"
scope: "Cowork chat tab — AI Agent + OpenCode data flow"
audience: "team merge / integration"
---

# Design: Cowork Chat — AI Agent + OpenCode data flow

## Mục đích & phạm vi

Tài liệu này mô tả **cách một lượt chat (turn) trong tab Cowork được xử lý end-to-end** và
cách dữ liệu di chuyển qua AI Agent + OpenCode runtime, dành cho một team đang **merge/tích hợp**
vào subsystem này mà không phá vỡ các invariant hiện có.

**Trong phạm vi:** đường đi của một lượt chat Cowork (prompt → OpenCode session → SSE frames →
EV fold → renderer → SQLite persist), vòng đời child OpenCode, và các seam dữ liệu đi kèm.

**Ngoài phạm vi:** MS365, MCP tool catalog, các mount seam D1–D4, Workspace Companion, Settings,
Skills hub. Chỉ tập trung vào tab Cowork.

> Nguồn sự thật: Git HEAD + code hiện tại + `docs/product/current-status.md`. Tài liệu này mô tả
> những gì đang chạy thật, không phải kế hoạch.

---

## 1. Cấu trúc phân lớp (layer nào sở hữu gì)

Đường đi của chat là một chuỗi sở hữu tuyến tính. Mỗi layer chỉ nói chuyện với hàng xóm trực tiếp.

| Layer | Code | Sở hữu |
|---|---|---|
| **Renderer** | `app/ui` | UI chat Cowork; gửi prompt, render `SessionView` |
| **Preload** | `app/shell` | typed capability IPC (không truy cập DB/secret) |
| **Local service (loopback HTTP)** | `service/src` | toàn bộ orchestration bên dưới |
| ├─ Conversation | `service/src/conversation` | SQLite persist: message hiển thị cho user + durable turn summary |
| ├─ Composition | `service/src/composition/live-launch.ts` | lắp ráp một live run spawn-ready (workspace + provider + credential) |
| ├─ Runtime adapters | `service/src/runtime` | supervisor, OpenCode HTTP client, **send-prompt**, **event-pump**, permission bridge |
| ├─ Execution | `service/src/execution` | **two-hop SSE pipeline**: raw frame → EV → `SessionView` fold → coalesced stream |
| **OpenCode child** | binary pin `v1.18.1` | vòng lặp agent thật, gọi provider, gọi tool |
| **Provider** | qua child env | LLM (DeepSeek / custom OpenAI-compatible) |
| **Workspace** | filesystem | file agent đọc/ghi (trong ranh giới workspace) |

**Sự thật cấu trúc quan trọng nhất cho team merge:**
service **không bao giờ** stream token trả về trong HTTP response của prompt. POST prompt trả về
ngay lập tức; toàn bộ output đến out-of-band trên một stream `/event` SSE **riêng biệt**.
Đây là hai luồng độc lập.

```text
┌──────────────────────────────────────────────────────────────┐
│ Electron renderer (app/ui)  — Cowork chat tab                 │
└───────────────┬──────────────────────────────────────────────┘
                │ typed preload IPC (app/shell)
┌───────────────▼──────────────────────────────────────────────┐
│ Local service (loopback HTTP, service/src)                    │
│                                                               │
│  conversation ──► SQLite (messages + turn summaries)          │
│  composition/live-launch ──► build live run                   │
│  runtime ──► supervisor │ send-prompt │ event-pump │ perm     │
│  execution ──► EV mapper → SessionView fold → coalesce        │
└───────────────┬──────────────────────────────────────────────┘
                │ loopback 127.0.0.1:<ephemeral>
┌───────────────▼──────────────────────────────────────────────┐
│ Supervised OpenCode child (pinned v1.18.1)                    │
│   agent loop → provider (LLM) → tool calls → workspace fs     │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Launch: đưa child OpenCode lên

Trước khi có bất kỳ chat nào, `live-launch.ts` → `buildLiveCoworkOptions` lắp ráp một run và
**`OpencodeSupervisor`** (`service/src/runtime/supervisor.ts`) spawn child:

1. **Validate** workspace (đường dẫn tuyệt đối) + provider selection (SSRF-check mọi custom base URL).
2. **Resolve** credential handle của provider (`CredentialRef` — không bao giờ là giá trị) và inject
   key đã resolve **chỉ vào child spawn env** — không vào `opencode.json`, không vào `.runtime/`,
   không vào log.
3. **Spawn** binary pin, bind vào một **ephemeral loopback port**; chờ `/global/health` **thật** —
   phải vừa đúng version pin vừa healthy.
4. **Capture** OS process identity; persist PID/port/identity dưới `.runtime/`.

Sau khi ready, service expose `supervisor.baseUrl` (`http://127.0.0.1:<port>`) và khởi động
**event pump**.

**Bảo mật (FIX-6):** value-scrubber dùng chung được seed qua `deps.credentialService` (đọc ONE
store), nên redaction phủ được key thật *trước khi* socket mở. Key chảy duy nhất vào child env.

---

## 3. Một lượt chat, trace end-to-end

### Outbound — start run

1. Renderer gửi prompt text → preload IPC → conversation router **persist user message** vào SQLite.
2. `createOpencodeSendPrompt` (`service/src/runtime/send-prompt-adapter.ts`) POST
   `POST /session/{id}/message` với body `{ parts: [{type:"text", text}], model? }` —
   **secret-free**, chỉ có prompt text + một non-secret model ref.
3. Child **accept** message và POST **trả về ngay lập tức**. Run tiếp tục bên trong child
   (agent loop → gọi provider → gọi tool).

### Inbound — stream output (two-hop pipeline)

4. **Event pump** (`service/src/runtime/event-pump.ts`) giữ MỘT consumer `GET /event` SSE tới child,
   decode frames, và **demux theo `sessionID`**, feed từng frame vào live run của session đó qua
   hub `open(sessionId).ingest`.
5. **Hop 1** — `createEvMapper` map một raw OpenCode frame → EV event(s) (EV1–EV7: text, tool call,
   file mutation, todos, progress, error, completed).
6. **Hop 2** — `session-stream.ts` fold từng EV vào **`SessionView` authoritative** qua `apply`
   (single source of truth), rồi **coalesce** token spam trong khi flush ngay các event làm đổi
   trạng thái tới renderer sink.
7. Renderer re-render `SessionView` (text / steps / toolCalls / fileMutations / todos / status).

### Terminal + persist

8. Chỉ một frame **thật** `session.idle` (→ EV7 `completed`) hoặc `session.error` mới kết thúc run —
   service **không bao giờ fabricate** `completed`.
9. Khi hoàn tất, conversation layer persist **assistant message + durable turn summary** vào SQLite.
   Raw SSE/token delta **không bao giờ** được persist.

### Invariant cho team merge: apply-before-emit

Snapshot authoritative luôn ít nhất mới bằng bất cứ thứ gì renderer đã thấy, nên một reconnect/resync
chỉ có thể đẩy client **tiến lên**, không bao giờ lùi lại.

```text
Renderer        Service (send-prompt)        OpenCode child        event-pump / execution
   │                    │                          │                        │
   │  prompt text       │                          │                        │
   ├───────────────────►│  POST /session/{id}/message                       │
   │                    ├─────────────────────────►│                        │
   │                    │◄──── 200 (accepted) ──────┤  (POST trả về ngay)   │
   │◄── (turn started) ─┤                          │                        │
   │                    │                          │  run: LLM + tools      │
   │                    │                          │═══ GET /event (SSE) ═══►│  hop1: frame→EV
   │                    │                          │                        │  hop2: EV→SessionView
   │◄══ coalesced SessionView updates ═════════════════════════════════════┤  (apply-before-emit)
   │                    │                          │  session.idle          │
   │                    │                          │═══════════════════════►│  EV7 completed
   │                    │  persist assistant msg + turn summary → SQLite    │
   │◄── final view ─────┤                          │                        │
```

---

## 4. Resilience, permissions & data-at-rest

- **Resync:** một kết nối `/event` bị rớt sẽ reconnect với bounded backoff; `planResync` resume
  `seq` monotonic để không mất/không double-apply frame. Một mapper/seq owner cho mỗi session.
- **Permissions:** hook `onFrame` của pump feed **permission bridge**; file mutation cần permission
  phải cho ra một **verified tool result** (File Work Review) — prose của assistant không bao giờ là
  bằng chứng của mutation. Filesystem action nằm trong ranh giới workspace.
- **Dữ liệu ở đâu:**
  - SQLite (`<userData>/cowork-ghc.db`): messages + turn summaries.
  - Vault mã hoá: provider key (master key chỉ trong memory sau unlock).
  - `.runtime/`: PID/port/identity.
  - Workspace: file.
  - **Không plaintext secret** trong DB, JSON, renderer, log.

### Bảng seam cho team merge

| Seam | File | Hình dạng dữ liệu qua seam |
|---|---|---|
| Prompt dispatch | `runtime/send-prompt-adapter.ts` | `{ parts:[{type:"text",text}], model? }` (secret-free) |
| Event ingest | `runtime/event-pump.ts` | raw OpenCode frame (demux theo `sessionID`) |
| Frame → EV | `execution/ev-mapper.ts` | `EvEvent` (EV1–EV7) |
| EV → view | `execution/session-stream.ts` + `ev-reducer.ts` | `SessionView` |
| Credential | `composition/live-launch.ts` | `CredentialRef` (handle, không phải value) |
| Persist | `conversation/store.ts` | user/assistant message + turn summary |

---

## Tham chiếu code

- `runtime/src/` — OpenCode pin (`pin.ts`), launch-config, provider-env injection, process-identity.
- `service/src/runtime/` — `supervisor.ts`, `opencode-client.ts`, `send-prompt-adapter.ts`,
  `event-pump.ts`, `permission-bridge.ts`.
- `service/src/composition/live-launch.ts` — build một live run spawn-ready.
- `service/src/execution/` — `ev-mapper.ts`, `ev-reducer.ts`, `session-stream.ts`,
  `stream-coordinator.ts`, `session-resync.ts`.
- `service/src/conversation/` — persist message + turn summary.
- `docs/architecture/system-overview.md` — ranh giới kiến trúc tổng quát.
