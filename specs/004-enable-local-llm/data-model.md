# Data Model: Enable Local LLM with Cloud Fallback (004)

**Feature**: `004-enable-local-llm`
**Date**: 2026-07-17

---

## 1. PostgreSQL Schema

### 1.1 `llm_settings`

Lưu trữ cấu hình LLM của người dùng dưới dạng key-value. Single source of truth cho chế độ local/cloud.

```sql
CREATE TABLE llm_settings (
    key        TEXT        PRIMARY KEY,
    value      TEXT        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed defaults khi migration chạy lần đầu
INSERT INTO llm_settings (key, value) VALUES
    ('local_llm_enabled',    'false'),
    ('local_model_name',     ''),
    ('local_model_timeout_s','30')
ON CONFLICT (key) DO NOTHING;
```

**Keys được định nghĩa**:

| Key | Type | Values | Default | Mô tả |
|-----|------|--------|---------|-------|
| `local_llm_enabled` | bool string | `"true"` / `"false"` | `"false"` | Bật/tắt local LLM |
| `local_model_name` | string | tên model từ ListModels | `""` | Model local đang chọn |
| `local_model_timeout_s` | int string | `"1"`–`"300"` | `"30"` | Timeout (giây) trước khi fallback |

### 1.2 `llm_fallback_events`

Audit log các lần fallback từ local → cloud. Dùng cho monitoring và troubleshooting.

```sql
CREATE TABLE llm_fallback_events (
    id          BIGSERIAL   PRIMARY KEY,
    reason      TEXT        NOT NULL
                CHECK (reason IN ('timeout','model_error','resource_exhaustion','model_unavailable')),
    local_model TEXT        NOT NULL,   -- tên model (không phải path)
    cloud_model TEXT        NOT NULL,
    operation   TEXT        NOT NULL,   -- 'generate' | 'embed' | 'rerank'
    latency_ms  INT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX llm_fallback_events_created_at ON llm_fallback_events(created_at DESC);
```

---

## 2. Go Type Definitions

### 2.1 `internal/llmconfig/settings.go`

```go
package llmconfig

import (
    "context"
    "database/sql"
    "strconv"
    "time"
)

// LLMSettings holds the current LLM configuration.
type LLMSettings struct {
    LocalEnabled   bool   `json:"local_llm_enabled"`
    LocalModelName string `json:"local_model_name"`   // "" = none selected
    TimeoutSeconds int    `json:"local_model_timeout_s"`
}

// SettingsStore persists LLMSettings to PostgreSQL llm_settings table.
type SettingsStore struct {
    db *sql.DB
}

func NewSettingsStore(db *sql.DB) *SettingsStore

// Load reads all keys and returns a populated LLMSettings.
func (s *SettingsStore) Load(ctx context.Context) (LLMSettings, error)

// Save writes all keys from cfg to the table (upsert each key).
func (s *SettingsStore) Save(ctx context.Context, cfg LLMSettings) error

// UpdateKey updates a single key atomically.
func (s *SettingsStore) UpdateKey(ctx context.Context, key, value string) error
```

### 2.2 `internal/llmconfig/fallback.go`

```go
// FallbackEvent is recorded when fallback from local → cloud occurs.
type FallbackEvent struct {
    Reason     string    // 'timeout' | 'model_error' | 'resource_exhaustion' | 'model_unavailable'
    LocalModel string
    CloudModel string
    Operation  string    // 'generate' | 'embed' | 'rerank'
    LatencyMs  int
    CreatedAt  time.Time
}

// FallbackStore persists FallbackEvents.
type FallbackStore struct {
    db *sql.DB
}

func NewFallbackStore(db *sql.DB) *FallbackStore
func (s *FallbackStore) Record(ctx context.Context, evt FallbackEvent) error
func (s *FallbackStore) ListRecent(ctx context.Context, limit int) ([]FallbackEvent, error)
```

### 2.3 `internal/llmconfig/fallback.go` — FallbackRouter

```go
// FallbackRouter wraps SvcAdapter and implements both EmbeddingRuntime and
// LLMClient. When local LLM is enabled, it routes to the local model first,
// falling back to the cloud model on error.
type FallbackRouter struct {
    adapter      *embedding.SvcAdapter
    settings     *SettingsStore
    fallbackStore *FallbackStore
    hub          *websocket.Hub   // for real-time fallback notification
    cloudModel   string           // cloud model name (from Config.LLMModel)
    cloudEmbed   string           // cloud embed model (from Config.LLMEmbedModel)
}

func NewFallbackRouter(
    adapter *embedding.SvcAdapter,
    settings *SettingsStore,
    fallbackStore *FallbackStore,
    hub *websocket.Hub,
    cloudModel, cloudEmbed string,
) *FallbackRouter

// Embed implements retrieval.EmbeddingRuntime.
// Uses local embed model if enabled, falls back to cloud.
func (r *FallbackRouter) Embed(ctx context.Context, texts []string) ([][]float32, error)

// Complete implements retrieval.LLMClient.
// Uses local generative model if enabled, falls back to cloud.
func (r *FallbackRouter) Complete(ctx context.Context, prompt string) (string, error)
```

### 2.4 `internal/llmconfig/handler.go`

```go
// LLMHandlerDeps bundles dependencies for /api/llm/* handlers.
type LLMHandlerDeps struct {
    Settings      *SettingsStore
    FallbackStore *FallbackStore
    LLMClient     *llmsvc.Client   // for ListModels RPC
}

// UpdateSettingsRequest is the PUT /api/llm/settings body.
type UpdateSettingsRequest struct {
    LocalEnabled    *bool   `json:"local_llm_enabled,omitempty"`
    LocalModelName  *string `json:"local_model_name,omitempty"`
    TimeoutSeconds  *int    `json:"local_model_timeout_s,omitempty"`
}

// ModelInfo is one entry in GET /api/llm/models response.
type ModelInfo struct {
    Name      string `json:"name"`
    Kind      string `json:"kind"`      // "local" | "cloud"
    Format    string `json:"format"`    // "GGUF" | "ONNX" | "API"
    IsLocal   bool   `json:"is_local"`
    IsDefault bool   `json:"is_default"`
    SizeBytes int64  `json:"size_bytes,omitempty"`
}
```

---

## 3. API Response Changes

### 3.1 `/api/knowledge/query` response extension

Existing response gains an optional `llm_info` field:

```json
{
  "results": [...],
  "llm_info": {
    "mode": "local",
    "model": "llama-3-8b-q4",
    "used_fallback": false
  }
}
```

When fallback occurs:
```json
{
  "results": [...],
  "llm_info": {
    "mode": "cloud",
    "model": "gpt-4o-mini",
    "used_fallback": true,
    "fallback_reason": "timeout"
  }
}
```

### 3.2 WebSocket fallback event

Pushed to connected clients via `internal/websocket/hub.Hub.Broadcast`:

```json
{
  "type": "llm_fallback",
  "payload": {
    "local_model": "llama-3-8b-q4",
    "cloud_model": "gpt-4o-mini",
    "reason": "timeout",
    "latency_ms": 30045
  }
}
```

---

## 4. Migration Plan

| Step | SQL | Rollback |
|------|-----|---------|
| M1 | `CREATE TABLE llm_settings` + seed INSERTs | `DROP TABLE llm_settings` |
| M2 | `CREATE TABLE llm_fallback_events` | `DROP TABLE llm_fallback_events` |

Both migrations in a single file `app/backend/migrations/004_local_llm.sql`. No existing table changes.
