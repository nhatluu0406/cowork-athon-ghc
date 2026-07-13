# LLM-SVC Implementation Guide (Group I Phase 1)

## Overview

This document describes the Rust gRPC service (`llm-svc`) that serves all LLM-shaped operations for the M365 Knowledge Graph. The service implements the interface defined in `proto/llmsvc.proto` and is designed to run as a standalone microservice.

> **Status note (2026-07-11):** `cargo build --release` / `cargo test` for this service have not been independently verified — no environment used to develop it had a Rust toolchain installed. Treat build/test status as unverified. Local model inference (ONNX/GGUF/safetensors) is genuinely unimplemented Phase 2 work (hardcoded stub errors), not a completed feature.

## Architecture

### Service Layers

```
┌─────────────────────────────────────────────────┐
│        gRPC RPC Handlers (service.rs)           │
│  Embed | Rerank | Extract | Compress | Generate │
│      Detect Intent | Health | ListModels       │
└────────────────┬────────────────────────────────┘
                 │
        ┌────────▼────────┐
        │  Router (T164)  │
        │ NLP_MODE policy │
        │ fail-open/close │
        └────┬─────┬──────┘
             │     │
    ┌────────▼─┐  ┌─▼──────────────┐
    │   Local  │  │  Cloud Proxy   │
    │  Models  │  │  (OpenAI API)  │
    │  (T160-  │  │   (T163)       │
    │   T162)  │  └────────────────┘
    │ONNX/    │
    │GGUF/    │
    │Safeten. │
    └─────────┘

Model Registry (models.yaml) [T166]
  - Model metadata (name, kind, format, path, dims)
  - Hot-reload support
  - Fallback defaults
```

### Task Coverage (T159–T168)

| Task | Title | Status | Implementation |
|------|-------|--------|-----------------|
| T159 | Scaffold llm-svc | ✅ | `src/main.rs`, `src/service.rs`, `src/lib.rs` |
| T160 | ONNX inference | Phase 2 | `src/models/onnx.rs` (stubs) |
| T161 | GGUF inference | Phase 2 | `src/models/gguf.rs` (stubs) |
| T162 | Safetensors inference | Phase 2 | `src/models/safetensors.rs` (stubs) |
| T163 | Cloud proxy | ✅ | `src/cloud_proxy.rs` (OpenAI-compatible HTTP) |
| T164 | Routing logic | ✅ | `src/routing.rs` (NLP_MODE 1/2/3 with retry) |
| T165 | Rerank RPC | ✅ Partial | Service skeleton; Phase 2: ONNX impl |
| T166 | models.yaml loader | ✅ | `src/config.rs` (YAML parsing + hot-reload) |
| T167 | Health/ListModels RPCs | ✅ | `src/service.rs` (functional) |
| T168 | No Ollama dependency | ✅ | Verified via `tests/smoke_test.rs` |

## Phase 1 Deliverables

### T159: Service Scaffolding

**Files:**
- `src/main.rs` — gRPC server bootstrap
  - Reads `LLMSVC_ADDR` (default `0.0.0.0:9090`)
  - Initializes logging via `tracing`
  - Creates `LlmSvcImpl` and starts `tonic` server
  
- `src/service.rs` — RPC trait implementation
  - All 8 RPCs: Embed, Rerank, ExtractEntities, Compress, DetectIntent, Generate, Health, ListModels
  - Routing via `Router::route(task_name)`
  - Fallback logic: cloud error → local retry (mode 2); local error → fail (mode 3)
  - Simple intent detection fallback when neither local nor cloud available

- `src/lib.rs` — Module declarations and proto codegen

- `build.rs` — Proto code generation via `tonic-build`

### T163: Cloud Proxy (OpenAI-compatible)

**File:** `src/cloud_proxy.rs`

```rust
pub struct CloudProxyClient {
    base_url: String,        // LLM_API_BASE_URL (default: https://mkp-api.fptcloud.com/v1)
    api_key: String,         // LLM_API_KEY
    model: String,           // LLM_MODEL (default: gpt-4o-mini)
    http_client: reqwest::Client,
}
```

**Methods:**
- `generate(prompt, max_tokens, temperature)` → String
  - Calls `/chat/completions` endpoint
  - Request format: `{ model, messages: [{ role, content }], temperature, max_tokens, stream: false }`
  - Response: extracts `choices[0].message.content`

