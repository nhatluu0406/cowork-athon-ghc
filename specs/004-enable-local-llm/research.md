# Research: Enable Local LLM with Cloud Fallback (004)

**Phase**: 0 — Pre-implementation research
**Feature**: `004-enable-local-llm`
**Project**: RAD Knowledge Gateway (`github.com/rad-system/m365-knowledge-graph`)
**Date**: 2026-07-17

---

## 1. Codebase Inventory

### 1.1 LLM Architecture — Critical Finding

The Go backend does **NOT** call any LLM directly. All LLM operations route through `llm-svc` via gRPC:

```
Go backend (m365-knowledge-graph)
    └── internal/llmsvc/client.go   →  gRPC  →  llm-svc (separate process)
                                                     ├── local model (GGUF/llama.cpp)
                                                     └── cloud API (OpenAI/Anthropic)
```

The `llm-svc` already has a concept of `NLP_MODE` (referenced in `cmd/main.go`). The existing `ListModels` RPC (`llmsvc.Client.ListModels`) returns `ModelMetadata` with `IsLocal bool` — confirming the infrastructure for local model selection already exists in the protocol buffer definition.

**Implication**: "Enable Local LLM" means:
1. Adding a **settings API** in the Go backend to persist user's local LLM preference
2. Passing model selection hints to `llm-svc` via the existing gRPC `modelName` / `NLP_MODE` fields
3. Implementing **fallback logic** in the Go backend when `llm-svc` returns an error on a local-model request

### 1.2 Existing Config

`internal/common/config.go` has:
- `LLMModel` — cloud generative model (e.g., `gpt-4o-mini`)
- `LLMEmbedModel` — cloud embedding model
- `LLMSvcAddr` — gRPC address of `llm-svc`

No existing concept of local model path or local/cloud mode switch.

### 1.3 llm-svc gRPC protocol

From `internal/llmsvc/llmsvc.pb.go` (proto-generated), key RPCs:
- `ListModels(ListModelsRequest{ModelKind})` → returns `[]ModelMetadata` with `IsLocal bool`
- `Generate(GenerateRequest{ModelName, ...})` — `ModelName` can select specific model
- `Embed(EmbedRequest{ModelName, ...})` — same

**Key observation**: The `modelName` field in every RPC allows selecting a model by name. If the user selects a local model (e.g., `llama-3-8b-q4`), the Go backend just needs to pass that name to `llm-svc` RPCs and `llm-svc` routes accordingly.

### 1.4 Existing storage

No settings/configuration persistence table exists. `m365_connections` stores connector config but not LLM preferences. A new `llm_settings` table is needed, or a generic `app_settings` key-value table.

---

## 2. Technical Unknowns Resolved

### Q1: Where is "local model" mode configured — Go backend or llm-svc?

**Decision**: Dual-layer:
- `llm-svc` manages actual model loading and execution (already handles local models via `NLP_MODE`)
- Go backend stores the **user's preference** (enabled/disabled, selected model name) in PostgreSQL
- At request time, Go backend passes the selected `modelName` to gRPC RPCs; `llm-svc` uses it

This keeps the Go backend as a pure orchestration layer (Architecture Rule: "Do not rebuild existing runtime").

### Q2: Where is model list sourced from?

**Decision**: `llmsvc.Client.ListModels(ctx, "local")` — the existing gRPC RPC. The Go backend calls this to get available local models from `llm-svc`, which scans its `models/` folder. The Go backend does NOT scan the filesystem directly (Architecture Rule: "Business logic not in UI components" — by analogy, model scanning is not in the API gateway).

### Q3: How does fallback to cloud work?

**Decision**: In the Go backend's request handlers (`internal/retrieval/stages.go` — `AnswerGenerator` and `SemanticSearch`):

```
1. If local LLM enabled:
   a. Call llm-svc with selectedLocalModel name
   b. If error (timeout, model unavailable, resource exhaustion):
      - Log the error (redacted, no model path in log line)
      - Record fallback event in `llm_fallback_events` table
      - Retry same RPC with cloud model name
      - Include `used_fallback: true` in API response
2. If local LLM disabled: call llm-svc with cloud model name directly
```

Timeout for local model: configurable, default 30s (SC-002: fallback within 5s is the notification, not the full response).

### Q4: How does configuration persist across restarts (FR-008)?

