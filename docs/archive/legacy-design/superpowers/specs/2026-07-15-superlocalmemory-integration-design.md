---
language: "vi"
status: "draft"
created_at: "2026-07-15"
topic: "superlocalmemory-integration"
track: "D3-memory"
source: "https://github.com/ddse/superlocalmemory"
---

# Design: SuperLocalMemory Integration (Memory Layer / D3-memory)

## Mục tiêu

Tích hợp **SuperLocalMemory (SLM) v3.6.x** vào Cowork GHC như một **memory layer cục bộ**,
cho phép agent nhớ ngữ cảnh xuyên conversation (cross-session persistent memory) mà không
cần cloud, không cần API key bổ sung, không rời khỏi thiết bị người dùng.

SLM cung cấp five-channel hybrid retrieval (Semantic · BM25 · Entity Graph · Temporal ·
Hopfield), toàn bộ local, CPU-only ở Mode A. Benchmark LoCoMo: 74.8% zero-LLM vs Mem0
64.2% — đây là lựa chọn phù hợp nhất cho desktop local-first.

Slice này **không phải** là D3 Knowledge Graph đầy đủ (vẫn `awaiting_integration`). Đây là
**D3-memory** — một subset tập trung vào persistent agent memory, độc lập hoàn toàn với phần
còn lại của D3 và dùng feature flag riêng.

## Ngoài phạm vi (out of scope)

- D3 Knowledge Graph / RAG vector search toàn diện — slice khác.
- SLM Mesh / multi-machine coordination — chưa cần.
- SLM Mode B (Ollama) và Mode C (cloud LLM) — bắt đầu bằng Mode A (zero-LLM).
- SLM Proxy surface (`slm wrap`) — không phù hợp với kiến trúc Electron; không intercept.
- SLM Dashboard web UI — không expose trong packaged app ở slice này.
- Thay đổi surface `knowledge` trong UI shell — surface vẫn `awaiting_integration`.
- SLM Compress / cache proxy — tách thành slice riêng nếu cần.

## Lý do chọn SLM

| Tiêu chí | Đánh giá |
|---|---|
| Local-first, zero-cloud | Mode A: không gọi API bên ngoài, không LLM riêng. Phù hợp desktop Windows. |
| Không Docker, không graph DB | Cài bằng `npm` hoặc `pip`, lưu SQLite. Zero infra overhead. |
| MCP native | SLM expose MCP server qua stdio hoặc HTTP — khớp với cách OpenCode nhận tool. |
| AGPL-3.0 | Cần đánh giá license nếu Cowork GHC closed-source. Xem mục License bên dưới. |
| EU AI Act Mode A | Không có personal data rời thiết bị. Phù hợp hướng privacy-first. |
| Benchmark đã publish | arXiv:2603.14588 — có thể trích dẫn trong product messaging. |

## Kiến trúc & boundary

```text
┌─ OpenCode child (tool-calling runtime) ──────────────────────────┐
│  model quyết định tool call → gọi slm_remember / slm_recall ...  │
└──────────────────────────┬───────────────────────────────────────┘
                           │ MCP stdio (SLM_MCP_PROFILE=core14)
┌──────────────────────────▼───────────────────────────────────────┐
│  slm mcp  (child process, owned by local service supervisor)     │
│                                                                   │
│  14 core MCP tools:                                               │
│    slm_remember · slm_recall · slm_forget · slm_session_init     │
│    + mesh tools (unused ở slice này)                              │
│                                                                   │
│  SLM_DATA_DIR → %APPDATA%\CoworkGHC\slm-data\ (isolated)        │
│  SQLite-only, Mode A (zero-LLM, zero-cloud)                       │
└───────────────────────────────────────────────────────────────────┘
         ↑ spawn / supervise / stdio pipe
┌──────────────────────────────────────────────────────────────────┐
│  Local application service                                        │
│                                                                   │
│  SLMProcessSupervisor          SLMHealthMonitor                   │
│  ├─ spawn(slm, ["mcp"])        ├─ check slm process alive        │
│  ├─ track PID → .runtime/      └─ surface status to renderer      │
│  ├─ pipe stdio → OpenCode MCP config                              │
│  └─ teardown on app shutdown                                      │
│                                                                   │
│  SlmLifecycleBridge            (port)                             │
│  └─ adapter: SlmNpmAdapter     (npm global install path)         │
└───────────────────────────────────────────────────────────────────┘
```

### Quyết định tích hợp: MCP stdio, không phải HTTP

SLM hỗ trợ hai MCP transport: **stdio** (universal fallback) và **HTTP**
(`http://127.0.0.1:8765/mcp/`). Slice này dùng **stdio** vì:

