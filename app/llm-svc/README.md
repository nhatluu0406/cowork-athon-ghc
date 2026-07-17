# llm-svc: Unified Rust gRPC Service for LLM Processing

llm-svc is a standalone Rust service that encapsulates all LLM-related computation for the M365 Knowledge Graph system. The Go backend (`src/m365-knowledge-graph/`) communicates with llm-svc exclusively over gRPC; the Go code never makes direct calls to LLM providers (local or cloud).

> **Status note (2026-07-11):** Scaffolding, routing, config, and cloud-proxy plumbing are implemented in source. `cargo build`/`cargo test` have not been independently verified in any environment with a Rust toolchain — do not assume the build is green until confirmed. Local model inference (ONNX/GGUF/safetensors) is not implemented yet; those code paths return explicit stub errors and are tracked as Phase 2 work.

## Overview

### What llm-svc Does

- **Embedding generation**: Local ONNX models or cloud OpenAI-compatible endpoint
- **Reranking**: ONNX-based BGE reranker scoring documents against queries
- **Entity/Relationship extraction (NER)**: Local GGUF models (modes 2–3) or cloud proxy (modes 1–2)
- **Context compression**: Map-reduce or abstractive summarization
- **Intent detection**: Local GGUF (modes 2–3) or cloud proxy
- **Answer generation**: Local GGUF (modes 2–3) or cloud proxy

### NLP_MODE Policy

The service routes requests based on the `NLP_MODE` environment variable:

- **Mode 1** (`cloud_only`): All operations proxy to the cloud LLM provider
- **Mode 2** (`cloud_with_local_preprocess`, default): Pre-processing (intent detection, query NER, compression) runs locally; extraction and generation proxy to cloud
- **Mode 3** (`local_only`): All operations run locally (offline/air-gapped deployments)

## Building llm-svc

### Prerequisites

1. **Rust 1.70+** (install from https://rustup.rs/)
2. **protoc** (install from https://github.com/protocolbuffers/protobuf/releases)
   - On macOS: `brew install protobuf`
   - On Ubuntu/Debian: `apt-get install protobuf-compiler`
   - On Windows: Download the latest release and add to PATH
3. Optional model files (ONNX, GGUF) for local inference

### Build Steps

```bash
# Clone or navigate to the repository
cd llm-svc

# Build the Rust service
cargo build --release

# Output: target/release/llm-svc (or llm-svc.exe on Windows)
```

### Running llm-svc

```bash
# Set configuration via environment variables
export NLP_MODE=2
export LLM_API_BASE_URL=https://mkp-api.fptcloud.com/v1
export LLM_API_KEY=<your-api-key>
export LLMSVC_ADDR=0.0.0.0:9090
export BRAIN_LOCAL_PROVIDER=qwen3-8b-q4

# Start the service
./target/release/llm-svc
# Service listens on localhost:9090 (or configured LLMSVC_ADDR)
```

### Docker Deployment

```bash
# Build the Docker image
docker build -t llm-svc:latest .

# Run with environment variables
docker run -it --rm \
  -p 9090:9090 \
  -e NLP_MODE=2 \
  -e LLM_API_BASE_URL=https://mkp-api.fptcloud.com/v1 \
  -e LLM_API_KEY=<your-api-key> \
  -v /path/to/models:/models \
  llm-svc:latest
```

## Proto Definition

The gRPC contract is defined in `proto/llmsvc.proto`:

- **Service**: `LlmSvc` with 8 RPCs (Embed, Rerank, ExtractEntities, Compress, DetectIntent, Generate, Health, ListModels)
- **Go code generation**: Run `make proto` in `src/m365-knowledge-graph/` to generate Go client stubs
- **Rust code generation**: Automatic via `build.rs` (tonic-build)

## Configuration

Environment variables (read by llm-svc, not the Go backend):

| Variable | Default | Purpose |
|----------|---------|---------|
| `LLMSVC_ADDR` | `0.0.0.0:9090` | gRPC server bind address |
| `NLP_MODE` | `2` | Routing policy (1/2/3) |
| `LLM_API_BASE_URL` | (optional) | Cloud LLM endpoint |
| `LLM_API_KEY` | (optional) | Cloud LLM API key |
| `LLM_MODEL` | `gpt-4o-mini` | Cloud model name |
| `BRAIN_LOCAL_PROVIDER` | `qwen3-8b-q4` | Local model ID (modes 2/3) |
| `BRAIN_FALLBACK_TO_CLOUD` | `true` | Allow cloud fallback in mode 2 |

## Directory Structure

```
llm-svc/
├── Cargo.toml                 # Rust dependencies and metadata
├── build.rs                   # tonic-build code generation for proto
├── proto/
│   └── llmsvc.proto          # gRPC contract (source of truth)
├── src/
│   ├── main.rs               # tonic gRPC server bootstrap
│   ├── lib.rs                # Library module declarations
│   ├── service.rs            # LlmSvc trait implementation (all 8 RPCs)
│   ├── routing.rs            # NLP_MODE policy enforcement
│   ├── models.rs             # Model format support (ONNX, GGUF, safetensors)
│   ├── cloud_proxy.rs        # Cloud LLM provider client
│   └── config.rs             # Configuration loading
├── models.yaml               # Model configuration
└── README.md                 # This file
```

## Development

### Code Generation

Proto stubs are generated automatically by `build.rs` during `cargo build`:

```bash
# Regenerate proto stubs (usually not needed unless proto/llmsvc.proto changes)
cargo clean
cargo build
```

### Tests

```bash
# Run unit tests
cargo test

# Run integration tests (requires running llm-svc and connected services)
cargo test --test integration
```

### Linting

```bash
# Format code
cargo fmt

# Check for common mistakes
cargo clippy
```

## Phase Implementation Notes

### Phase 1–2: Foundation (T157–T158)
- Proto definition: ✓ Created (`proto/llmsvc.proto`)
- Rust stubs: ✓ Generated via `build.rs` (tonic-build)
- Go client stubs: ✓ Generated via `protoc` + `protoc-gen-go-grpc`
- Service scaffolding: ✓ Created (service.rs, routing.rs, models.rs, etc.)
- Model inference: ⚠️ TODO (Phase 2 implementation)
- Cloud proxy: ⚠️ TODO (Phase 2 implementation)

### Phase 2: Model Runtime Implementation
- ONNX inference (ort crate)
- GGUF inference (llama.cpp Rust binding)
- safetensors inference (candle)
- Cloud proxy client (OpenAI-compatible HTTP)
- Health check and metrics

### Phase 3+: Integration with Go Backend
- Go backend connects to llm-svc via gRPC client
- Embedding retrieval pipeline uses `internal/llmsvc.Client.Embed`
- Reranking uses `internal/llmsvc.Client.Rerank`
- NER extraction uses `internal/llmsvc.Client.ExtractEntities`
- Context compression uses `internal/llmsvc.Client.Compress`
- Intent detection uses `internal/llmsvc.Client.DetectIntent`
- Answer generation uses `internal/llmsvc.Client.Generate`

## See Also

- Spec: `specs/REQ-204-M365-001-m365-knowledge-graph/spec.md` §3.4 (Brain Integration) and §3.5 (llm-svc)
- Go backend: `src/m365-knowledge-graph/`
- Proto contract: `proto/llmsvc.proto` (source of truth, copied to `src/m365-knowledge-graph/proto/llmsvc.proto`)