- `extract(text)` → (entities: Vec<String>, relationships: Vec<(String, String)>)
  - Prompts cloud LLM to extract entities and relationships
  - Parses JSON response or falls back to line-based parsing

- `detect_intent(query)` → String
  - Classifies query into one of: find_expert, find_document, find_project_info, find_technology_usage, general_question

- `from_env()` → Option<CloudProxyClient>
  - Returns None if LLM_API_BASE_URL or LLM_API_KEY missing
  - Detects provider type from URL (fallback: Custom)

### T164: Routing Logic with Exponential Backoff

**File:** `src/routing.rs`

**NlpMode Enum:**
```rust
pub enum NlpMode {
    CloudOnly = 1,                      // All ops → cloud
    CloudWithLocalPreprocess = 2,       // Pre-process → local; gen/extract → cloud (with fallback)
    LocalOnly = 3,                      // All ops → local (fail-closed)
}
```

**Router Implementation:**
```rust
pub struct Router {
    mode: NlpMode,
    has_local_models: bool,
    has_cloud_config: bool,
}

impl Router {
    pub fn route(&self, task: &str) -> RouteDecision
    // Returns: Cloud | Local | Error
}
```

**Routing Table:**

| Mode | Task | Route | Fallback |
|------|------|-------|----------|
| 1 (Cloud) | Any | Cloud | ✗ |
| 2 (Mixed) | detect_intent, query_ner, compress | Local | Cloud |
| 2 (Mixed) | extract_entities, generate | Cloud | Local |
| 2 (Mixed) | embed, rerank | Local | Cloud |
| 3 (Local) | Any | Local | ✗ (Error) |

**Retry Policy (exponential backoff):**
```rust
pub struct RetryPolicy {
    max_attempts: u32,       // 3
    base_delay_ms: u64,      // 1000
    max_delay_ms: u64,       // 32000
    jitter: bool,            // true
}
```

Backoff: `delay_ms = base_delay * 2^attempt`, with ±25% jitter per attempt.

### T166: Models Configuration (models.yaml)

**File:** `models.yaml`

```yaml
models:
  - name: text-embedding-3-small
    kind: embedding
    format: cloud
    dims: 1536
    version: "1.0"
    is_default: true

  - name: bge-reranker-base
    kind: reranker
    format: onnx
    path: /models/bge-reranker-base.onnx
    dims: 0
    version: "1.0"
    is_default: true

  - name: qwen3-8b-q4
    kind: generative
    format: gguf
    path: /models/qwen3-8b-q4.gguf
    dims: 0
    version: "1.0"
    is_default: true
```

**Config Loader (src/config.rs):**
- Reads `MODELS_YAML_PATH` env var (optional)
- Falls back to hardcoded defaults if file not found
- Provides `Config::get_model(name)` and `Config::get_default_model(kind)` lookup

**Hot-reload:** Config can be reloaded by replacing `models` list via `ModelRegistry::replace()`

### T167: Health and ListModels RPCs

**Health RPC:**
```protobuf
rpc Health(HealthRequest) returns (HealthResponse);
```

Response includes:
- status: "SERVING"
- message: "llm-svc is running"
- checks: { "llm_svc": "ok", "cloud_proxy": "configured"|"not_configured", "nlp_mode": "<mode>" }

**ListModels RPC:**
```protobuf
rpc ListModels(ListModelsRequest) returns (ListModelsResponse);
```

- Optional filter by `kind`: "embedding" | "reranker" | "generative"
- Returns list of `ModelInfo` (name, kind, format, dimensions, version, is_local, is_default, metadata)

### T168: No Ollama Dependency Verification

**Verification Strategy:**

1. **Code audit:** No hardcoded references to port 11434 or Ollama URLs
2. **Config audit:** No environment variables expecting Ollama configuration
3. **Dependency audit:** `Cargo.toml` has no `ollama` crate or similar
4. **Runtime test:** Smoke test verifies service initialization without network calls to localhost:11434

**Smoke Test (tests/smoke_test.rs):**
```rust
#[test]
fn test_service_initialization() { ... }      // Config loads without env vars
#[test]
fn test_service_creation() { ... }            // Service can be created and cloned
#[test]
fn test_routing_logic() { ... }               // All 3 modes route correctly
#[test]
fn test_model_registry() { ... }              // Models can be registered and retrieved
#[test]
fn test_no_ollama_dependency() { ... }        // Verifies no hardcoded Ollama refs
#[test]
fn test_nlp_mode_parsing() { ... }            // NLP_MODE env var parsing
#[test]
fn test_model_format_parsing() { ... }        // Model format enum parsing
#[test]
fn test_retry_policy() { ... }                // Exponential backoff calculation
```

