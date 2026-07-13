# M365 Knowledge Graph + Cowork GHC Monorepo

This monorepo contains two complementary projects:

## 📊 M365 Knowledge Graph (Backend: Go + Neo4j)

An intelligent enterprise knowledge graph system that ingests data from Microsoft 365 (OneDrive, Teams, SharePoint), extracts business entities and relationships via NLP, and answers natural language questions with permission-aware, cited responses.

### Quick Start

**Prerequisites:**
- Go 1.22+
- Rust 1.70+
- Docker & Docker Compose
- PostgreSQL 15+
- Neo4j 5+

**Local Development:**
```bash
# Start infrastructure
docker-compose up -d

# Build and run backend
cd app/backend
go build -o bin/m365-knowledge-graph ./cmd
./bin/m365-knowledge-graph

# Build and run LLM service (new terminal)
cd llm-svc
cargo build --release
./target/release/llm-svc

# Backend API at http://localhost:8080
# gRPC (llm-svc) at localhost:9090
```

**Documentation:**
- [Architecture](docs/ARCHITECTURE.md)
- [Getting Started](docs/GETTING_STARTED.md)
- [API Reference](specs/contracts/api.md)
- [Data Model](specs/data-model.md)

---

## 🖥️ Cowork GHC (Desktop: Electron + TypeScript)

**Cowork GHC** là một sản phẩm **AI cowork desktop cho Windows 11 (máy local)**. UI là client của một **local application service** chạy trên loopback; service điều phối một **OpenCode runtime** (tiến trình con) và gọi LLM qua một **endpoint có thể thay thế** (provider-neutral).

> **Trạng thái: POC đang phát triển — CHƯA phải bản release dùng được.**
> Packaged `.exe` build được và mở được GUI, nhưng **chưa có luồng người dùng hoàn chỉnh** trong bản đóng gói.

### Kiến trúc (ngắn)

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
│ Replaceable LLM endpoint     │  cloud API / OpenAI-compatible
└─────────────────────────────┘
```

### Yêu cầu (Prerequisites)

- **Windows 11** (target chính).
- **Node.js ≥ 22** + npm 11.

### Lệnh phát triển

```bash
npm install                # cài dependency workspaces
npm run typecheck          # tsc -b (TypeScript strict)
npm test                   # node --test
npm run build:app          # build renderer + shell
npm run package:win        # đóng gói Electron (Windows) -> dist-app/
npm run app -- status      # app CLI

# Workflow state (machine state, not source)
node tools/loop-engineer/cli.mjs status    # loop/task/gate + next
node tools/loop-engineer/cli.mjs verify    # validate schema + state
```

### Windows Scripts

- `init.bat` — chuẩn bị môi trường (idempotent).
- `start.bat` — khởi động Cowork GHC + local service.
- `stop.bat` — dừng process gọn gàng.
- `clean.bat` — xoá generated data theo allowlist.

### Bảo mật Credential

- Key LLM lưu ở **Windows Credential Manager** (OS-backed).
- Key **không bao giờ** xuất hiện trong log, error, frontend state, hoặc screenshot.
- Không commit `.env`/secret (xem `.gitignore`).

### Agent Entry Points

- Claude: [`CLAUDE.md`](CLAUDE.md)
- Codex: [`AGENTS.md`](AGENTS.md)
- Workflow source: `.agent-workflow/`
- Machine state: `.loop-engineer/state/`

---

## License

Extracted from MiniRag parent repository on 2026-07-11.
