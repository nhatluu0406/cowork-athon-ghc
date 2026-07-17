# Implementation Plan: Enable Local LLM with Cloud Fallback

**Branch**: `004-enable-local-llm` | **Date**: 2026-07-17 | **Spec**: [specs/004-enable-local-llm/spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-enable-local-llm/spec.md`

---

## Summary

Thêm khả năng dùng local LLM thay vì cloud API trong RAD Knowledge Gateway. Go backend đã route toàn bộ LLM calls qua `llm-svc` (gRPC) — `llm-svc` đã có khả năng chạy model local. Feature này thêm:
1. **Settings API** (`/api/llm/settings`) để bật/tắt local LLM và chọn model
2. **FallbackRouter** — wrapper quanh `SvcAdapter` tự động fallback sang cloud khi local fails/timeout
3. **WebSocket notification** khi fallback xảy ra (SC-004: trong 1 giây)
4. **Persistence** qua PostgreSQL `llm_settings` table

Không thêm inference engine mới; không scan filesystem trực tiếp — đó là trách nhiệm của `llm-svc`.

---

## Technical Context

**Language/Version**: Go 1.22

**Primary Dependencies**: Tất cả đã có trong `go.mod`:
- `github.com/neo4j/neo4j-go-driver/v5` (không liên quan)
- `github.com/lib/pq` — PostgreSQL
- `google.golang.org/grpc` — gRPC client cho llm-svc
- Existing `internal/llmsvc`, `internal/embedding`, `internal/websocket`

Không thêm dependency mới.

**Storage**: PostgreSQL — 2 bảng mới: `llm_settings` (key-value) + `llm_fallback_events` (audit log)

**Testing**: `go test ./internal/llmconfig/...`; mock `SvcAdapter` cho unit tests; test DB cho `SettingsStore`

**Target Platform**: Linux (same as backend)

**Project Type**: Backend service extension — Settings API + transparent middleware (FallbackRouter)

**Performance Goals**:
- SC-001: Xử lý prompt cục bộ trong 10 giây kể từ khi model loaded (do llm-svc handle)
- SC-002: Fallback sang cloud trong 5 giây khi local fails (controlled by `local_model_timeout_s`)
- SC-004: Fallback notification qua WebSocket trong 1 giây

**Constraints**:
- `FallbackRouter` không được block API thread — timeout via `context.WithTimeout`
- Settings đọc từ DB per-request hoặc cached với TTL ≤ 5s; không dùng global mutable state
- Model name không phải model path — không có filesystem access trong Go backend

**Scale/Scope**: Global setting (không phải per-user); MVP cho 1 local model tại một thời điểm

---

## Constitution Check

| Nguyên tắc | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| I. Accuracy Over Speed | ✅ PASS | Fallback đảm bảo response luôn được trả về; local dùng khi validated |
| II. Semantic Knowledge > Raw Text | ✅ PASS | Infrastructure feature; không thay đổi retrieval pipeline semantics |
| III. Test-First Deterministic Verification | ✅ PASS | Unit tests cho FallbackRouter với mock adapter; settings store tests |
| IV. Hybrid Retrieval Architecture | ✅ PASS | Local model là runtime choice trong cùng pipeline |
| V. Source-of-Truth Hierarchy & Traceability | ✅ PASS | `llm_settings` là single source of truth; `llm_fallback_events` là audit trail |

---

## Project Structure

### Documentation (feature này)

```text
specs/004-enable-local-llm/
├── plan.md              ← file này
├── spec.md              ← đã có
├── research.md          ← Phase 0 output (đã tạo)
├── data-model.md        ← Phase 1 output (đã tạo)
├── quickstart.md        ← Phase 1 output (đã tạo)
├── contracts/
│   └── api.md           ← Phase 1 output (đã tạo)
├── checklists/
│   └── requirements.md  ← đã có
└── tasks.md             ← Phase 2 output (chưa tạo)
```

### Source Code

```text
app/backend/
├── migrations/
│   └── 004_local_llm.sql              -- NEW: llm_settings + llm_fallback_events
│
├── internal/
│   ├── llmconfig/                     -- NEW PACKAGE
│   │   ├── settings.go                -- LLMSettings, SettingsStore CRUD
│   │   ├── fallback.go                -- FallbackEvent, FallbackStore, FallbackRouter
│   │   └── handler.go                 -- HTTP handlers: GET/PUT /api/llm/settings, GET /api/llm/models
│   │
│   ├── api/
│   │   └── handlers_knowledge.go      -- UPDATE: add llm_info to query response
│   │
│   └── retrieval/
│       └── stages.go                  -- NO CHANGE: FallbackRouter satisfies existing interfaces
│
└── cmd/
    └── main.go                        -- UPDATE: wire FallbackRouter; register /api/llm/ routes

tests/
├── unit/
│   └── llmconfig/
│       ├── settings_test.go           -- SettingsStore unit tests
│       └── fallback_test.go           -- FallbackRouter with mock SvcAdapter
└── integration/
    └── llmconfig/
        └── settings_api_test.go       -- API integration tests
```

**Structure Decision**: Single Go backend project. New package `internal/llmconfig/` with 3 files (<250 lines each). `FallbackRouter` transparently replaces `SvcAdapter` at the `retrieval.EmbeddingRuntime` / `retrieval.LLMClient` injection points in `cmd/main.go` — no interface changes.

---

## Phase 0: Research ✅ DONE

Xem **[research.md](./research.md)**:
- Go backend không cần inference engine — `llm-svc` đã handle
- `llm-svc.ListModels` RPC trả về `IsLocal bool` — đủ để liệt kê local models
- Fallback via `context.WithTimeout` + retry với cloud model name
- Settings persist trong `llm_settings` key-value table

---

## Phase 1: Design & Contracts ✅ DONE

Xem:
- **[data-model.md](./data-model.md)** — `llm_settings`, `llm_fallback_events`, Go types
- **[contracts/api.md](./contracts/api.md)** — `/api/llm/settings`, `/api/llm/models`, WebSocket event
- **[quickstart.md](./quickstart.md)** — thứ tự implementation, test strategy

---

## Phase 2: Implementation (READY TO START)

**Phase A** — Migrations + SettingsStore + FallbackStore (nền tảng)

**Phase B** — FallbackRouter (core logic, unit tested với mock)

**Phase C** — HTTP handlers + wiring vào main.go + extend knowledge query response

**Phase D** — Integration tests + WebSocket notification

---

## Complexity Tracking

Không có violation. Ghi nhận trade-off:

| Trade-off | Lý do | Phương án đơn giản hơn đã loại vì |
|-----------|-------|----------------------------------|
| Thêm `FallbackRouter` wrapper | Encapsulate fallback logic, tránh scatter if/else trong mọi handler | Inline if/else trong mỗi handler = duplicated code + hard to test |
| `llm_settings` key-value table | Flexible cho tương lai (thêm key mới không cần migration) | Typed settings table = schema migration cho mỗi key mới |