**Decision**: New PostgreSQL table `llm_settings` (single row per key):
```sql
CREATE TABLE llm_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Keys: `local_llm_enabled` (`"true"`/`"false"`), `local_model_name` (model name string), `local_model_timeout_s` (integer string).

Single row avoids schema complexity. This matches the existing pattern in `delta_state`.

### Q5: Model compatibility validation (FR-009)?

**Decision**: Validation via `llm-svc`: after user selects a model, call `ListModels` and check the returned model's metadata (`Format`, `Kind`) to confirm it's recognized. If the model is NOT in the `ListModels` response, it's incompatible. The Go backend does not validate GGUF headers or format internals — that's llm-svc's domain.

### Q6: New API endpoints or extend existing?

**Decision**: New route group `/api/llm/` (separate from `/api/m365/`):
- `GET /api/llm/settings` — current config
- `PUT /api/llm/settings` — update config (enable/disable, select model)
- `GET /api/llm/models` — list available models from llm-svc (local + cloud)

Integrates naturally alongside existing `/api/m365/` handlers pattern.

### Q7: How does the UI know which model is active and whether fallback occurred?

**Decision**: Add `llm_info` field to existing API responses that involve generation:
- `GET /api/knowledge/query` response → add `"llm_info": {"mode": "local"|"cloud", "model": "...", "used_fallback": bool}`

For real-time fallback notification (SC-004: within 1s), use the existing WebSocket hub (`internal/websocket/hub.go`) to push a `llm_fallback` event when fallback occurs during a request.

### Q8: What is the `models folder` path?

**Decision**: The `models/` folder is owned by `llm-svc`, not the Go backend. The Go backend retrieves model list from `llm-svc` via gRPC. The settings API stores only the model *name* (not path), which `llm-svc` resolves internally.

A new config env var `LOCAL_MODELS_PATH` is added to `llm-svc` config (out of scope for this Go backend feature — documented in research but implementation is in `llm-svc`). The Go backend only adds `LOCAL_LLM_ENABLED` and `LOCAL_LLM_DEFAULT_MODEL` to `Config` for startup defaults (overridable via API).

### Q9: Concurrent request handling with local model (Edge Case)?

**Decision**: No concurrency control in Go backend — `llm-svc` manages its own request queue. If local model is single-threaded, `llm-svc` serializes requests. Timeout-based fallback handles the case where the queue is too long.

### Q10: Session mode switch (Edge Case: switching local↔cloud mid-conversation)?

**Decision**: Mode change takes effect on the NEXT request. In-flight requests complete with their original model. No session-level mode locking needed.

---

## 3. New Database Objects

### 3.1 `llm_settings` (key-value)

```sql
CREATE TABLE llm_settings (
    key        TEXT        PRIMARY KEY,
    value      TEXT        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed defaults
INSERT INTO llm_settings (key, value) VALUES
    ('local_llm_enabled', 'false'),
    ('local_model_name',  ''),
    ('local_model_timeout_s', '30')
ON CONFLICT (key) DO NOTHING;
```

### 3.2 `llm_fallback_events` (audit log)

Optional for MVP; enables analytics on fallback frequency.

```sql
CREATE TABLE llm_fallback_events (
    id          BIGSERIAL   PRIMARY KEY,
    reason      TEXT        NOT NULL,  -- 'timeout' | 'model_error' | 'resource_exhaustion'
    local_model TEXT        NOT NULL,  -- model name (not path)
    cloud_model TEXT        NOT NULL,
    latency_ms  INT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 4. Go Package Structure

```
internal/
  llmconfig/
    settings.go     -- LLMSettings entity, SettingsStore CRUD (llm_settings table)
    fallback.go     -- FallbackRouter: try local → on error → cloud; log to llm_fallback_events
    handler.go      -- HTTP handlers: GET/PUT /api/llm/settings, GET /api/llm/models
```

Thin package — no business logic beyond routing and persistence. Integration with existing retrieval pipeline via `FallbackRouter` wrapper around `SvcAdapter`.

---

## 5. Retrieval Pipeline Integration

`internal/retrieval/stages.go` — `AnswerGenerator.Generate` and `SemanticSearch.Search` currently receive an `LLMClient` / `EmbeddingRuntime`. These interfaces receive a `FallbackRouter` wrapper instead of raw `SvcAdapter`:

```go
type FallbackRouter struct {
    adapter      *embedding.SvcAdapter
    settings     *llmconfig.SettingsStore
    fallbackLog  *llmconfig.FallbackStore
    hub          *websocket.Hub  // for real-time fallback notification
}

// Embed: if local enabled → embed with local model → on error → embed with cloud model
func (r *FallbackRouter) Embed(ctx context.Context, texts []string) ([][]float32, error)

// Complete: if local enabled → generate with local model → on error → generate with cloud model
func (r *FallbackRouter) Complete(ctx context.Context, prompt string) (string, error)
```

The `FallbackRouter` satisfies both `retrieval.EmbeddingRuntime` and `retrieval.LLMClient` interfaces — no interface changes needed.

---

## 6. Constitution Compliance

| Principle | Compliance |
|-----------|-----------|
| I. Accuracy Over Speed | Fallback ensures responses always delivered; local model used only when validated |
| II. Semantic Knowledge > Raw Text | Feature is infrastructure; doesn't change retrieval pipeline semantics |
| III. Test-First Deterministic Verification | Unit tests for FallbackRouter with mock SvcAdapter; settings store tests with test DB |
| IV. Hybrid Retrieval Architecture | Local model is a runtime choice within the same hybrid pipeline |
| V. Source-of-Truth Hierarchy | `llm_settings` is single source of truth for LLM mode; no duplication in env + DB |

---

## 7. Open Questions (Deferred)

| # | Question | Decision |
|---|----------|----------|
| OQ-1 | UI settings panel implementation | Separate spec (frontend); this feature is backend API only |
| OQ-2 | Hardware requirement detection | Out of scope; llm-svc handles OOM errors which trigger fallback |
| OQ-3 | Model downloading UI | Out of scope per spec assumptions |
| OQ-4 | Per-user vs. global LLM settings | MVP: global (one setting for all users); per-user is future |
| OQ-5 | Embedding model also switchable to local? | Deferred; MVP covers generation only |
