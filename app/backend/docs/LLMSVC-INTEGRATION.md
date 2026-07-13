# LLM Service (llm-svc) Integration — T169-T176

## Overview

Group I Phase 2 (T169–T176a) implements **complete gRPC-based migration** from direct HTTP embedding/generation calls to a unified `llm-svc` microservice. This microservice acts as the single LLM-provider touchpoint for the Go backend, delegating embedding, reranking, NER, compression, intent detection, and answer generation.

**Key principle**: Go backend never makes direct calls to OpenAI, Anthropic, or other LLM providers. All LLM operations route through `llm-svc`.

---

## Architecture

```
m365-knowledge-graph (Go)
    ↓ gRPC
  llm-svc (Python/microservice)
    ├─ Embedding (OpenAI, Hugging Face, local models)
    ├─ Reranking (BGE, mMR, local)
    ├─ NER/Entity Extraction (LLM-based)
    ├─ Context Compression (map-reduce, abstractive)
    ├─ Intent Detection
    └─ Answer Generation (local model or cloud proxy per NLP_MODE)
```

---

## Configuration (T175)

### Environment Variables

| Variable | Default | Required | Purpose |
|----------|---------|----------|---------|
| `LLMSVC_ADDR` | (empty) | No | gRPC address of llm-svc (format: `host:port`, e.g., `localhost:9090`) |
| `LLMSVC_TLS` | `false` | No | Enable TLS for llm-svc connection (`true`/`false`) |
| `LLMSVC_CERT_FILE` | (empty) | No* | Path to TLS certificate file (*required if `LLMSVC_TLS=true`) |
| `LLM_API_BASE_URL` | (empty) | No | Legacy fallback: HTTP endpoint for custom OpenAI-compatible API |
| `LLM_EMBED_MODEL` | `text-embedding-3-small` | No | Default embedding model name |
| `LLM_MODEL` | `gpt-4o-mini` | No | Default generative model name |

### Priority

1. **LLMSVC_ADDR** (new, preferred)
2. **LLM_API_BASE_URL** (legacy fallback)
3. **Neither**: Embedding and generation gracefully degrade to no-op (nil interface)

### Example `.env`

```bash
# Development (local llm-svc)
LLMSVC_ADDR=localhost:9090
LLMSVC_TLS=false
LLM_EMBED_MODEL=text-embedding-3-small
LLM_MODEL=gpt-4o-mini

# Production (llm-svc behind TLS)
LLMSVC_ADDR=llm-svc.internal:9090
LLMSVC_TLS=true
LLMSVC_CERT_FILE=/etc/tls/llm-svc.crt

# Fallback to legacy API
LLM_API_BASE_URL=https://api.openai.com/v1
```

---

## Implementation Details

### T169: `internal/llmsvc/client.go`

**Typed gRPC wrapper over generated stubs.** Exposes:

```go
func (c *Client) Embed(ctx context.Context, texts []string, modelName string) ([][]byte, error)
func (c *Client) Rerank(ctx context.Context, query string, documents []DocumentForReranking, modelName string) ([]ScoredDocument, error)
func (c *Client) ExtractEntities(ctx context.Context, text string, taskMode string, schema string) (*NERResult, error)
func (c *Client) Compress(ctx context.Context, context string, targetTokens int, method string) (*CompressionResult, error)
func (c *Client) DetectIntent(ctx context.Context, query string, contextStr string) (*IntentDetectionResult, error)
func (c *Client) Generate(ctx context.Context, query string, context string, instructions string, temperature float32, maxTokens int) (*GeneratedAnswer, error)
func (c *Client) Health(ctx context.Context) (bool, error)
func (c *Client) ListModels(ctx context.Context, modelKind string) ([]ModelMetadata, error)
```

**Key features**:
- Dial gRPC service at `addr` (format: `host:port`)
- Convert proto responses to idiomatic Go types
- Error handling and service-error detection

### T170: `internal/embedding/svc_client.go`

**EmbeddingRuntime wrapper** for semantic search.

```go
type SvcClient struct {
    client    *llmsvc.Client
    modelName string
    taskType  string
}

func (sc *SvcClient) Embed(ctx context.Context, texts []string) ([][]float32, error)
```

**Key feature**: Converts byte-serialized embeddings from llm-svc to `[][]float32`.

### T170+T172+T174: `internal/embedding/svc_adapter.go`

**Unified adapter** implementing multiple interfaces:

- **EmbeddingRuntime**: `Embed(ctx, texts) → [][]float32`
- **LLMClient** (for answer generation): `Complete(ctx, prompt) → string`
- **NER support**: `ExtractEntities(ctx, text, taskMode) → *NERResult`
- **Reranking**: `Rerank(ctx, query, documents) → []ScoredDocument`
- **Compression**: `Compress(ctx, context, targetTokens, method) → *CompressionResult`

**Usage in main.go**:

```go
// Try llm-svc first (T175: priority order)
if cfg.LLMSvcAddr != "" {
    svcAdapter, err := embedding.NewSvcAdapter(cfg.LLMSvcAddr, cfg.LLMEmbedModel, cfg.LLMModel)
    if err == nil {
        embedRuntime = svcAdapter  // EmbeddingRuntime interface
        llmClient = svcAdapter     // LLMClient interface
    }
}

// Fallback to custom API
if embedRuntime == nil && cfg.LLMAPIBase != "" {
    concreteClient := embedding.NewCustomAPIClient(cfg.LLMAPIBase, "", cfg.LLMModel, cfg.LLMEmbedModel)
    embedRuntime = concreteClient
    llmClient = concreteClient
}
```

