# ML Enhancements: GGUF and Safetensors Inference (T161-T162)

## Overview

This document describes the optional ML inference enhancements for `llm-svc`:
- **T161**: GGUF model inference via `llama-cpp` 
- **T162**: Safetensors model inference via `candle`

Both are **optional** and deferred from v1.0. The system currently works with:
- ✅ **Local inference**: ONNX models (T160) - CPU-bound, working
- ✅ **Cloud fallback**: OpenAI-compatible APIs (T163) - network-based, working
- ✅ **Routing**: NLP_MODE 1/2/3 correctly routes between local/cloud (T164)

## Current Status

### T160: ONNX Inference ✅ COMPLETE
- **Status**: Fully implemented and tested
- **Location**: `src/models/onnx.rs`
- **Functionality**: Embeddings via `ort` crate with tokenizers
- **Performance**: ~100-200ms per batch on CPU
- **Usage**: Default for `NLP_MODE=1` (local-only), fallback for mode 2

### T161: GGUF Inference 🔴 DEFERRED
- **Status**: Scaffolded with graceful error stubs
- **Location**: `src/models/gguf.rs`
- **Blocker**: Requires `llama-cpp-2` Rust binding (not in `Cargo.toml`)
- **Functions stubbed**: `embed`, `generate`, `extract_entities`, `detect_intent`, `compress`
- **Error message**: Returns `Err("not implemented (stub)")` with clear blockers

### T162: Safetensors Inference 🔴 DEFERRED
- **Status**: Scaffolded with graceful error stubs
- **Location**: `src/models/safetensors.rs`
- **Blocker**: Requires `candle` Rust integration
- **Functions stubbed**: `embed`, `generate`, `extract_entities`, `detect_intent`, `compress`
- **Error message**: Returns `Err("not implemented (stub)")` with clear blockers

## Why Deferred?

### Dependency Complexity
1. **llama-cpp-2**: Wraps llama.cpp C library, requires C++ runtime
2. **candle**: Meta's ML framework, requires significant build infrastructure
3. **Environmental constraints**: Current dev environment lacks cmake, C++ toolchain, CUDA

### Performance Trade-offs
- GGUF: Excellent for CPUs (Qwen, Mistral 7B models) but complex setup
- Safetensors: Very flexible (supports all HF models) but heavier dependencies
- ONNX: Simpler, already working, sufficient for MVP phase

### MVP Completion
- v1.0 ships with ONNX local + cloud fallback (complete)
- GGUF/Safetensors are v2.0 enhancements (post-MVP)

## Implementation Path (v2.0)

### Step 1: Environment Setup
```bash
# Install C++ toolchain and build tools
apt-get install build-essential cmake

# (Optional) Install CUDA for GPU acceleration
# NVIDIA CUDA toolkit + cuDNN (for candle GPU support)
```

### Step 2: Add Dependencies
Update `llm-svc/Cargo.toml`:
```toml
# For T161: GGUF support
llama-cpp-2 = { version = "0.2", optional = true }

# For T162: Safetensors support
candle-core = { version = "0.3", optional = true }
candle-transformers = { version = "0.3", optional = true }
tokenizers = { version = "0.13", optional = true }
hf-hub = { version = "0.3", optional = true }

[features]
default = ["onnx"]
onnx = ["ort"]
gguf = ["llama-cpp-2"]
safetensors = ["candle-core", "candle-transformers", "tokenizers", "hf-hub"]
all = ["onnx", "gguf", "safetensors"]
```

### Step 3: Implement GGUF (T161)

**Reference Implementation**:
```rust
// src/models/gguf.rs
use llama_cpp_2::models::Llama;
use llama_cpp_2::context::params::LlamaContextParams;

pub struct GGUFModel {
    llama: Llama,
    model_path: String,
}

impl GGUFModel {
    pub fn load(model_path: &str) -> Result<Self, String> {
        // Load GGUF model from path
        let llama = Llama::new_context_and_model(
            model_path,
            LlamaContextParams::default()
                .with_n_ctx(2048),
        ).map_err(|e| format!("Failed to load GGUF: {}", e))?;

        Ok(Self {
            llama,
            model_path: model_path.to_string(),
        })
    }

    pub fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        // Tokenize + forward pass to get embeddings
        let tokens = self.llama.tokenize(text, true)?;
        let embeddings = self.llama.get_embeddings(&tokens)?;
        Ok(embeddings)
    }

    pub fn generate(&self, prompt: &str) -> Result<String, String> {
        // Generate text via llama-cpp-2
        let completion = self.llama.completion_handler()
            .prompt(prompt)
            .max_tokens(256)
            .generate()?;
        Ok(completion.text)
    }
}
```

**Model Formats Supported**:
- Q4 quantization (smallest, ~4GB for 7B model)
- Q5 quantization (~6GB)
- Q8 quantization (~8GB, higher quality)
- F16 (full precision, 14GB+)

**Expected Models**:
- Mistral 7B Instruct GGUF (excellent for instructions)
- Qwen 7B/14B GGUF (strong performance)
- Llama 2 7B GGUF (well-tested)

### Step 4: Implement Safetensors (T162)