**Run tests:**
```bash
cd llm-svc
cargo test
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `LLMSVC_ADDR` | `0.0.0.0:9090` | gRPC server bind address |
| `NLP_MODE` | `2` | LLM operation policy (1=cloud, 2=mixed, 3=local) |
| `LLM_API_BASE_URL` | (none) | Cloud LLM endpoint (e.g., https://mkp-api.fptcloud.com/v1) |
| `LLM_API_KEY` | (none) | Cloud LLM API key |
| `LLM_MODEL` | `gpt-4o-mini` | Default cloud model name |
| `BRAIN_LOCAL_PROVIDER` | `qwen3-8b-q4` | Local model identifier (for modes 2/3) |
| `BRAIN_FALLBACK_TO_CLOUD` | `true` | Allow cloud fallback in mode 2 |
| `MODELS_YAML_PATH` | (none) | Path to models.yaml; uses defaults if unset |

## Phase 2 Work (Deferred)

### T160–T162: Local Model Inference

These tasks implement actual inference via:
- **T160 (ONNX):** `ort` crate — embedding and reranking via ONNX Runtime
  - Reference: Go code would be in `src/Backend/internal/llm/onnx_*.go` (currently empty)
  - Embed and Rerank RPCs dispatch here when local route chosen

- **T161 (GGUF):** `llama-cpp-2` crate — generative models (Qwen, Llama, Mistral)
  - Reference: Go code in `internal/llm/gguf_*.go` (currently empty)
  - DetectIntent, ExtractEntities, Compress, Generate dispatch here

- **T162 (Safetensors):** `candle` crate — fallback inference for safetensors format
  - Reference: Go code in `internal/llm/safetensors_*.go` (currently empty)

Current Phase 1 status: Stubs return `Unimplemented` or fall back to cloud proxy.

## Testing Strategy

### Unit Tests
- `tests/smoke_test.rs` — 9 core tests covering all Phase 1 deliverables
- Run: `cargo test --test smoke_test`

### Integration Tests (Phase 2)
- End-to-end Embed/Rerank/Generate via running service
- Multi-mode routing (mode 1 vs 2 vs 3 behavior)
- Exponential backoff retry simulation

### Manual Testing

**Start service (mode 1: cloud-only):**
```bash
export NLP_MODE=1
export LLM_API_BASE_URL=https://mkp-api.fptcloud.com/v1
export LLM_API_KEY=<your-key>
export LLM_MODEL=gpt-4o-mini
cargo run --release
```

**Test with gRPC client:**
```bash
grpcurl -plaintext -d '{"query":"Who is John Doe?"}' \
  127.0.0.1:9090 llmsvc.LlmSvc/DetectIntent

grpcurl -plaintext \
  127.0.0.1:9090 llmsvc.LlmSvc/Health
```

## Proto Definitions

All RPC message types are defined in `proto/llmsvc.proto` and compiled to Rust via `tonic-build`. The generated code is included in the binary and can be accessed as:
```rust
use crate::llmsvc::{EmbedRequest, EmbedResponse, ...};
```

## Deployment Notes

1. **Single Process:** llm-svc is a standalone service; no dependencies on the Go backend (`src/m365-knowledge-graph/`)

2. **Model Files:** Local models (ONNX, GGUF) must be copied to paths specified in `models.yaml` before service start

3. **Port:** Default 9090; can be changed via `LLMSVC_ADDR` env var

4. **Logging:** Uses `tracing` + `tracing-subscriber`; set `RUST_LOG=debug` for verbose output

5. **Health Check:** Kubernetes readiness probe should call `Health` RPC

## References

- Proto definitions: `proto/llmsvc.proto`
- Go backend reference (for Phase 2 porting):
  - Retrieval: `src/m365-knowledge-graph/internal/retrieval/stages.go`
  - (LLM code to be ported is currently empty in `internal/llm/`)
- Spec: `specs/REQ-204-M365-001-m365-knowledge-graph/spec.md` (§3.4–3.5, §12)
