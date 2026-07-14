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
cd app/llm-svc
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
- **Node.js ≥ 22** + npm 11.

### Lệnh phát triển

```bash
npm install                # cài dependency workspaces
npm run typecheck          # tsc -b (TypeScript strict)
npm test                   # node --test
npm run build:app          # build renderer + shell
npm run package:win        # đóng gói Electron (Windows) -> dist-app/
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

### Bảo mật Credential

- Key LLM lưu ở **Windows Credential Manager** (OS-backed).
- Key **không bao giờ** xuất hiện trong log, error, frontend state, hoặc screenshot.
- Không commit `.env`/secret (xem `.gitignore`).

### Agent Entry Points

Xem [docs/quality/known-limitations.md](docs/quality/known-limitations.md) và
[docs/product/current-status.md](docs/product/current-status.md).

## Cho agent (Claude / Codex)

- Điểm vào: [`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md).
- Tài liệu canonical: [`docs/README.md`](docs/README.md).
- Chế độ mặc định: **LEAN** (một agent, slice nhỏ, test tập trung).