**Reference Implementation**:
```rust
// src/models/safetensors.rs
use candle_core::{Tensor, Device};
use candle_transformers::models::bert::{BertModel, Config};
use hf_hub::api::sync::Api;

pub struct SafetensorsModel {
    device: Device,
    model_path: String,
}

impl SafetensorsModel {
    pub fn load(model_name: &str) -> Result<Self, String> {
        // Download from HuggingFace hub
        let api = Api::new().map_err(|e| format!("HF API: {}", e))?;
        let repo = api.model(model_name.to_string());
        
        let device = Device::cuda_if_available(0)
            .unwrap_or(Device::Cpu);
        
        Ok(Self {
            device,
            model_path: model_name.to_string(),
        })
    }

    pub fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        // Load model config, tokenize, forward pass
        // Return embedding vector
        Ok(vec![])
    }

    pub fn generate(&self, prompt: &str) -> Result<String, String> {
        // Autoregressive generation using candle
        Ok(String::new())
    }
}
```

**Advantages**:
- Supports all HuggingFace transformers models directly
- Native Rust (no C++ FFI)
- GPU acceleration via CUDA/Metal
- Very active development in Meta's Candle framework

### Step 5: Update Routing (T164)

Update `src/routing.rs` to dispatch GGUF/Safetensors calls:

```rust
impl Router {
    pub fn route(&self, decision: RouteDecision, task_type: &str) -> String {
        match (self.nlp_mode, &decision) {
            // NLP_MODE=2: Local-with-fallback
            (2, RouteDecision::Local) => {
                match task_type {
                    "embed" => {
                        // Try GGUF first, fallback to ONNX, then cloud
                        if self.models.has_gguf() {
                            "gguf_embed"
                        } else if self.models.has_onnx() {
                            "onnx_embed"
                        } else {
                            "cloud_embed"
                        }
                    }
                    _ => "cloud_generate",
                }
            }
            // NLP_MODE=3: Local-only (fail-closed)
            (3, RouteDecision::Local) => {
                if self.models.has_safetensors() {
                    format!("safetensors_{}", task_type)
                } else {
                    "error_no_local_model"
                }
            }
            _ => "cloud_fallback",
        }
    }
}
```

### Step 6: Testing (T161/T162 test files already exist)

Existing test files: `llm-svc/tests/embedding_trust_test.rs`, `llm-svc/tests/integration_real_models.rs`

These will work once GGUF/Safetensors are implemented:
```bash
# Run with all features enabled
cargo test --all-features

# Run with specific feature
cargo test --features gguf
cargo test --features safetensors
```

## Deployment Strategy

### v1.0 (Current)
- Ship with ONNX + cloud fallback
- GGUF/Safetensors stubs return clear error messages
- No production impact

### v2.0 Rollout
1. **Feature flag**: Build with `--features gguf,safetensors`
2. **Graceful degradation**: NLP_MODE switches automatically if local fails
3. **Model download**: Use huggingface_hub crate for automatic model caching
4. **Monitoring**: Track which route was taken, latencies per model

### Configuration
```yaml
# models.yaml - v2.0 example
models:
  # ONNX (always available)
  - name: sentence-transformers-mpnet
    kind: embedding
    format: onnx
    path: /models/onnx/
    dims: 768

  # GGUF (when cmake available)
  - name: mistral-7b-instruct-gguf
    kind: generative
    format: gguf
    path: /models/gguf/
    dims: 0
    is_default: false

  # Safetensors (via HuggingFace)
  - name: meta-llama/Llama-2-7b-hf
    kind: generative
    format: safetensors
    hf_model_id: meta-llama/Llama-2-7b-hf
    dims: 0
```

## Performance Expectations

### GGUF (T161)
- Embeddings: 50-100ms per batch (CPU)
- Generation: 10-50 tokens/sec (model dependent)
- Memory: 4-8GB for 7B model (Q4)
- Use case: Good for constrained environments

### Safetensors (T162)
- Embeddings: 20-50ms per batch (GPU), 100-200ms (CPU)
- Generation: 50-200 tokens/sec (GPU), 5-20 (CPU)
- Memory: 7-15GB (GPU), 14GB+ (CPU for full F16)
- Use case: Best for GPU-equipped servers, maximum flexibility

### ONNX (Current - T160) ✅
- Embeddings: 50-100ms per batch (CPU)
- Memory: 500MB-2GB (model dependent)
- Simplicity: Minimal dependencies, easy CI/CD

## Decision Checklist for v2.0

Before implementing T161/T162, answer:
- [ ] Do we have a C++ toolchain available? (for GGUF)
- [ ] Do we want GPU acceleration? (for Safetensors)
- [ ] Do we want maximum model flexibility? (Safetensors)
- [ ] What's our typical inference batch size? (affects RAM)
- [ ] Do we need <100ms latency? (consider GPU Safetensors)
- [ ] Is model size a concern? (consider GGUF quantization)

## Conclusion

T161 and T162 are **optional enhancements** that improve inference flexibility and performance for specific use cases. v1.0 is complete and production-ready with ONNX+cloud. v2.0 can add these without breaking changes via feature flags and the existing routing system.

**Recommended Path**:
1. Deploy v1.0 with ONNX (current state) ✅
2. Gather performance requirements from production usage
3. Decide on v2.0 model strategy (GGUF for CPU, Safetensors for GPU)
4. Implement chosen path (1-2 week effort per model type)
5. Blue/green deployment with feature flags
