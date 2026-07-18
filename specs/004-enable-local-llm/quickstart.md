# Quickstart: Enable Local LLM — Hướng dẫn dành cho implementer

**Feature**: `004-enable-local-llm`
**Module path**: `github.com/rad-system/m365-knowledge-graph`
**Branch**: `004-enable-local-llm`

---

## 1. Tổng quan kiến trúc

```
GET/PUT /api/llm/settings  ──►  SettingsStore (PostgreSQL llm_settings)
GET /api/llm/models        ──►  llmsvc.Client.ListModels (gRPC → llm-svc)

POST /api/knowledge/query
  └─► AnswerGenerator.Generate
          └─► FallbackRouter.Complete
                  ├─► [local enabled] SvcAdapter.GenerateWithQuery(localModel)
                  │       ├─► success → return result, llm_info{mode:local}
                  │       └─► error/timeout → FallbackStore.Record
                  │                        → hub.Broadcast(llm_fallback)
                  │                        → SvcAdapter.GenerateWithQuery(cloudModel)
                  └─► [local disabled] SvcAdapter.GenerateWithQuery(cloudModel)
```

---

## 2. Setup môi trường

### 2.1 Yêu cầu

- Go 1.22+ (không thêm dep mới)
- PostgreSQL 15+ (existing instance)
- `llm-svc` đang chạy với ít nhất một local model được cấu hình trong `models/` folder của nó

### 2.2 Chạy migrations

```bash
cd app/backend
psql $DATABASE_URL -f migrations/004_local_llm.sql
```

File: `app/backend/migrations/004_local_llm.sql` — tạo `llm_settings` + seed defaults + `llm_fallback_events`.

### 2.3 Không cần biến môi trường mới

Feature dùng `LLMSVC_ADDR` hiện có. Startup defaults (`local_llm_enabled=false`) được đọc từ DB sau migration. Config API cho phép thay đổi runtime mà không cần restart.

---

## 3. Thứ tự implementation

### Phase A — Nền tảng

**A1**: `app/backend/migrations/004_local_llm.sql` — 2 tables + seed

**A2**: `internal/llmconfig/settings.go` — `LLMSettings`, `SettingsStore` CRUD:
```go
func (s *SettingsStore) Load(ctx) (LLMSettings, error)
func (s *SettingsStore) Save(ctx, cfg LLMSettings) error
```

**A3**: `internal/llmconfig/fallback.go` — `FallbackEvent`, `FallbackStore`:
```go
func (s *FallbackStore) Record(ctx, evt FallbackEvent) error
func (s *FallbackStore) ListRecent(ctx, limit int) ([]FallbackEvent, error)
```

### Phase B — FallbackRouter

**B1**: `internal/llmconfig/fallback.go` — `FallbackRouter` struct + `Embed` + `Complete`:
- Load settings từ `SettingsStore` per request (cached với 5s TTL)
- Nếu local enabled: call `adapter` với `localModelName` → timeout via `context.WithTimeout(ctx, settings.TimeoutSeconds)`
- On error: classify reason → `FallbackStore.Record` → `hub.Broadcast` → retry với cloud model
- Verify `FallbackRouter` satisfies `retrieval.EmbeddingRuntime` + `retrieval.LLMClient` interfaces

**B2**: Unit tests `app/backend/tests/unit/llmconfig/fallback_test.go`:
- Mock `SvcAdapter` (table-driven): local success, local timeout, local model_error, local disabled
- Verify cloud fallback called on error; verify FallbackStore receives correct reason

### Phase C — HTTP Handlers và Wiring

**C1**: `internal/llmconfig/handler.go` — `GET /api/llm/settings`, `PUT /api/llm/settings`, `GET /api/llm/models`

**C2**: Wire vào `cmd/main.go`: instantiate `SettingsStore`, `FallbackStore`, `FallbackRouter`; replace `embedRuntime`/`llmClient` with `FallbackRouter`; register `/api/llm/` routes

**C3**: Extend `internal/api/handlers_knowledge.go` (`GET /api/knowledge/query`): attach `llm_info` to response from `FallbackRouter.LastCallInfo()`

**C4**: Wire WebSocket broadcast: `FallbackRouter` holds reference to `websocket.Hub`; `hub.Broadcast(json.Marshal(FallbackEvent))` on fallback

---

## 4. Testing

### Unit tests (bắt buộc)

```
tests/unit/llmconfig/settings_test.go    -- Load/Save/UpdateKey với test DB
tests/unit/llmconfig/fallback_test.go    -- FallbackRouter với mock SvcAdapter
```

Coverage target: >80% cho `fallback.go`; >90% cho `settings.go`.

### Integration test

```
tests/integration/llmconfig/settings_api_test.go
```

Test: `GET /api/llm/settings` → default values; `PUT /api/llm/settings` với valid model → 200; `PUT` với invalid model → 400; `GET /api/llm/models` → proxies llm-svc response.

---

## 5. Quy tắc bắt buộc

1. **Model name không phải path** — `SettingsStore` lưu `local_model_name` là tên (e.g., `"llama-3-8b-q4"`), KHÔNG phải đường dẫn file (`/models/llama-3-8b-q4.gguf`)
2. **Secrets không được log** — `local_model_name` là metadata, không nhạy cảm; nhưng không log cloud API keys
3. **Fallback notification** — luôn push WebSocket `llm_fallback` event khi fallback xảy ra; không silent
4. **Settings cache** — đọc từ DB per-request hoặc với TTL 5s; không dùng package-level mutable global

---

## 6. Không làm (scope boundary)

- ❌ Scanning `models/` folder trực tiếp từ Go backend — đó là trách nhiệm của `llm-svc`
- ❌ Loading GGUF/ONNX model files — `llm-svc` handles this
- ❌ Per-user LLM settings — MVP: global setting
- ❌ Embedding model switch to local — deferred (OQ-5)
- ❌ Frontend settings UI — separate spec
- ❌ Model downloading — out of scope per spec