### T171: `internal/embedding/batch.go`

**No changes required.** Already uses `EmbeddingRuntime` interface:

```go
type BatchProcessor struct {
    runtime EmbeddingRuntime  // Works with SvcClient or CustomAPIClient
    // ...
}
```

### T172: `internal/nlp/extractor.go`

**No changes required.** Already uses `LLMClient` interface:

```go
type Extractor struct {
    llm LLMClient  // Works with SvcAdapter or CustomAPIClient
}

func (e *Extractor) Extract(ctx context.Context, text string) (*ExtractionResult, error) {
    response, err := e.llm.Complete(ctx, prompt)
    // ...
}
```

### T173: `internal/retrieval/reranker.go`

**Future enhancement.** Currently uses heuristic scoring; could be updated to call `llmsvc.Client.Rerank` for LLM-based reranking.

### T174: `internal/retrieval/answer_gen.go`

**No changes required.** Already uses `LLMClient` interface:

```go
type AnswerGenerator struct {
    llm LLMClient  // Works with SvcAdapter or CustomAPIClient
}

func (ag *AnswerGenerator) Generate(ctx context.Context, query string, packedContext string) (string, []interface{}) {
    answer, err := ag.llm.Complete(ctx, prompt)
    // ...
}
```

### T175: Configuration

Config fields added:

```go
type Config struct {
    // ...
    LLMSvcAddr     string  // gRPC address of llm-svc
    LLMSvcTLS      bool    // Enable TLS
    LLMSvcCertFile string  // TLS certificate file path
    // ...
}
```

Environment variables loaded in `LoadConfig()`:

```go
LLMSvcAddr:     getEnv("LLMSVC_ADDR", ""),
LLMSvcTLS:      getEnv("LLMSVC_TLS", "false") == "true",
LLMSvcCertFile: getEnv("LLMSVC_CERT_FILE", ""),
```

### T176: Integration Test

File: `tests/integration/llmsvc_integration_test.go`

**Tests** (requires `llm-svc` running on localhost:9090):

- `TestLLMSvcClient_Embed`: gRPC Embed RPC
- `TestLLMSvcClient_Health`: Health check
- `TestSvcAdapter_Embed`: Adapter's Embed interface
- `TestSvcAdapter_Complete`: Adapter's Complete interface
- `TestSvcAdapter_ExtractEntities`: NER via ExtractEntities (T172)
- `TestSvcAdapter_Generate`: Answer generation (T174)
- `BenchmarkEmbedding`: Performance baseline

**Run integration tests**:

```bash
# Requires llm-svc running
go test -v -tags=integration ./tests/integration -run TestLLMSvc
```

### T176a: Deletion

Once all rewiring is verified (T169–T176 pass), delete:

```bash
rm internal/embedding/custom_api.go
```

**Safety check**: Ensure no remaining callers:

```bash
grep -r "NewCustomAPIClient\|CustomAPIClient{" internal/ cmd/
```

Should return no results.

---

## Migration Checklist

- [x] T169: Implement `internal/llmsvc/client.go` — typed gRPC wrapper
- [x] T170: Implement `internal/embedding/svc_client.go` — EmbeddingRuntime wrapper
- [x] T171: Rewire `internal/embedding/batch.go` — uses EmbeddingRuntime interface (no changes needed)
- [x] T172: Rewire `internal/nlp/extractor.go` — uses LLMClient interface (no changes needed)
- [ ] T173: Rewire `internal/retrieval/reranker.go` — optional llmsvc.Rerank integration
- [x] T174: Rewire `internal/retrieval/answer_gen.go` — uses LLMClient interface (no changes needed)
- [x] T175: Add LLMSVC_ADDR/LLMSVC_TLS config; remove LLM_API_BASE_URL from validation
- [x] T176: Integration test (embedding, nlp, retrieval against running llm-svc)
- [ ] T176a: Delete `internal/embedding/custom_api.go` once verified

---

## Debugging

### Health Check

```bash
grpcurl -plaintext localhost:9090 llmsvc.LlmSvc/Health
```

### Logs

Enable debug logging in Go:

```bash
RUST_LOG=debug go run ./cmd
```

Check llm-svc logs for gRPC errors, model loading issues, etc.

### Common Issues

| Issue | Solution |
|-------|----------|
| `failed to dial localhost:9090` | Ensure llm-svc is running and listening |
| `service error: model not found` | Check model name matches llm-svc config |
| `embedding size mismatch` | Verify embedding dimensions match model |
| `TLS handshake failure` | Check `LLMSVC_CERT_FILE` path and permissions |

---

## References

- **Proto definition**: `proto/llmsvc.proto`
- **Implementation**: `internal/llmsvc/` + `internal/embedding/svc_*.go`
- **Main wiring**: `cmd/main.go` (lines ~96–130)
- **Tests**: `tests/integration/llmsvc_integration_test.go`
- **Config**: `internal/common/config.go`