1. Không cần port riêng hay port conflict management.
2. OpenCode đã nhận MCP server qua stdio config khi spawn.
3. SLM HTTP server cần `slm init` + daemon riêng — complexity không cần thiết ở slice này.
4. PID ownership rõ ràng: service spawn, service own, service teardown.

Nếu HTTP cần sau (dashboard, multi-process), chuyển sang HTTP transport không ảnh hưởng MCP tool contract.

### OpenCode MCP registration

Service truyền cấu hình MCP vào OpenCode child qua biến môi trường khi spawn
(tương tự cách `CGHC_MS365_TOOL_ENDPOINT` được truyền cho D2):

```
CGHC_SLM_MCP_ENABLED=true
CGHC_SLM_MCP_COMMAND=slm
CGHC_SLM_MCP_ARGS=mcp
CGHC_SLM_MCP_ENV_SLM_DATA_DIR=%APPDATA%\CoworkGHC\slm-data
CGHC_SLM_MCP_ENV_SLM_MCP_PROFILE=core14
CGHC_SLM_MCP_ENV_SLM_MODE=a
```

OpenCode đọc các biến này và tự đăng ký MCP server trước khi nhận prompt đầu tiên.
Nếu OpenCode không hỗ trợ env-driven MCP registration, service spawn `slm mcp` trước và
forward stdio pipe trực tiếp vào OpenCode MCP config JSON.

**Honest constraint:** Cơ chế OpenCode tiêu thụ MCP env config **chưa được verify end-to-end**
(giống D2 tool advertising). Cần packaged run thật để xác nhận trước khi merge.

## Feature flag

```
CGHC_SLM_ENABLED=false   (default)
```

Khi flag **OFF**: không spawn SLM process, không truyền MCP env, không thay đổi OpenCode
session, baseline byte-for-byte unchanged.

Khi flag **ON**: SLM child process được spawn, `slm_remember` / `slm_recall` / `slm_forget`
xuất hiện trong tool set của model.

## Cài đặt & phụ thuộc

SLM cần được cài trước khi service spawn. Hai lựa chọn:

### Lựa chọn A: npm global (đơn giản nhất cho desktop Windows)

```powershell
npm install -g superlocalmemory
slm setup   # chọn Mode A khi được hỏi
slm doctor  # verify
```

`SlmNpmAdapter` resolve đường dẫn `slm.cmd` qua `where slm` hoặc hardcode npm global bin
path. Nếu không tìm thấy, service log warning và skip SLM spawn (không crash).

### Lựa chọn B: pip (Python 3.11+)

```powershell
pip install superlocalmemory --break-system-packages
slm setup
slm doctor
```

### Bundled (tương lai)

Đóng gói `slm` CLI cùng installer Cowork GHC để zero-friction onboarding. Không thuộc slice này.

### Download size

| Component | Size |
|---|---|
| Core libs (numpy, scipy, networkx) | ~50 MB |
| Dashboard + MCP server | ~20 MB |
| Learning engine (lightgbm) | ~10 MB |
| Sentence-transformers + torch | ~200 MB |
| Embedding model (first use) | ~500 MB |

**Tổng: ~780 MB** khi full warmup. Cần thông báo rõ cho user trước khi enable.

## Data isolation

```
SLM_DATA_DIR = %APPDATA%\CoworkGHC\slm-data\
```

- Tách biệt khỏi workspace của user — memory không lẫn vào file project.
- Không đặt trong workspace được pick bởi user.
- Không scan/expose qua workspace navigator hiện có.
- Xóa sạch khi user chọn "Xóa dữ liệu ứng dụng" (thêm vào cleanup manifest).

## Dữ liệu lưu trong SLM

SLM lưu những gì model chủ động gọi `slm_remember(...)`. Không có auto-capture ở slice này
(SLM hooks `slm hooks install` **không** được enable — tránh side effect ngoài kiểm soát).

Nội dung có thể lưu:
- Tên workspace, project context do user nói.
- Preference của user về workflow, ngôn ngữ.
- Kết quả research / fact model muốn nhớ.

**Không lưu:** credential, API key, nội dung file workspace (chỉ model quyết định gọi `slm_remember`).

## Permission model

SLM tool calls được xử lý bởi OpenCode runtime như mọi MCP tool call khác:

- `slm_recall` và `slm_forget` — không có side effect ngoài SLM store → không cần user approval.
- `slm_remember` — ghi vào local store → có thể hiển thị trong permission UI như một "memory write"
  (tương tự `file_create` nhưng ít nhạy cảm hơn). Slice này chưa implement separate approval —
  dùng OpenCode's built-in tool approval nếu có.

