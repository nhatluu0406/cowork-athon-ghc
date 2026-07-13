# llm-svc Compilation Instructions — Separate PC/Environment

## Prerequisites

Ensure the following are installed on the compilation PC:

- **Rust toolchain** (1.70+)
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  rustup update
  rustc --version  # Should be 1.70+
  ```

- **Cargo** (comes with Rust)
  ```bash
  cargo --version
  ```

- **Protocol Buffer compiler** (protoc) — optional
  
  `tonic-build` includes a pre-compiled protoc fallback, so this is not strictly required. However, installing it can speed up builds:
  ```bash
  # macOS
  brew install protobuf
  
  # Ubuntu/Debian
  sudo apt-get install protobuf-compiler
  
  # Windows (if using native Rust)
  choco install protoc
  ```

---

## Build Steps

### 1. Clone or Copy Repository

```bash
# If cloning from origin
git clone https://github.com/your-org/ragmini.git
cd ragmini/llm-svc

# OR copy the llm-svc folder directly from the current PC
```

### 2. Verify Cargo.toml

Ensure `llm-svc/Cargo.toml` is present and valid:
```bash
ls -la Cargo.toml
cat Cargo.toml | head -20
```

### 3. Build Release Binary

```bash
cargo build --release
```

**What happens**:
- `build.rs` automatically compiles `proto/llmsvc.proto` using `tonic-build`
- Generated Rust gRPC code is placed in `target/` (not committed to git)
- All dependencies are fetched from crates.io

**Expected output**:
```
Compiling llm-svc v0.1.0
Compiling tonic-build v0.10
    ...
    Finished `release` profile [optimized] target(s) in 45s
```

**Output binary**: `target/release/llm-svc` (or `llm-svc.exe` on Windows)

**Note**: First build takes 30–60s due to dependency compilation. Subsequent clean builds are 10–20s.

### 4. Run Tests (Optional)

```bash
cargo test
```

**Expected**:
```
running 6 tests
test test_nlp_mode_from_env ... ok
test test_requires_local_models ... ok
test test_allows_cloud_fallback ... ok
test test_router_cloud_only ... ok
test test_router_local_only ... ok
test test_retry_policy ... ok

test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured
```

### 5. Verify Binary

```bash
# Check binary exists
file target/release/llm-svc

# List dependencies (optional, for audit)
cargo tree --depth 1
```

---

## Configuration for Running

Before running the binary on the target PC, set environment variables:

### Required

```bash
export LLMSVC_ADDR=0.0.0.0:9090                # gRPC server listen address
export NLP_MODE=1                              # 1=CloudOnly, 2=CloudWithLocalPreprocess, 3=LocalOnly
```

### Required if NLP_MODE=1 or 2 (cloud LLM operations)

```bash
export LLM_API_BASE_URL=https://mkp-api.fptcloud.com/v1  # Cloud LLM provider endpoint
export LLM_API_KEY=<your-api-key>              # API key for cloud provider
export LLM_MODEL=gpt-4o-mini                   # Default generative model
```

### Optional

```bash
export RUST_LOG=debug                          # For verbose logging (default: info)
export BRAIN_LOCAL_PROVIDER=qwen3-8b-q4       # Local model identifier (if using LocalOnly mode)
export MODELS_YAML_PATH=/path/to/models.yaml   # Custom model registry (default: models.yaml in CWD)
```

**Note**: If cloud env vars are missing and `NLP_MODE` requires cloud, the service will still start but cloud RPCs (Embed, Generate, etc.) will fail at request time.

---

## Running the Service

```bash
# Start the gRPC server
./target/release/llm-svc

# Or on Windows
.\target\release\llm-svc.exe
```

**Expected output**:
```
Starting gRPC server on 0.0.0.0:9090...
[INFO] llm-svc listening on 0.0.0.0:9090
```

---

## Testing with gRPC Client

Install `grpcurl` if needed:
```bash
# macOS
brew install grpcurl

# Ubuntu/Debian
go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest

# Or download from: https://github.com/fullstorydev/grpcurl/releases
```

### List available RPCs

```bash
grpcurl -plaintext 127.0.0.1:9090 list
```

Expected output shows all 8 RPCs:
```
llmsvc.LlmSvc.Compress
llmsvc.LlmSvc.DetectIntent
llmsvc.LlmSvc.Embed
llmsvc.LlmSvc.ExtractEntities
llmsvc.LlmSvc.Generate
llmsvc.LlmSvc.Health
llmsvc.LlmSvc.ListModels
llmsvc.LlmSvc.Rerank
```

### Test Health RPC (checks service liveness)

```bash
grpcurl -plaintext -d '{}' 127.0.0.1:9090 llmsvc.LlmSvc/Health
```

Expected response:
```json
{
  "status": "SERVING",
  "message": "gRPC service is running",
  "checks": {...}
}
```

### Test ListModels RPC (lists available models)

```bash
grpcurl -plaintext -d '{}' 127.0.0.1:9090 llmsvc.LlmSvc/ListModels
```

Expected response (if `MODELS_YAML_PATH` is set correctly):
```json
{
  "models": [
    {"name": "...", "kind": "embedding", ...},
    {"name": "...", "kind": "generative", ...}
  ]
}
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `rustc not found` | Install Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| `error: failed to run custom build command` | tonic-build is compiling proto; this is normal. On first build, may take 30–60s. |
| `cargo build` takes 5+ min | Normal for first build; dependencies are fetched and compiled. Subsequent builds are much faster. |
| `cargo test` fails | Check that `Cargo.toml` and `src/` are both present and valid. |
| `connection refused` on grpcurl | Ensure service is running: `./target/release/llm-svc` and `LLMSVC_ADDR=0.0.0.0:9090` is set. |
| `failed to get models` | Check `MODELS_YAML_PATH` env var points to a valid YAML file. If not set, service looks for `models.yaml` in current directory. |
| `grpcurl: command not found` | Install grpcurl: `brew install grpcurl` or equivalent for your OS. |

---

## Deliverable Checklist

After compilation on the separate PC, verify:

- [ ] `cargo build --release` completes without errors
- [ ] `cargo test` passes all 6 tests
- [ ] Binary exists: `target/release/llm-svc` (or `.exe`)
- [ ] Binary runs: `./target/release/llm-svc` starts without panic
- [ ] `Health` RPC responds: `grpcurl -plaintext -d '{}' 127.0.0.1:9090 llmsvc.LlmSvc/Health`
- [ ] `ListModels` RPC responds: `grpcurl -plaintext -d '{}' 127.0.0.1:9090 llmsvc.LlmSvc/ListModels`

---

## Next Steps (for Go Backend PC)

Once the binary is compiled and tested:

1. Copy `target/release/llm-svc` to the Go backend PC
2. Set environment variables on the backend PC
3. Start `llm-svc` service
4. Run smoke test: `cd src/m365-knowledge-graph && make smoke`
5. Verify all 16 endpoints respond with real data

---

## References

- **Cargo book**: https://doc.rust-lang.org/cargo/
- **Tonic gRPC**: https://github.com/hyperium/tonic
- **Protocol Buffers**: https://developers.google.com/protocol-buffers
- **gRPC CLI (grpcurl)**: https://github.com/fullstorydev/grpcurl