## Yêu cầu kỹ thuật

### Service

| ID | Yêu cầu |
|---|---|
| SLM-S-01 | `SLMProcessSupervisor` spawn `slm mcp` với `SLM_DATA_DIR`, `SLM_MCP_PROFILE=core14`, `SLM_MODE=a`. |
| SLM-S-02 | Track PID dưới `.runtime/slm.pid`. Teardown khi app shutdown. |
| SLM-S-03 | Health check: process alive? Expose trạng thái qua `GET /v1/slm/status`. |
| SLM-S-04 | Nếu `slm` binary không tìm thấy: log warning, không crash service, không thay đổi OpenCode session. |
| SLM-S-05 | Khi flag OFF: không spawn, không side effect. |

### OpenCode integration

| ID | Yêu cầu |
|---|---|
| SLM-OC-01 | Truyền MCP config vào OpenCode child qua env hoặc config JSON khi spawn (chỉ khi flag ON). |
| SLM-OC-02 | Verify `slm_remember`, `slm_recall`, `slm_forget` xuất hiện trong tool list của model trước khi claim PASS. |
| SLM-OC-03 | SLM MCP failure không block OpenCode startup. Fail-open: session tiếp tục không có memory tools. |

### Data

| ID | Yêu cầu |
|---|---|
| SLM-D-01 | `SLM_DATA_DIR` luôn trong `%APPDATA%\CoworkGHC\slm-data`. Không thể override qua user input. |
| SLM-D-02 | Path `slm-data` được thêm vào cleanup manifest với label `slm-memory-store`. |
| SLM-D-03 | Auto-capture hooks (`slm hooks install`) không được gọi. |

### UI (minimal — slice này)

| ID | Yêu cầu |
|---|---|
| SLM-UI-01 | Settings → Chung hiển thị trạng thái SLM: `Đang chạy` / `Không khả dụng` / `Chưa cài đặt`. |
| SLM-UI-02 | Không thay đổi surface `knowledge` — vẫn `awaiting_integration`. |

## License consideration

SLM dùng **AGPL-3.0**. Nếu Cowork GHC là closed-source:

- AGPL-3.0 yêu cầu source code của bất kỳ phần nào modified phải được publish.
- Nếu SLM được dùng như **external process** (spawn + stdio/HTTP) mà không modify SLM source,
  đây là "use over a network/process boundary" — thường được đánh giá là không trigger AGPL.
- **Khuyến nghị:** Tham khảo COMMERCIAL-LICENSE.md của SLM hoặc liên hệ
  varun.pratap.bhardwaj@gmail.com trước khi ship vào sản phẩm closed-source.
- Ghi chú này phải được review bởi người có thẩm quyền trước khi merge vào nhánh release.

## Acceptance criteria

```text
[A] slm binary tồn tại trên PATH → service spawn → PID track trong .runtime/slm.pid
[B] model nhận được slm_remember / slm_recall / slm_forget trong tool set
[C] slm_remember "Test memory" → slm_recall "test" → trả về "Test memory"
[D] app shutdown → slm process dừng sạch, không orphan
[E] flag OFF → không có SLM process, không có env var, OpenCode session không thay đổi
[F] slm binary không có → service log warning, app khởi động bình thường, không crash
```

## Các slice kế tiếp (không thuộc spec này)

- **SLM-auto-hooks**: Enable `slm hooks install` với phạm vi rõ ràng — chỉ sau khi slice này stable.
- **SLM-UI-surface**: Render memory entries trong UI (Knowledge surface hoặc sidebar Cowork).
- **SLM-compress**: Tích hợp `slm_compress` MCP tool để shrink file outputs và SKILL context.
- **SLM-bundled**: Bundle `slm` CLI cùng installer để zero-friction onboarding.
- **SLM-mode-B**: Cho phép user chọn Mode B (Ollama) khi đã có Ollama trên máy.

## Phụ lục: SLM tool set (core14 profile)

| Tool | Mô tả |
|---|---|
| `slm_remember` | Lưu một fact/memory mới |
| `slm_recall` | Truy vấn memory theo ngữ nghĩa |
| `slm_forget` | Xóa memory theo ID hoặc query |
| `slm_session_init` | Khởi tạo session memory context |
| `mesh_peers` … `mesh_lock` | Mesh tools — không dùng ở slice này |

Full reference: [docs/mcp-tools.md](https://github.com/ddse/superlocalmemory/blob/main/docs/mcp-tools.md)
