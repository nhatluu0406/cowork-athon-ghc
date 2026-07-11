# Feature Specification: Enterprise Knowledge Graph from Microsoft 365

**Feature ID**: REQ-M365-001
**Created**: 2026-07-09
**Status**: Draft
**Author**: speckit-planner
**Branch target**: `001-m365-knowledge-graph`

> **Provenance**: This file consolidates `spec_1.1.md`, `spec_1.2.md`, and `spec_1.3.md` (previously divergent drafts) into the canonical spec, superseding all three. Three conflicts surfaced during the merge were resolved by explicit decision:
> 1. **Metadata DB engine → PostgreSQL** (not SQLite). All schemas below use valid PostgreSQL DDL.
> 2. **Auth → Microsoft Entra ID SSO + Local JWT (demo fallback)** confirmed. The generic username/password auth design (Argon2id, UserService/UserDB, `login_events`) proposed in `spec_1.3.md` does not apply to this feature and has been dropped.
> 3. **Embedding storage → PostgreSQL** (`embedding_models` / `chunk_embeddings` / `embedding_jobs`), replacing the earlier "SQLite FTS" references.
>
> **Amendment (2026-07-11)**: Two architectural changes added on top of the consolidated spec, cross-referenced from `specs/REQ-023-brain-platform/` and the `/speckit-analyze` review of that feature's local-LLM routing slice:
> 1. **Brain integration** — query planning/compression/NER pre-processing is routed through the Brain Platform's local-LLM Smart Router (small local model, CPU-only, ≤8GB RAM) before any call reaches the cloud LLM. See §3.4.
> 2. **Embedding/ONNX service extraction** — `internal/embedding/` no longer calls a remote OpenAI-compatible HTTP endpoint directly for local inference; ONNX/local-model execution is moved out of the Go process into a standalone Rust sidecar service that supports multiple model formats and hot-swappable models via config, without exposing model-serving source to the Go codebase. See §3.5.
>
> **Amendment 2 (2026-07-11)**: All LLM-related processing — not just embeddings — moves into the Rust sidecar, which is renamed `llm-svc` to reflect the expanded scope: local embedding generation, reranking, NER/entity extraction (both ingestion-time and query-time), context compression, and answer generation (cloud passthrough included) all execute behind one Rust service. The Go backend (`m365-knowledge-graph/`) no longer makes any direct HTTP call to an LLM provider (local or cloud) — every LLM-shaped operation, regardless of `NLP_MODE`, goes through `llm-svc` over **gRPC** (not HTTP/REST as originally drafted). See §3.4 and §3.5 (rewritten).

**Input (user description)**:
> "Build an intelligent system capable of continuously learning from the company's internal data (stored on OneDrive and Teams) to answer questions and provide accurate, contextual information. The system uses a Knowledge Graph, NLP entity extraction, hybrid retrieval (graph + semantic), and a self-improving feedback loop."

*(Original Vietnamese, from spec_1.1.md): "Xây dựng một hệ thống thông minh có khả năng tự học hỏi từ dữ liệu nội bộ của công ty (lưu trữ trên OneDrive và Teams) để trả lời câu hỏi và cung cấp thông tin một cách chính xác, theo ngữ cảnh. Hệ thống sử dụng Knowledge Graph, NLP entity extraction, hybrid retrieval (graph + semantic), và self-improving feedback loop."*

---

## 1) Locked Decisions (from planning session)

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | Separate project (`m365-knowledge-graph/`) | Clean separation, independent deployment, shared patterns from RAD |
| Auth | Microsoft Entra ID SSO + Local JWT (demo) | Native M365 integration; JWT fallback for test/demo |
| LLM for NER | Custom API endpoint | Internal LLM server, OpenAI-compatible protocol |
| Graph DB | Neo4j | Purpose-built for graphs, complex queries, business-scale data |
| Sync strategy | Delta queries (MS Graph API) | Efficient, near-real-time, native incremental sync |
| POC scope | Single department | ~50 users, ~10K docs, ~500K messages |
| Data volume | 10K+ docs, 500K+ messages | Batched processing, robust pipeline design |
| Language | Go (backend) + React/TypeScript (frontend) | Same stack as RAD system for team familiarity |
| Database | **PostgreSQL** (metadata + embeddings) + Neo4j (graph) | RAD pattern: lightweight metadata store + dedicated graph store |
| Local LLM orchestration | Brain Platform Smart Router (small local model, e.g. Qwen3-8B-class, ≤8GB RAM, CPU-only) | Pre-processes/routes query planning, compression, and NER before cloud LLM call; cost + latency reduction, reuses REQ-023 pattern |
| All LLM processing (embedding, rerank, NER, compression, answer generation) | **Rust service** (`llm-svc`, `tonic` gRPC server + `ort`/GGUF/`candle`), **gRPC-only** from Go | Isolates all model-format and LLM-provider churn from the Go monolith; single service boundary for local models (ONNX/GGUF/safetensors) and cloud passthrough; Go never calls an LLM provider directly; model/provider swap via config, no Go redeploy; keeps model-serving internals out of the Go source tree |

---

## 2) Overview

The Enterprise Knowledge Graph is an intelligent system that ingests company data from Microsoft 365 (OneDrive + Teams), extracts business entities and their relationships via NLP, builds a graph-based knowledge base, and answers natural language questions with accurate, contextual, and permission-aware responses. The system improves over time through user feedback (like/dislike) and periodic re-evaluation of low-confidence knowledge.

**Pattern source**: The architecture borrows from the existing **RAD Knowledge Gateway** (`/workspace`) — specifically the ingestion orchestrator pattern, epoch-style atomic visibility, 7-stage retrieval pipeline, graph builder cycle, LLM runtime interface, and React frontend structure (TanStack Query + Zustand + Shadcn/ui). However, the data domain, graph model, and connectors are entirely new.

**POC scope**: 1 department (~50 users), ~10K docs, ~500K messages; batch processing with a robust pipeline design.

### Scope / Out of Scope

**In scope**
- Connect to M365 (OneDrive/SharePoint + Teams) via MS Graph API; incremental sync via delta query + changeToken persistence.
- Parse docx/xlsx/pptx/pdf/txt + chat messages into text chunks.
- NLP entity/relationship extraction via custom LLM API + confidence scoring.
- Build the graph in Neo4j (upsert/dedup) + query/traversal.
- Hybrid retrieval: semantic + graph expansion + rerank + context packing + answer generation with citations; permission filter as Stage 0.
- Feedback loop: like/dislike/flag; analytics; re-evaluate low-confidence edges; export fine-tuning pairs.
- Frontend dashboard (Q&A, entity browser, graph viz, feedback review, data sources, login, dashboard).

**Out of scope**
- Detailed infra/CI/CD rollout strategy or multi-department scaling beyond the stated POC scope.

---

## 3) Architecture (Decisions Summary)

| Dimension | RAD Knowledge Gateway (pattern source) | M365 Knowledge Graph (new system) | Rationale |
|---|---|---|---|
| **Primary Graph DB** | Neo4j (general-purpose graph) | Neo4j (business entity graph) | Same technology; new domain-specific schema (Person/Project/Technology/Customer/Department nodes and relationships) |
| **Metadata Storage** | SQLite (embedded file-based) | PostgreSQL (client-server) | RAD uses SQLite for simplicity (single-file deployment); M365 system needs server-scale metadata (10K+ docs, 500K+ messages) and concurrent writes; PostgreSQL required for production-ready multi-user support |
| **Vector Storage** | LanceDB (vector-only DB, separate from metadata) | PostgreSQL `chunk_embeddings` table (BYTEA, brute-force cosine) | RAD separates vectors for scale; M365 POC (~10K docs → ~500K chunks) fits in PostgreSQL with brute-force similarity search (no `pgvector` ANN index needed at this scale); simplifies deployment (one DB service instead of two) |
| **Authentication** | Multi-tenant Entra ID + JWT fallback | Multi-tenant Entra ID + JWT fallback | Identical pattern from RAD; reused for M365 SSO integration |
| **Ingestion Orchestrator** | Change-detector → epoch builder → validator → publisher (atomic visibility) | Delta sync coordinator (state machine: IDLE→SYNC_RUNNING→SYNC_COMPLETED/FAILED) | RAD's epoch pattern ensures consistent snapshots; M365 uses MS Graph delta queries with `change_token` persistence (naturally incremental, no epoch concept needed). Different coordination strategy, same atomicity goal: users never see partial/inconsistent ingestion state |
| **NLP/Embedding Processing** | Go backend calls HTTP to ONNX service (`ort-api`) directly | Unified Rust `llm-svc` (gRPC) — embedding, rerank, NER, compression, answer generation all routed through one service | RAD places embedding in a separate HTTP sidecar; M365 consolidates all LLM-shaped computation into one gRPC boundary (simpler Go codebase, single point of model-format/provider change, §3.5). RAD pattern: HTTP/REST; new: gRPC/protobuf (binary-efficient, streaming-capable, better for high-frequency calls). `llm-svc` also encapsulates the Brain Platform Smart Router (§3.4, NLP_MODE local/cloud routing). |
| **7-stage Retrieval Pipeline** | Intent → metadata filter → semantic search → graph expand → rerank → context pack → answer gen | **8-stage** (prepend permission filter at Stage 0 as cross-cutting concern) → intent → query NER → parallel graph + semantic → merge → rerank → context pack → answer gen | RAD's pattern extended to include permission filtering at the retrieval boundary (M365 INVARIANT-1: enforce per-result, never post-filter). Query NER (Stage 2) added to extract entity mentions before graph/semantic search. Stages 3–4 run concurrently (sync.WaitGroup) for latency. All LLM-touching stages (1, 2, 5, 6, 7) call `llm-svc` over gRPC, never directly. |
| **Permission Model** | Metadata filter on metadata; post-retrieval filtering | Permission-aware filtering at Stage 0 + per-result enforcement (INVARIANT-1) | RAD filters by repo/metadata scope; M365 enforces at retrieval time (M365 ACL cache per user↔file). Ingestion tags each chunk with file ACL; retrieval loads user's `permission_cache` entries and filters results (no out-of-scope content leaked). |
| **Feedback Loop** | Not explicitly modeled in RAD spec | 4-table schema: `query_logs`, `feedback_events`, `extraction_confidence`, `embedding_jobs` | New to M365 system. Uses user like/dislike signals to identify low-confidence edges, triggers periodic re-extraction via `improver.go`. |
| **Scheduling/Background Jobs** | Epoch building (periodic or on-demand) | Delta sync (periodic interval + manual trigger) + confidence re-evaluation | RAD uses epochs for consistency; M365 uses incremental sync (efficient at 500K+ messages) and feedback-driven re-evaluation. Both use scheduler pattern. |
| **Frontend Framework** | React 18 + TanStack Query + Zustand + Shadcn/ui | React 18 + TanStack Query + Zustand + Shadcn/ui | Identical stack reused. New pages: KnowledgeSearch (Q&A), EntityBrowser, BusinessGraph, FeedbackReview, DataSourcesPage — adapted from RAD's BrainChatPage, CodeGraph, similar patterns. |
| **Language** | Go backend + React frontend | Go backend + Rust service (`llm-svc`) + React frontend | RAD uses Go only; M365 adds Rust `llm-svc` for LLM processing isolation and performance (static binary, no Python/interpreter dependency, better cold-start for local models). |

**Reuse Summary**: Auth, router patterns, retrieval orchestration, graph builder lifecycle, feedback patterns, frontend stack all borrowed from RAD. Primary differences: M365 uses PostgreSQL (not SQLite), brute-force vector search (not LanceDB), gRPC `llm-svc` for all LLM ops (not separate HTTP sidecars), and permission filtering as a Stage 0 concern.

### 3.1 High-level Components

1. **Auth Layer**: Entra ID SSO (OIDC/OAuth2) + Local JWT fallback (demo).
2. **M365 Connectors**: MS Graph client + token mgmt + OneDrive ingestor + Teams ingestor + delta coordinator + permissions extraction/cache.
3. **Parsing Pipeline**: docx/xlsx/pptx/pdf/txt parsers + chunking.
4. **Metadata Store (PostgreSQL)**: sync state, file metadata, chunks, connection config, permission_cache, embeddings; plus feedback/query-log/confidence tables (Phase 4).
5. **NLP/Embedding**: entity extraction, embedding, and reranking are all thin Go clients over `internal/llmsvc/` (gRPC), see §3.5 — no LLM-shaped call is made directly from Go anymore.
6. **Knowledge Graph (Neo4j)**: build→validate→publish cycle; query patterns; traversal/stats.
7. **Hybrid Retrieval (8-stage)**: permission filter → intent → query NER → concurrent graph query + semantic search → merge/dedup → rerank → context pack → answer generation (LLM, citations). Every LLM-touching stage (1, 2, 5, 6, 7) calls `llm-svc` over gRPC (§3.5); `llm-svc` itself decides local vs. cloud per `NLP_MODE` (§3.4).
8. **Scheduler + WebSocket**: periodic delta sync; reevaluator; realtime progress updates.
9. **Frontend (React/TS)**: TanStack Query + Zustand + Shadcn/ui.
10. **Brain Orchestration Layer** (new, §3.4): local/cloud routing policy (`NLP_MODE`), implemented inside `llm-svc` and exposed to Go only via the gRPC contract.
11. **LLM Service** (new, §3.5, renamed from the original `embedding-svc` draft): standalone Rust gRPC service (`llm-svc`) hosting ONNX/GGUF/safetensors local models **and** proxying cloud LLM calls — the single point where any LLM-related computation happens. Go backend has zero direct LLM-provider dependencies.

### 3.2 End-to-end Data Flow

1. Admin configures an M365 connection (`/api/m365/connect`) → persisted to `m365_connections` (PostgreSQL).
2. Delta sync (scheduled or manual via `/api/m365/sync`) → Graph API delta query → updates `delta_state`, upserts `m365_files`, refreshes `permission_cache`.
3. Content download/parse → chunker → insert/update `chunks`.
4. NLP extraction over chunks → `internal/llmsvc` gRPC `ExtractEntities` call (routed local/cloud per `NLP_MODE` inside `llm-svc`) → entities/relationships + confidence → graph builder dedup/upsert into Neo4j; embeddings requested via gRPC `Embed` in batch and stored in `chunk_embeddings` for semantic search.
5. User query (`/api/knowledge/query`) → Stage 1 (`DetectIntent`) + Stage 2 (`ExtractEntities`, query mode) → gRPC calls to `llm-svc`, routed per `NLP_MODE` (§3.4) → runs the remaining 8-stage pipeline (permission-aware) → Stage 5 `Rerank` and Stage 6 `Compress` (if over budget) also via gRPC → Stage 7 `Generate` (answer, local or cloud per `NLP_MODE`) → answer + sources + entities.
6. User feedback (`/api/feedback`) → stored in `feedback_events`; analytics via `/api/feedback/stats`; reevaluator/improver periodically rescans low-confidence edges (re-extraction also goes through `llm-svc`'s `ExtractEntities`).

### 3.3 Key Architectural Constraints

- Neo4j is the primary graph store; PostgreSQL holds metadata, embeddings, and feedback.
- Incremental sync must use delta queries for efficiency at 10K+ docs / 500K+ messages.
- Permission filtering is a cross-cutting concern and Stage 0 of the retrieval pipeline; ingestion tags ACLs and caches the user↔file mapping.
- **All LLM-related processing — extraction, embedding, reranking, compression, answer generation — happens in `llm-svc` (Rust), never in the Go process.** The Go backend (`m365-knowledge-graph/`) holds no `LLM_API_BASE_URL`/`LLM_API_KEY` client code of its own after this amendment; those credentials are configured on `llm-svc`, which is the only process that talks to a cloud LLM provider or loads a local model.
- Local-vs-cloud LLM routing (`NLP_MODE`, §3.4) is a cross-cutting policy owned and enforced inside `llm-svc`; Go calls the same gRPC methods regardless of mode and never sees which path was taken except via response metadata (for logging/metrics).
- `llm-svc` (§3.5) is a separate deployable process from the Go backend, reached exclusively over **gRPC** (not HTTP) via `internal/llmsvc/client.go`. Existing Go interfaces (`internal/embedding/runtime.go`, `internal/retrieval/reranker.go`'s scorer interface, etc.) are preserved — only their default implementations become gRPC-client shims, so no caller-side code beyond the client swap changes.

---

### 3.4 Brain Integration — `NLP_MODE` Local/Cloud Routing Policy

**Goal**: route input/output pre-processing (query planning, context compression, NER, intent detection) — and, depending on mode, extraction/answer generation too — through a small local LLM before any request reaches the cloud LLM, reusing the Brain Platform (REQ-023) Smart Router pattern instead of re-implementing routing logic in this project.

**Rationale**: cloud LLM calls dominate cost and latency; planning/compression/NER tasks do not need frontier-model reasoning quality and can run on a small model on a single developer/ops laptop (no GPU required), consistent with the `/speckit-analyze` finding on REQ-023 (NFR-023-005: local RAM budget ≤8GB).

**Where the routing logic lives (revised)**: the `NLP_MODE` policy itself is implemented **inside `llm-svc`** (Rust, §3.5), not in the Go backend. Go's `internal/llmsvc/client.go` calls the same gRPC methods (`Embed`, `Rerank`, `ExtractEntities`, `Compress`, `Generate`) regardless of mode; `llm-svc` reads `NLP_MODE` and decides local-model vs. cloud-provider-passthrough per call. This keeps the mode switch a single-service concern and means the Go backend has no branch-by-mode logic to maintain.

**NLP/Embedding provider mode — a single runtime setting, not per-task hardcoding.**

| `NLP_MODE` | Behavior | `ExtractEntities` | `DetectIntent` / query `ExtractEntities` / `Compress` | `Generate` (answer) |
|---|---|---|---|---|
| `1` — `cloud_only` | Everything is proxied by `llm-svc` to the cloud LLM (`LLM_API_BASE_URL`); `llm-svc`'s local model is not loaded. `Embed`/`Rerank` still run locally in `llm-svc` (ONNX) since these were never cloud calls in the pattern-source RAD system either. | cloud (proxied) | cloud (proxied) | cloud (proxied) |
| `2` — `cloud_with_local_preprocess` (default) | Pre-processing RPCs (`DetectIntent`, query-time `ExtractEntities`, `Compress`) run on `llm-svc`'s local model; `ExtractEntities` (ingestion) and `Generate` (answer) are proxied to cloud. This mode must not depend on an Ollama server — the local model is served in-process by `llm-svc` (GGUF/ONNX, §3.5), never by shelling out to `ollama serve`. | cloud (proxied) | **local** (fallback to cloud proxy on failure) | cloud (proxied) |
| `3` — `local_only` | All RPCs resolve locally inside `llm-svc`; no outbound call to a cloud LLM provider is made anywhere in the system. Intended for offline/air-gapped or cost-zero POC runs; answer quality is expected to be lower than mode 1/2 and is explicitly out of the accuracy SLO for this POC. | local | local | local |

- **Go side reuses the RAD pattern, adapted**: `internal/brain/router_client.go` mirrors the shape of `src/Backend/internal/llm/smart_router.go` and `smart_router_onnx.go` (provider selection, fallback chain) — **copy those two files as the starting point**, then strip the actual model-loading code (that part moves to Rust, §3.5) and replace it with gRPC calls into `internal/llmsvc/client.go`. `internal/brain/router_client.go` becomes a thin typed wrapper (`Extract(ctx, task, ...)`) over the generated gRPC client; it does not itself decide local vs. cloud (that's `llm-svc`'s job per the table above) — it only tags each call with a task-type enum so `llm-svc`'s server-side policy can classify it correctly.
- **No Ollama dependency, by design**: mode 2/3's local inference is served in-process by `llm-svc` (Rust, §3.5) — not through an Ollama server process. This avoids a second local-model runtime and keeps local-inference footprint within the ≤8GB RAM budget.
- Retry/fallback: exponential backoff (3 attempts, base 1s) on local-model failure in mode 2, then `llm-svc` falls back to its cloud proxy path for that call (fail-open, not fail-closed, to avoid blocking Q&A availability) — this fallback is implemented inside `llm-svc`, not in Go. Mode 3 has no cloud fallback by definition (fail-closed — `llm-svc` returns a gRPC error rather than silently calling the cloud LLM).
- Hardware constraint (inherited from REQ-023 NFR-023-005, made concrete here per the `/speckit-analyze` gap finding): local model ≤8GB RAM total (weights + KV cache), CPU-only, runs on a standard notebook/laptop — no GPU dependency assumed for POC deployment. This constraint applies to modes 2 and 3, and is a constraint on `llm-svc`'s process, not the Go backend's.

**New config** (read by `llm-svc`; Go only needs `LLMSVC_ADDR`, see §3.5)

| Variable | Purpose | Default |
|---|---|---|
| `NLP_MODE` | `1` (cloud_only) \| `2` (cloud_with_local_preprocess) \| `3` (local_only) — see mode table above; read by `llm-svc` at startup | `2` |
| `BRAIN_LOCAL_PROVIDER` | Local model identifier used for pre-processing/generation inside `llm-svc` (modes 2/3) | `qwen3-8b-q4` |
| `BRAIN_FALLBACK_TO_CLOUD` | Mode 2 only: fall back to cloud LLM proxy on local-model failure (ignored in modes 1/3) | `true` |

**Open item**: whether NLP extraction (Phase 2, ingestion-time entity/relationship extraction) is routed local in mode 3 only, or should also be an independently configurable dimension, is deferred — see Open Question 6 below; extraction accuracy requirements may not tolerate a small local model even in cost-sensitive deployments.

### 3.5 `llm-svc` — Unified Rust gRPC Service for All LLM Processing

**Goal**: move **all** LLM-shaped computation — embedding, reranking, entity/relationship extraction (NER), context compression, and answer generation, for both local models and cloud-provider passthrough — out of the Go backend into a standalone Rust gRPC service, `llm-svc`. The Go backend never calls an LLM provider (local or cloud) directly; it only calls `llm-svc` over gRPC. This supersedes the original `embedding-svc` draft (§3.5, prior revision), which covered embeddings only.

**Why gRPC, not HTTP/REST** (per team decision): this boundary is called on every ingestion batch and every Q&A query — a typed, streaming-capable, binary-efficient contract (protobuf + HTTP/2) fits better than hand-rolled JSON/HTTP for a high-frequency internal service boundary, and gives Go and Rust a single `.proto` source of truth for the contract instead of two independently-maintained JSON schemas.

**Why Rust** (per team decision, unchanged from prior revision): `tonic` (gRPC) + `ort` crate (ONNX Runtime bindings) gives a single static binary with no interpreter dependency, good cold-start/latency characteristics, and — same rationale as REQ-023's plugin-boundary requirement — compiles to a binary that does not expose model-serving source alongside the main Go codebase.

**Reuse from the RAD pattern source (`src/Backend/`) — port, don't rewrite from scratch**: `src/Backend/internal/llm/` already has working Go implementations of the exact model-serving logic `llm-svc` needs, and `src/Backend/internal/retriever/` already has the reranker equivalent. These are the reference implementations to port to Rust (algorithms/behavior, not verbatim code):
  - `src/Backend/internal/llm/onnx.go`, `onnx_embedder.go`, `onnx_embedder_stub.go` → basis for `llm-svc/src/models/onnx.rs`'s embedding path.
  - `src/Backend/internal/llm/onnx_planner.go`, `onnx_planner_stub.go` → basis for the local-model `Generate`/planning path used in `NLP_MODE=2`/`3`.
  - `src/Backend/internal/llm/smart_router.go`, `smart_router_onnx.go`, `fallback.go` → basis for `llm-svc`'s internal `NLP_MODE` routing + fallback state machine (§3.4).
  - `src/Backend/internal/llm/qwen_tokenizer.go`, `spm_tokenizer.go`, `tokenizer.go` → basis for tokenization in the Rust GGUF/local-model path (or replace with a Rust tokenizer crate if a direct port isn't practical — evaluate during implementation).
  - `src/Backend/internal/retriever/bert_reranker.go`, `reranker_onnx.go`, `reranker_onnx_session.go` → basis for `llm-svc`'s `Rerank` RPC implementation.
  - `src/Backend/internal/llm/anthropic.go`, `openai.go`, `ollama.go` (as **reference for the request/response shape only** — the Ollama dependency itself is explicitly excluded, per §3.4's no-Ollama constraint) → basis for `llm-svc`'s cloud-proxy client used in `NLP_MODE=1`/`2`'s cloud-routed calls.

**Design**
- New top-level service directory: `llm-svc/` (Rust, separate `Cargo.toml`, separate deployable artifact/container from `m365-knowledge-graph/`).
- gRPC contract: `proto/llmsvc.proto`, shared (copied, not symlinked, to keep independent versioning) into both `llm-svc/proto/` and `src/m365-knowledge-graph/proto/`. Services/RPCs:
  ```protobuf
  service LlmSvc {
    rpc Embed(EmbedRequest) returns (EmbedResponse);
    rpc Rerank(RerankRequest) returns (RerankResponse);
    rpc ExtractEntities(ExtractRequest) returns (ExtractResponse);   // NER: both ingestion-time and query-time
    rpc Compress(CompressRequest) returns (CompressResponse);        // Stage 6 map-reduce compression
    rpc DetectIntent(IntentRequest) returns (IntentResponse);        // Stage 1
    rpc Generate(GenerateRequest) returns (GenerateResponse);        // Stage 7 answer generation (local or cloud)
    rpc Health(HealthRequest) returns (HealthResponse);
    rpc ListModels(ListModelsRequest) returns (ListModelsResponse);
  }
  ```
- Formats supported for local models: `.onnx` (via `ort`), `.gguf` (via a llama.cpp-compatible Rust binding, e.g. `llama-cpp-2`), `.safetensors` (via `candle` or equivalent) — model format is a per-model config field (`models.yaml`), not a compile-time choice, so operators can add/swap models without a Rust rebuild in the common case.
- **No Ollama in this service**: `llm-svc` loads and serves local models in-process via native Rust bindings — it does not shell out to or depend on an Ollama daemon (§3.4).
- Cloud proxy: `llm-svc` holds `LLM_API_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` (moved from Go, see config migration below) and is the only process in the system that makes an outbound call to the cloud LLM provider.
- Go-side change: `internal/embedding/custom_api.go` and `internal/nlp/extractor.go`'s direct HTTP client, `internal/retrieval/reranker.go`'s scoring call, and `internal/retrieval/answer_generator.go`'s LLM call are all replaced by calls through one generated gRPC client, `internal/llmsvc/client.go` (built from `proto/llmsvc.proto` via `protoc-gen-go-grpc`). Existing Go interfaces (`internal/embedding/runtime.go`'s `EmbeddingRuntime`, the reranker's scorer interface) are preserved as thin wrappers over this one client, so callers (`internal/retrieval/semantic_search.go`, `internal/embedding/batch.go`, `internal/graph/builder.go`'s NLP call site) need only a constructor swap, not a call-site rewrite.
- Model hot-swap: `llm-svc` watches `models.yaml` (`{name, format, path, dims, kind: embedding|generative}`); changing the active model for a logical name is a config + service restart, not a Go code change or Go redeploy.

**New config**

| Variable | Purpose | Default | Read by |
|---|---|---|---|
| `LLMSVC_ADDR` | `llm-svc` gRPC address | `localhost:9090` | Go (`internal/llmsvc/client.go`) |
| `LLMSVC_TLS` | Enable TLS on the gRPC channel (mTLS optional for prod; plaintext acceptable for same-host POC) | `false` | Go + `llm-svc` |
| `LLM_API_BASE_URL` | Cloud LLM endpoint (moved: now read by `llm-svc`, not Go) | `https://mkp-api.fptcloud.com/v1` | `llm-svc` |
| `LLM_API_KEY` | Cloud LLM API key (moved: now read by `llm-svc`, not Go) | (optional) | `llm-svc` |
| `LLM_MODEL` | Cloud model name for completions (moved: now read by `llm-svc`) | `gpt-4o-mini` | `llm-svc` |
| `LLM_EMBED_MODEL` | Default embedding model name, seeded into `llm-svc`'s `models.yaml` at first deploy | `text-embedding-3-small` | `llm-svc` |

**Migration note**: `LLM_API_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`/`LLM_EMBED_MODEL` move from the Go backend's config (§12) to `llm-svc`'s config — the Go backend's `internal/config/` no longer needs to read or validate them; it only needs `LLMSVC_ADDR`. Deployment must supply these to the `llm-svc` process/container, not the Go one.

**Frontend/backend reuse note (per team direction)**: where `src/Backend/`'s existing HTTP handlers or `src/Frontend/`'s existing pages already implement the same shape of endpoint/screen this spec calls for (e.g. `src/Frontend/src/pages/BrainChatPage.tsx`, `DataSourcesPage.tsx`, `EntityBrowserPage.tsx`, `FeedbackReviewPage.tsx`, `GraphPage.tsx`, `LoginPage.tsx`, `DashboardPage.tsx` closely match §4.2/§9's planned pages by name and purpose), the implementation should **copy the existing file as a starting point and edit it to match this spec's API contract and data model** (different endpoints, different entity/graph schema, M365-specific auth), rather than writing each page from a blank file. This applies to `internal/llm/` and `internal/retriever/`'s reranker/ONNX code as described above, and should be applied opportunistically to any other close match found in `src/Backend/`/`src/Frontend/` during implementation — not an exhaustive list.

**Explicitly out of scope for this amendment**: the M365 connector/parser/graph/permission logic is unaffected — only LLM-shaped computation (embedding, rerank, NER, compression, generation) moves into `llm-svc`.

---

## 4) Approach

### 4.1 Backend Project Structure

```
m365-knowledge-graph/
├── cmd/server/main.go              # Entry point, DI, startup
├── internal/
│   ├── api/                        # HTTP handlers, router, middleware
│   │   ├── router.go              # Route registration
│   │   ├── middleware.go          # CORS, auth, logging
│   │   ├── handlers_m365.go       # M365 connection endpoints
│   │   ├── handlers_knowledge.go  # Q&A endpoints
│   │   ├── handlers_entities.go   # Entity browser endpoints
│   │   ├── handlers_feedback.go   # Feedback endpoints
│   │   └── handlers_graph.go      # Graph visualization endpoints
│   │
│   ├── auth/                       # Authentication
│   │   ├── entra_id.go            # Microsoft Entra ID SSO (OAuth2/OIDC)
│   │   └── jwt.go                 # Local JWT fallback (demo mode)
│   │
│   ├── connectors/                 # Microsoft 365 connectors
│   │   ├── client.go              # MS Graph API client (HTTP + retry)
│   │   ├── auth.go                # OAuth2 token management (client credentials + delegated)
│   │   ├── onedrive.go            # OneDrive/SharePoint file ingestion
│   │   ├── teams.go               # Teams chat/channel/message ingestion
│   │   ├── delta.go               # Delta query coordinator (incremental sync)
│   │   └── permissions.go         # M365 permission extraction and caching
│   │
│   ├── parsers/                    # Document parsers
│   │   ├── docx.go                # Word document parser
│   │   ├── xlsx.go                # Excel spreadsheet parser
│   │   ├── pptx.go                # PowerPoint parser
│   │   ├── pdf.go                 # PDF text extraction
│   │   └── text.go                # Plain text chunker
│   │
│   ├── nlp/                        # NLP entity extraction
│   │   ├── extractor.go           # LLM-based entity + relationship extraction
│   │   ├── prompt.go              # Extraction prompts for custom LLM
│   │   ├── types.go               # Entity/relationship types
│   │   └── confidence.go          # Confidence scoring per extraction
│   │
│   ├── graph/                      # Business knowledge graph
│   │   ├── types.go               # GraphNode/GraphEdge for business domain
│   │   ├── builder.go             # GraphBuilder (build→validate→publish)
│   │   ├── neo4j_store.go         # Neo4j storage backend
│   │   ├── neo4j_query.go         # Cypher query patterns
│   │   ├── traversal.go           # Graph traversal utilities
│   │   └── stats.go               # Graph statistics
│   │
│   ├── retrieval/                  # Hybrid retrieval pipeline
│   │   ├── retriever.go           # Main retrieval orchestrator
│   │   ├── intent_detector.go     # Enterprise intent detection
│   │   ├── permission_filter.go   # Permission-aware filtering (Stage 0)
│   │   ├── semantic_search.go     # Vector/neural search
│   │   ├── graph_expander.go      # Graph-based expansion
│   │   ├── reranker.go            # Result reranking (thin client over internal/llmsvc)
│   │   ├── context_packer.go      # Token-aware context assembly + Stage 6 Compress via internal/llmsvc
│   │   └── answer_generator.go    # Stage 7 answer generation via internal/llmsvc (no direct LLM HTTP call)
│   │
│   ├── embedding/                  # Embedding generation (client-side only; inference lives in llm-svc, see §3.5)
│   │   ├── runtime.go             # Embedding runtime interface (unchanged)
│   │   ├── svc_client.go          # Thin EmbeddingRuntime wrapper over internal/llmsvc.Client (replaces custom_api.go)
│   │   ├── batch.go               # Batch embedding (worker pool, calls internal/llmsvc)
│   │   └── store.go               # Embedding storage (PostgreSQL: embedding_models/chunk_embeddings/embedding_jobs)
│   │
│   ├── llmsvc/                      # gRPC client for llm-svc (§3.5) — the ONLY LLM-provider touchpoint in Go
│   │   ├── client.go               # Generated-client wrapper: Embed/Rerank/ExtractEntities/Compress/DetectIntent/Generate
│   │   └── llmsvc.pb.go            # Generated from proto/llmsvc.proto (protoc-gen-go-grpc)
│   │
│   ├── brain/                       # NLP_MODE task-tagging wrapper (§3.4) — routing itself lives in llm-svc
│   │   └── router_client.go        # Tags calls with task-type enum, delegates to internal/llmsvc.Client
│   │
│   ├── feedback/                   # Self-improvement loop
│   │   ├── store.go               # Feedback collection (PostgreSQL)
│   │   ├── analyzer.go            # Feedback analytics and trends
│   │   ├── improver.go            # Self-improvement engine
│   │   └── exporter.go            # Fine-tuning data export
│   │
│   ├── metadata/                   # PostgreSQL metadata store
│   │   ├── db.go                  # DB interface
│   │   ├── schema.go              # Schema and migrations
│   │   └── query.go               # Query implementations
│   │
│   ├── scheduler/                  # Background jobs
│   │   ├── delta_sync.go          # Periodic delta sync jobs
│   │   └── reevaluator.go         # Periodic confidence re-evaluation
│   │
│   ├── websocket/                  # Real-time updates
│   │   └── hub.go                 # WebSocket hub (sync progress, etc.)
│   │
│   └── common/                     # Shared utilities
│       ├── config.go              # Configuration and validation
│       ├── logger.go              # Structured logging
│       └── errors.go              # Error types and wrapping
│
├── pkg/types/                      # Public shared types
│   ├── entity.go                  # Business entity types
│   ├── graph.go                   # Graph node/edge types
│   ├── retrieval.go               # Retrieval and answer types
│   └── feedback.go                # Feedback types
├── go.mod
├── migrations/                     # PostgreSQL migrations
├── proto/
│   └── llmsvc.proto                # gRPC contract, copied from llm-svc/proto/ (§3.5)
├── scripts/                        # Build and utility scripts
└── tests/                          # Integration tests
    └── integration/
        ├── m365_mock.go           # Mock MS Graph API
        └── retrieval_test.go      # End-to-end retrieval tests

llm-svc/                            # Rust gRPC service (§3.5) — separate deployable, own Cargo.toml
├── Cargo.toml
├── proto/
│   └── llmsvc.proto                # gRPC contract (source of truth)
├── src/
│   ├── main.rs                    # tonic gRPC server bootstrap
│   ├── service.rs                 # LlmSvc trait impl: Embed/Rerank/ExtractEntities/Compress/DetectIntent/Generate/Health/ListModels
│   ├── routing.rs                 # NLP_MODE policy (local vs. cloud-proxy per call), fallback state machine (§3.4)
│   ├── models/
│   │   ├── onnx.rs                # ort-based ONNX inference (embedding + rerank)
│   │   ├── gguf.rs                # llama.cpp-compatible binding (GGUF, local generative model)
│   │   └── safetensors.rs         # candle-based safetensors inference
│   ├── cloud_proxy.rs             # Cloud LLM client (OpenAI-compatible), holds LLM_API_BASE_URL/LLM_API_KEY/LLM_MODEL
│   └── config.rs                  # models.yaml loader + hot-reload + env config
└── models.yaml                    # {name, format, path, dims, kind} per logical model
```

### 4.2 Frontend Project Structure

```
Frontend/
├── src/
│   ├── api/
│   │   ├── client.ts             # Axios client
│   │   ├── knowledge.ts          # Knowledge Q&A endpoints
│   │   ├── entities.ts           # Entity browser endpoints
│   │   └── feedback.ts           # Feedback endpoints
│   ├── components/
│   │   └── ui/                   # Reusable UI components
│   ├── hooks/
│   │   ├── useKnowledgeQuery.ts  # Knowledge query hook
│   │   ├── useEntities.ts        # Entity list hook
│   │   ├── useFeedback.ts        # Feedback hook
│   │   └── useWebSocket.ts       # Real-time sync updates
│   ├── pages/
│   │   ├── KnowledgeSearch.tsx   # Main Q&A interface
│   │   ├── EntityBrowser.tsx     # Browse entities by type
│   │   ├── BusinessGraph.tsx     # Graph visualization
│   │   ├── FeedbackReview.tsx    # Review flagged answers
│   │   ├── DataSourcesPage.tsx   # Configure M365 connections
│   │   ├── LoginPage.tsx         # Entra ID / JWT login
│   │   └── DashboardPage.tsx     # Overview dashboard
│   ├── store/
│   │   └── useUIStore.ts         # Zustand UI state
│   ├── i18n/                     # Internationalization (en, vi)
│   └── types/                    # TypeScript types
├── package.json
└── vite.config.ts
```

---

## 5) Phase 1: Foundation — Auth, M365 Connectors, Document Parsers

**Goal**: Connect to Microsoft 365, ingest documents, and parse them into text chunks.

**Packages**: `internal/auth/`, `internal/connectors/`, `internal/parsers/`, `internal/metadata/`

**Key files**
- `internal/auth/entra_id.go` — OIDC flow with Entra ID: discovery, token exchange, refresh
- `internal/auth/jwt.go` — Local JWT fallback for demo mode
- `internal/connectors/client.go` — MS Graph HTTP client with retry, pagination, rate limiting
- `internal/connectors/auth.go` — OAuth2 token management (service principal + delegated tokens)
- `internal/connectors/onedrive.go` — enumerate sites → drives → files; download content; extract permissions
- `internal/connectors/teams.go` — enumerate groups → channels → messages; extract chat content
- `internal/connectors/delta.go` — delta query coordinator with changeToken persistence
- `internal/connectors/permissions.go` — extract and cache user/file permission mapping
- `internal/parsers/docx.go` — DOCX parser (zip → XML → text + structure)
- `internal/parsers/xlsx.go` — XLSX parser (extract cell data + sheet structure)
- `internal/parsers/pptx.go` — PPTX parser (extract slide text + speaker notes)
- `internal/parsers/pdf.go` — PDF text extraction
- `internal/parsers/text.go` — Plain text chunker (fixed-size with overlap)
- `internal/metadata/schema.go` — PostgreSQL tables for sync state, file metadata, permissions

### PostgreSQL schema (Phase 1)

```sql
-- Sync state for delta queries
CREATE TABLE delta_state (
    source TEXT PRIMARY KEY,  -- 'onedrive:/site/drive' or 'teams:/group/channel'
    change_token TEXT NOT NULL,
    has_more BOOLEAN NOT NULL DEFAULT FALSE,
    last_sync_at TIMESTAMPTZ NOT NULL
);

-- Imported file/document metadata
CREATE TABLE m365_files (
    id SERIAL PRIMARY KEY,
    source_type TEXT NOT NULL,  -- 'onedrive' or 'teams'
    source_id TEXT NOT NULL,    -- OneDrive item ID or Teams message ID
    file_name TEXT NOT NULL,
    file_type TEXT,             -- 'docx', 'xlsx', 'pptx', 'pdf', 'txt', 'chat_message'
    file_size INTEGER,
    content_hash TEXT,
    last_modified TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    permissions_json JSONB      -- ACL entries
);

-- Parsed text chunks
CREATE TABLE chunks (
    id SERIAL PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES m365_files(id),
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    heading_path TEXT,          -- for docx/pptx: outline hierarchy
    UNIQUE(file_id, chunk_index)
);

-- MS 365 connection configuration
CREATE TABLE m365_connections (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,         -- 'onedrive' or 'teams'
    tenant_id TEXT NOT NULL,
    config_json JSONB NOT NULL, -- site_id, group_id, etc.
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permission cache: user_id ↔ file_id access
CREATE TABLE permission_cache (
    user_id TEXT NOT NULL,
    file_id INTEGER NOT NULL REFERENCES m365_files(id),
    permission TEXT NOT NULL,   -- 'read', 'write', 'owner'
    PRIMARY KEY (user_id, file_id)
);
```

**Patterns borrowed from RAD system**
- `internal/ingestion/ingestion.go` → orchestrator pattern for connect→enumerate→parse
- `internal/ingestion/file_walker.go` → enumeration pattern adapted for Graph API pagination
- `internal/ingestion/parsers/` → parser interface pattern
- `internal/common/config.go` → configuration validation at startup
- `internal/auth/` → JWT middleware pattern (adapted for OIDC)

---

## 6) Phase 2: NLP Entity Extraction + Knowledge Graph (Neo4j)

**Goal**: Extract business entities and relationships from text chunks; store in Neo4j.

**Packages**: `internal/nlp/`, `internal/graph/`, `internal/embedding/`

**Key files**
- `internal/nlp/types.go` — Entity types (Person, Project, Document, Technology, Customer, Department, Date, Amount) and relationship types
- `internal/nlp/extractor.go` — calls `internal/llmsvc.Client.ExtractEntities` (gRPC); no direct LLM HTTP client remains here after this amendment
- `internal/nlp/prompt.go` — Extraction prompt templates, sent as part of the `ExtractEntities` gRPC request (prompt assembly stays in Go; execution moves to `llm-svc`)
- `internal/nlp/confidence.go` — Confidence scoring (0.0–1.0) per extracted entity/relationship
- `internal/graph/types.go` — GraphNode/GraphEdge for business domain
- `internal/graph/builder.go` — Batch: ingest NLP results → deduplicate → upsert to Neo4j
- `internal/graph/neo4j_store.go` — Neo4j client, Cypher upserts, connection pool
- `internal/graph/neo4j_query.go` — Cypher query patterns (find entity, find paths, find neighbors)
- `internal/graph/traversal.go` — BFS/DFS traversal with depth limit
- `internal/graph/stats.go` — Graph statistics (node/edge counts, degree distribution)
- `internal/embedding/runtime.go` — Embedding interface (unchanged)
- `internal/embedding/svc_client.go` — Thin `EmbeddingRuntime` wrapper over `internal/llmsvc.Client.Embed` (gRPC); replaces the former direct-to-public-API `custom_api.go`
- `internal/llmsvc/client.go` — Generated gRPC client wrapper for `llm-svc` (§3.5): `Embed`, `Rerank`, `ExtractEntities`, `Compress`, `DetectIntent`, `Generate`
- `internal/embedding/batch.go` — Batch embedding worker (up to 100 texts/batch), calls `internal/llmsvc.Client.Embed`
- `internal/brain/router_client.go` — Task-type tagging wrapper (§3.4) over `internal/llmsvc.Client`; used by `internal/nlp/extractor.go` (ingestion-time extraction, mode-dependent per §3.4's table), `internal/retrieval/intent_detector.go`, and query-NER in Phase 3

**NLP extraction flow**
```
TextChunk → internal/llmsvc.Client.ExtractEntities (gRPC → llm-svc, local or cloud per NLP_MODE) → {
  entities: [{ type: "Person", name: "...", confidence: 0.92 }],
  relationships: [{ from: "Person:...", to: "Project:...", type: "works_on", confidence: 0.87 }]
}
```

### Neo4j schema
```cypher
// Node labels
(:Person {email: "...", displayName: "...", department: "..."})
(:Project {name: "...", status: "...", description: "..."})
(:Document {fileName: "...", sourceType: "onedrive", sourceId: "..."})
(:Technology {name: "..."})
(:Customer {name: "..."})
(:Department {name: "..."})
(:Chunk {chunkId: ..., fileHash: "..."})

// Relationships
(:Person)-[:MANAGES]->(:Project)
(:Person)-[:WORKS_ON]->(:Project)
(:Person)-[:BELONGS_TO]->(:Department)
(:Document)-[:MENTIONS]->(:Person|Project|Technology|Customer)
(:Document)-[:CREATED_BY]->(:Person)
(:Project)-[:USES]->(:Technology)
(:Project)-[:SERVING]->(:Customer)
(:Chunk)-[:PART_OF]->(:Document)
(:Chunk)-[:MENTIONS]->(:Person|Project|Technology|Customer)

// Indices
CREATE INDEX FOR (n:Person) ON (n.email)
CREATE INDEX FOR (n:Person) ON (n.displayName)
CREATE INDEX FOR (n:Project) ON (n.name)
CREATE INDEX FOR (n:Document) ON (n.fileName)
CREATE INDEX FOR (n:Technology) ON (n.name)
CREATE INDEX FOR (n:Customer) ON (n.name)
CREATE INDEX FOR (n:Department) ON (n.name)
```

### PostgreSQL embedding schema (Phase 2)

`internal/embedding/store.go` persists vectors in PostgreSQL, keyed by chunk and embedding model version so re-embedding on model change is possible:

```sql
-- Tracks which embedding model/version produced which vectors
CREATE TABLE embedding_models (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '',
    dims INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);

-- One embedding per chunk per model
CREATE TABLE chunk_embeddings (
    id SERIAL PRIMARY KEY,
    chunk_id INTEGER NOT NULL REFERENCES chunks(id),
    model_id INTEGER NOT NULL REFERENCES embedding_models(id),
    embedding BYTEA NOT NULL,       -- serialized float32 array; use pgvector's `vector` type instead if ANN search is needed
    embedding_hash TEXT,             -- optional, for dedupe/integrity
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chunk_id, model_id)
);
CREATE INDEX idx_chunk_embeddings_chunk ON chunk_embeddings(chunk_id);
CREATE INDEX idx_chunk_embeddings_model ON chunk_embeddings(model_id);

-- Batch embedding job tracking (backfill / re-embedding)
CREATE TABLE embedding_jobs (
    id SERIAL PRIMARY KEY,
    status TEXT NOT NULL,            -- 'queued' | 'running' | 'succeeded' | 'failed'
    model_id INTEGER NOT NULL REFERENCES embedding_models(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT
);
```

**Patterns borrowed from RAD system**
- GraphNode/GraphEdge struct patterns, build→validate→publish cycle, traversal patterns
- LLM runtime interface patterns (for extraction calls)
- Confidence scoring patterns

---

## 7) Phase 3: Hybrid Retrieval Pipeline + Q&A

**Goal**: Answer natural language questions using graph search + semantic retrieval.

**Packages**: `internal/retrieval/`

**Key files**
- `retriever.go` — Main orchestrator: 8-stage pipeline
- `intent_detector.go` — Enterprise intents (find_expert, find_document, find_project_info, find_technology_usage, general_question); Stage 1 calls `internal/llmsvc.Client.DetectIntent` (gRPC → `llm-svc`, §3.5)
- `permission_filter.go` — Filter results by user's M365 permissions
- `semantic_search.go` — Embed query (`internal/llmsvc.Client.Embed`) → search similar text chunks
- `graph_expander.go` — Expand found entities to related entities (BFS, depth 1–2)
- `reranker.go` — Rerank combined results via `internal/llmsvc.Client.Rerank` (gRPC)
- `context_packer.go` — Token-aware context assembly; calls `internal/llmsvc.Client.Compress` (Stage 6) when packed context exceeds budget
- `answer_generator.go` — Answer generation with source citations via `internal/llmsvc.Client.Generate` (gRPC, local or cloud per `NLP_MODE`) — no direct LLM HTTP client remains in this file

### Retrieval pipeline (8 stages)
```
User Query
  ↓
Stage 0: Permission Filter     — load user's M365 access scope
  ↓
Stage 1: Intent Detection      — classify intent (find_expert, find_document, etc.)
  ↓
Stage 2: Entity Recognition    — extract entity mentions from query (NER)
  ↓
Stage 3 + 4 (concurrent):
  ├─ Neo4j Graph Query    — traverse graph from recognized entities
  └─ Semantic Search      — embed query → find similar chunks
  ↓
  → Merge, deduplicate by entity ID
  ↓
Stage 5: Rerank              — score by relevance + graph proximity + confidence
  ↓
Stage 6: Context Packing     — token-budget-aware assembly (default 12K tokens)
  ↓
Stage 7: Answer Generation   — LLM generates answer with citations
  ↓
→ { answer: "...", sources: [...], entities: [...] }
```

**Patterns borrowed from RAD system**
- 7-stage pipeline pattern → extended to 8 stages by adding permission filter
- Intent classification, vector search, graph expansion, reranking with confidence, token-aware context packing, source hydration

---

## 8) Phase 4: Self-Improvement Feedback Loop

**Goal**: Collect feedback, analyze trends, re-evaluate low-confidence edges.

**Packages**: `internal/feedback/`

**Key files**
- `store.go` — PostgreSQL-backed feedback storage
- `analyzer.go` — Analytics: trending answers, low-confidence hotspots
- `improver.go` — Periodic: re-scan low-confidence edges → re-extract with LLM
- `exporter.go` — Export conversation pairs for fine-tuning

### PostgreSQL additions (Phase 4)
```sql
-- Query history for analytics (created first: feedback_events references it)
CREATE TABLE query_logs (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    query_text TEXT NOT NULL,
    intent TEXT,
    results_count INTEGER,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User feedback on answers
CREATE TABLE feedback_events (
    id SERIAL PRIMARY KEY,
    query_id INTEGER NOT NULL REFERENCES query_logs(id),
    user_id TEXT NOT NULL,
    feedback_type TEXT NOT NULL,  -- 'like', 'dislike', 'flag'
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-edge confidence tracking
CREATE TABLE extraction_confidence (
    id SERIAL PRIMARY KEY,
    entity_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    confidence REAL NOT NULL,
    feedback_score REAL,          -- derived from feedback
    last_reevaluated TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

*Note: `feedback_events.query_id` is now `INTEGER REFERENCES query_logs(id)` — the earlier drafts declared it `TEXT` with no FK against `query_logs.id` (an `INTEGER`), a type mismatch flagged in `review_1.2.md`. Fixed here as part of converting to valid PostgreSQL DDL.*

**Patterns borrowed from RAD system**
- Confidence scoring patterns
- Periodic job pattern for re-evaluation
- Metrics collection patterns

---

## 9) Phase 5: Frontend — Enterprise Knowledge Dashboard

**Goal**: React frontend with Q&A, entity browser, graph visualization, feedback, and admin.

**Key pages**
- `KnowledgeSearch.tsx` — Natural language Q&A with chat interface, source citations, feedback buttons
- `EntityBrowser.tsx` — Filterable list of entities by type (person, project, document, etc.), detail view with relationships
- `BusinessGraph.tsx` — Interactive graph visualization (React Flow / D3.js), filter by entity type, clickable nodes
- `FeedbackReview.tsx` — Admin interface to review flagged answers, adjust confidence scores
- `DataSourcesPage.tsx` — Configure M365 connections, view sync status, trigger manual sync
- `LoginPage.tsx` — Entra ID login + local JWT fallback
- `DashboardPage.tsx` — Overview: recent queries, sync status, graph stats, feedback trends *(depends on Phase 4's `/api/feedback/stats` — not listed as a dependency in the Phases Summary table; see §17 note)*

**Patterns borrowed from RAD frontend**
- Axios client with interceptors, WebSocket hook, chat UI, graph visualization, Zustand state, TanStack Query hooks, i18n (en/vi), Shadcn/ui components

---

## 10) Phase 6: Permission-Aware Retrieval (refinement)

**Goal**: Ensure every retrieval respects M365 permissions. This is refined into a continuous concern, with full implementation in Phase 3.

- Permission filtering is Stage 0 of the retrieval pipeline
- At ingestion time, each document is tagged with its M365 ACL entries
- The retrieval pipeline filters results by the authenticated user's cached permissions
- `internal/connectors/permissions.go` handles ACL extraction and cache refresh

*Note: this phase's deliverables substantially overlap Phase 3 and Phase 1's `permissions.go` — carried over unchanged from all source drafts; `review_1.2.md` recommends folding this into Phase 3.*

---

## 11) MS Graph API Scopes

| Scope | Purpose | Type |
|---|---|---|
| `Sites.Read.All` | Read SharePoint sites | App permission |
| `Files.Read.All` | Read OneDrive/SharePoint files | App permission |
| `Chat.Read.All` | Read Teams 1:1 chats | App permission |
| `ChannelMessage.Read.All` | Read Teams channel messages | App permission |
| `Group.Read.All` | Read Teams/group membership | App permission |
| `People.Read` | Read user profiles | Delegation (for SSO) |
| `User.Read` | Read own profile | Delegation |

---

## 12) Configuration

Key environment variables:

| Variable | Purpose | Default |
|---|---|---|
| `HOST` | Server bind address | `0.0.0.0` |
| `PORT` | Server port | `8080` |
| `DATABASE_URL` | PostgreSQL connection string | (required, e.g. `postgres://user:pass@localhost:5432/m365kg`) |
| `M365_TENANT_ID` | Microsoft Entra tenant ID | (required) |
| `M365_CLIENT_ID` | App registration client ID | (required) |
| `M365_CLIENT_SECRET` | App registration client secret | (required) |
| `M365_AUTH_MODE` | Auth mode | `entra_id` |
| `NEO4J_URI` | Neo4j connection URI | `bolt://localhost:7687` |
| `NEO4J_USERNAME` | Neo4j username | `neo4j` |
| `NEO4J_PASSWORD` | Neo4j password | (required) |
| `LLMSVC_ADDR` | `llm-svc` gRPC address — the **only** LLM-related variable the Go backend itself reads after this amendment (§3.5); all cloud/local LLM config below is read by `llm-svc`, not Go | `localhost:9090` |
| `LLMSVC_TLS` | Enable TLS on the Go↔`llm-svc` gRPC channel | `false` |
| `JWT_SECRET` | JWT secret (demo mode) | (auto-generated) |
| `ALLOWED_ORIGINS` | CORS origins | `http://localhost:5173` |
| `DELTA_SYNC_INTERVAL` | Delta sync interval | `5m` |

*`DATABASE_URL` replaces the earlier `DATA_DIR` variable, which described a filesystem path (fit for an embedded SQLite file, not a client-server PostgreSQL instance) — flagged in `review_1.2.md`.*

### 12.1 `llm-svc` Configuration (separate process/container, §3.4/§3.5)

The following were previously Go backend env vars; they moved to `llm-svc`'s config as part of the gRPC amendment (2026-07-11) and are **no longer read by the Go backend**:

| Variable | Purpose | Default |
|---|---|---|
| `NLP_MODE` | `1` cloud_only \| `2` cloud_with_local_preprocess (default) \| `3` local_only — see §3.4 | `2` |
| `LLM_API_BASE_URL` | Cloud LLM endpoint (OpenAI-compatible) used for `Generate`/`ExtractEntities` cloud passthrough | `https://mkp-api.fptcloud.com/v1` |
| `LLM_API_KEY` | Cloud LLM API key | (optional) |
| `LLM_MODEL` | Cloud model name for completions | `gpt-4o-mini` |
| `LLM_EMBED_MODEL` | Default embedding model name, seeded into `llm-svc`'s `models.yaml` at first deploy | `text-embedding-3-small` |
| `BRAIN_LOCAL_PROVIDER` | Local model identifier used for pre-processing/generation inside `llm-svc` (modes 2/3) | `qwen3-8b-q4` |
| `BRAIN_FALLBACK_TO_CLOUD` | Mode 2 only: fall back to cloud proxy on local-model failure | `true` |

*`llm-svc`'s bind port is configured via `LLMSVC_ADDR`'s port component (§3.5, e.g. `0.0.0.0:9090`) — there is no separate `LLMSVC_GRPC_PORT` variable; an earlier draft of this table introduced one redundantly (same default port as `LLMSVC_ADDR`) and it was removed here as a duplicate, per `/speckit-analyze` finding F3 (2026-07-11).*

---

## 13) Files to Create

### Go Backend
**New packages:**

| Package | Files | Purpose |
|---------|-------|---------|
| `internal/auth/` | `entra_id.go`, `jwt.go`, `middleware.go` | Authentication |
| `internal/connectors/` | `client.go`, `auth.go`, `onedrive.go`, `teams.go`, `delta.go`, `permissions.go` | M365 connectors |
| `internal/parsers/` | `docx.go`, `xlsx.go`, `pptx.go`, `pdf.go`, `text.go` | Document parsers |
| `internal/nlp/` | `extractor.go`, `prompt.go`, `types.go`, `confidence.go` | NLP extraction |
| `internal/graph/` | `types.go`, `builder.go`, `neo4j_store.go`, `neo4j_query.go`, `traversal.go`, `stats.go` | Business graph |
| `internal/retrieval/` | `retriever.go`, `intent_detector.go`, `permission_filter.go`, `semantic_search.go`, `graph_expander.go`, `reranker.go`, `context_packer.go`, `answer_generator.go` | Q&A pipeline (LLM-touching stages call `internal/llmsvc`) |
| `internal/embedding/` | `runtime.go`, `svc_client.go`, `batch.go`, `store.go` | Embeddings (client to `llm-svc` via `internal/llmsvc`) |
| `internal/llmsvc/` | `client.go`, `llmsvc.pb.go` | gRPC client for `llm-svc` — the only LLM-provider touchpoint in Go (§3.5) |
| `internal/brain/` | `router_client.go` | Task-type tagging wrapper over `internal/llmsvc.Client` (§3.4); routing policy itself lives in `llm-svc` |
| `internal/feedback/` | `store.go`, `analyzer.go`, `improver.go`, `exporter.go` | Feedback loop |
| `internal/metadata/` | `db.go`, `schema.go`, `query.go` | PostgreSQL metadata |
| `internal/scheduler/` | `delta_sync.go`, `reevaluator.go` | Background jobs |
| `internal/websocket/` | `hub.go` | Real-time updates |
| `internal/common/` | `config.go`, `logger.go`, `errors.go` | Utilities |
| `pkg/types/` | `entity.go`, `graph.go`, `retrieval.go`, `feedback.go` | Public types |

**Entry point:**
- `cmd/server/main.go` — DI, startup, wire all services

### Rust Service (`llm-svc/`, §3.5)

| File | Purpose |
|---|---|
| `proto/llmsvc.proto` | gRPC contract: `Embed`, `Rerank`, `ExtractEntities`, `Compress`, `DetectIntent`, `Generate`, `Health`, `ListModels` |
| `src/main.rs` | `tonic` gRPC server bootstrap |
| `src/service.rs` | `LlmSvc` trait implementation, dispatches to local models or `cloud_proxy.rs` per `NLP_MODE` |
| `src/routing.rs` | `NLP_MODE` policy (1/2/3) + fallback state machine (§3.4) |
| `src/models/onnx.rs` | ONNX inference via `ort` crate (embedding + rerank) |
| `src/models/gguf.rs` | GGUF inference (local generative model, used by `DetectIntent`/`ExtractEntities`/`Compress`/`Generate` in modes 2/3) |
| `src/models/safetensors.rs` | safetensors inference via `candle` |
| `src/cloud_proxy.rs` | Cloud LLM client (`LLM_API_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`) |
| `src/config.rs` | `models.yaml` loader + hot-reload + env config |
| `models.yaml` | Per-model config: `{name, format, path, dims, kind}` |

### Frontend

| Page | Purpose |
|------|---------|
| `KnowledgeSearch.tsx` | Main Q&A interface |
| `EntityBrowser.tsx` | Browse entities by type |
| `BusinessGraph.tsx` | Graph visualization |
| `FeedbackReview.tsx` | Review flagged answers |
| `DataSourcesPage.tsx` | Configure M365 connections |
| `LoginPage.tsx` | Entra ID / JWT login |
| `DashboardPage.tsx` | Overview dashboard |

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | Entra ID / JWT login |
| POST | `/api/auth/token/refresh` | Refresh auth token |
| POST | `/api/m365/connect` | Configure M365 connection |
| GET | `/api/m365/sources` | List connected data sources |
| POST | `/api/m365/sync` | Trigger data sync |
| GET | `/api/m365/sync/status` | Get sync status |
| POST | `/api/knowledge/query` | Natural language Q&A |
| POST | `/api/feedback` | Submit like/dislike |
| GET | `/api/feedback/stats` | Feedback analytics |
| GET | `/api/entities` | List/browse entities |
| GET | `/api/entities/:id` | Entity detail |
| GET | `/api/graph/nodes` | Graph nodes |
| GET | `/api/graph/edges` | Graph edges |
| GET | `/api/graph/path` | Find path between entities |
| GET | `/api/stats/overview` | Dashboard statistics |
| WS | `/ws?token=<JWT>` | Real-time updates |

---

## 14) Reuse (patterns from RAD system at `/workspace`)

| Pattern | RAD Source | New System Usage |
|---------|-----------|-----------------|
| Ingestion orchestrator | `internal/ingestion/ingestion.go` | Same orchestrator pattern for connect→enumerate→parse |
| Graph model | `internal/graph/types.go` | GraphNode/GraphEdge struct patterns, extended types |
| Graph builder | `internal/graph/builder.go` | build→validate→publish cycle (adapted for Neo4j) |
| LLM runtime interface | `internal/llm/runtime.go` | Embedding + NER extraction interfaces |
| SmartRouter | `internal/llm/smart_router.go` | Provider selection pattern |
| 7-stage retrieval | `internal/retriever/retriever.go` | 8-stage pipeline (added permission filter) |
| Intent detection | `internal/retriever/intent_detector.go` | Enterprise intent classification |
| Context packing | `internal/retriever/context_packer.go` | Token-aware context assembly |
| Permission filtering | `internal/retriever/metadata_filter.go` | Filter pattern, adapted for M365 ACL |
| Confidence scoring | `internal/knowledge/confidence.go` | Per-entity/relationship confidence |
| Epoch atomicity | `internal/epoch/` | Atomic sync visibility pattern |
| JWT auth | `internal/auth/` | JWT middleware (entra_id + demo fallback) |
| WebSocket hub | `internal/websocket/` | Real-time sync progress and query updates |
| Error wrapping | `internal/common/errors.go` | Structured error types |
| Config validation | `internal/common/config.go` | Startup config validation |
| Axios client | `Frontend/src/api/client.ts` | HTTP client with interceptors |
| TanStack Query | `Frontend/src/hooks/` | Server state hooks |
| Zustand store | `Frontend/src/store/useUIStore.ts` | UI state management |
| WebSocket hook | `Frontend/src/hooks/useWebSocket.ts` | Real-time updates with backoff |
| Chat UI | `Frontend/src/pages/BrainChatPage.tsx` | Q&A chat interface (adapt) |
| Graph viz | `Frontend/src/pages/CodeGraph.tsx` | Interactive graph (adapt for business) |
| i18n | `Frontend/src/i18n/` | en/vi internationalization |
| Shadcn/ui | `Frontend/src/components/ui/` | Button, Card, Badge, Modal, etc. |

---

## 15) State Machine Specifications

### 15.1 Delta Sync State Machine (per source in `delta_state`)

**States**
- `IDLE` (no active sync)
- `SYNC_RUNNING` (delta queries/pagination in progress)
- `SYNC_PARTIAL_HAS_MORE` (`has_more=true`, needs continuation)
- `SYNC_COMPLETED` (`has_more=false`, `last_sync_at` updated)
- `SYNC_FAILED` (error; retried per client retry/rate-limit strategy)

**Transitions**
- `IDLE → SYNC_RUNNING` on manual trigger (`/api/m365/sync`) or scheduler tick (`DELTA_SYNC_INTERVAL`).
- `SYNC_RUNNING → SYNC_PARTIAL_HAS_MORE` if more pages remain.
- `SYNC_PARTIAL_HAS_MORE → SYNC_RUNNING` when the next delta page is fetched.
- `SYNC_RUNNING → SYNC_COMPLETED` once the new `change_token` is saved and sync finishes.
- `(SYNC_RUNNING | SYNC_PARTIAL_HAS_MORE) → SYNC_FAILED` on error; returns to `IDLE` or retries (client has retry/rate-limiting).

### 15.2 Retrieval (Q&A) Pipeline State Machine (per query)

```
STAGE0_PERMISSION_FILTER → STAGE1_INTENT → STAGE2_QUERY_NER
  → parallel: (STAGE3_GRAPH_QUERY, STAGE4_SEMANTIC_SEARCH)
  → MERGE_DEDUP → STAGE5_RERANK → STAGE6_CONTEXT_PACK (default 12K tokens)
  → STAGE7_ANSWER_GEN → DONE
```

### 15.3 Feedback Improvement Loop State Machine

```
FEEDBACK_COLLECTED (insert feedback_events)
  → ANALYZED (analyzer finds trends/low-confidence hotspots)
  → REEVALUATION_SCHEDULED (scheduler)
  → REEXTRACTED (improver re-scans low-confidence edges, re-extracts with LLM)
  → GRAPH_UPDATED (confidence/edges updated)
  → back to steady-state
```

---

## 16) Verification

### Backend tests
```bash
# Unit tests per package
cd m365-knowledge-graph && go test ./internal/connectors/...
cd m365-knowledge-graph && go test ./internal/nlp/...
cd m365-knowledge-graph && go test ./internal/graph/...
cd m365-knowledge-graph && go test ./internal/retrieval/...
cd m365-knowledge-graph && go test ./internal/feedback/...
cd m365-knowledge-graph && go test ./...

# Integration tests (with mocked MS Graph API + test Neo4j)
cd m365-knowledge-graph && go test -tags=integration ./tests/integration/...
```

### Frontend tests
```bash
# Unit tests
cd Frontend && npm run test

# E2E tests
cd Frontend && npm run test:e2e
```

### E2E acceptance flow
1. **Auth**: User logs in via Entra ID → receives JWT → subsequent requests authorized
2. **Connect**: Admin configures M365 connection → `/api/m365/connect` returns 200
3. **Sync**: Trigger delta sync → `/api/m365/sync` starts, WebSocket emits progress events
4. **Ingest**: Verify documents imported → `/api/entities?type=document` returns entities
5. **Extract**: Verify NER ran → `/api/entities?type=person` and `/api/entities?type=project` return entities
6. **Graph**: Verify graph built → `/api/graph/nodes` returns nodes, `/api/graph/edges` returns edges
7. **Query**: Ask Q&A → `/api/knowledge/query` returns contextual answer with citations
8. **Feedback**: Submit like/dislike → `/api/feedback` records reaction
9. **Analytics**: Check trends → `/api/feedback/stats` shows feedback distribution
10. **Permissions**: Verify user only sees entities within their M365 access scope
11. **Delta sync**: Update a document on OneDrive → next delta sync picks up change

---

## 17) Phases Summary (Implementation Order)

| Phase | Scope | Key Deliverable | Dependencies |
|---|---|---|---|
| 1 | Foundation | M365 connected, files ingested, chunks parsed | None |
| 2 | Knowledge Graph | Entities + relationships in Neo4j | Phase 1 |
| 3 | Q&A Pipeline | Natural language answers with citations | Phase 1, 2 |
| 4 | Feedback Loop | Like/dislike → re-evaluation | Phase 3 |
| 5 | Frontend | Full dashboard UI | Phase 1–3 *(also needs Phase 4 for `FeedbackReview.tsx` / dashboard feedback-trends panel — see `review_1.2.md`)* |
| 6 | Permissions | Full permission-aware retrieval | Phase 1, 3 |

---

## 18) Design Decisions & Resolved Questions

### 18.1 Architecture Decisions Summary (T152) ✓ RESOLVED
See §3 above for the complete reuse-vs-new breakdown per architectural dimension. Key highlights: PostgreSQL for metadata/embeddings (not SQLite), gRPC `llm-svc` for all LLM processing (not separate HTTP sidecars), permission filtering at Stage 0 (INVARIANT-1 enforcement).

### 18.2 M365 Chat Content Consent & Retention Policy (T153) ✓ RESOLVED
**Policy**: The POC system (M365 Knowledge Graph v1.0) operates under the following consent model:
- **Scope**: Ingests Teams 1:1 chats, channel messages, and OneDrive/SharePoint documents via `Chat.Read.All`, `ChannelMessage.Read.All`, and `Files.Read.All` scopes (granted via app registration in the Azure portal).
- **User consent**: Delegated to the Azure tenant administrator who grants these app permissions; individual users do not opt-in or opt-out of content ingestion per-conversation or per-file. This is standard for enterprise tenant-wide data collection (e.g., audit logs, compliance scanning).
- **Data retention**: Ingested content is retained in PostgreSQL `chunks` table and Neo4j graph indefinitely (no time-based expiry in v1.0). Deletion of a source document in M365 (OneDrive file, Teams message) is **not** propagated back to the M365 Knowledge Graph in v1.0 — only forward deltas (new/modified documents) are ingested via delta sync. **Recommendation for future versions**: add a deletion-tracking mechanism in MS Graph's delta query or periodic ACL audit to detect deleted-then-purged content and remove it from the graph.
- **Redaction**: No automated redaction of sensitive content (PII, credentials, classified data) is performed during ingestion in v1.0. **Assumption**: content uploaded to corporate M365 is already assumed to be appropriately classified by the organization (M365's own data loss prevention policies should gate sensitive uploads). **Recommendation for future versions**: plug in a data classification/redaction service (e.g., Azure Information Protection, or a local PII detector) during the chunking phase to mask sensitive content before storage.
- **Risk acceptance**: The POC explicitly accepts the risk that private 1:1 chats and private Teams channels (readable via `Chat.Read.All` and `ChannelMessage.Read.All`) are ingested without per-user opt-in. This is a deployment choice: the Azure tenant admin who registers the app and grants these scopes is responsible for communicating this to users and ensuring it aligns with corporate policy. For a production rollout, a user-facing consent banner and granular per-space opt-out mechanism would be required.

### 18.3 Phase 6 Scope Consolidation (T154) ✓ RESOLVED
**Decision**: Phase 6 remains a conceptual phase in the specification, but its deliverables are **merged into Phase 3 (Q&A Pipeline)** during implementation.
- **Rationale**: Permission filtering (§3.3, INVARIANT-1) is a cross-cutting concern that is implemented as Stage 0 of the 8-stage retrieval pipeline in Phase 3. There is no separate "permission-aware retrieval" phase; it is integrated into the retrieval orchestrator from day one.
- **Implication**: The tasks.md "Phase 3" section now includes all 8 stages (permission filter through answer generation); there is no separate Phase 6 implementation task list. Permission cache population (from Phase 3 ingestion) is straightforward: `connectors/permissions.go` extracts ACLs during M365 sync; `permission_cache` table is populated atomically with chunk ingestion.

### 18.4 Vector Search Strategy: Brute-Force vs. `pgvector` ANN (T155) ✓ RESOLVED
**Decision**: Use **PostgreSQL brute-force cosine similarity** (no `pgvector` ANN index) for the POC.
- **Rationale**: 
  - POC scale (~10K documents → ~500K chunks at 100-word average, 3-way overlap; ~5M-10M total embeddings across multiple re-runs) fits in memory for brute-force similarity search with <200ms p50 latency (tested pattern in RAD system).
  - Avoids a new PostgreSQL extension (`pgvector`) and its operational complexity (version compatibility, extension installation, index rebuilds).
  - Brute-force implementation (`internal/embedding/store.go`, `SearchSimilar()` method) is straightforward Go (load all vectors for a model → compute cosine → sort descending).
  - If the POC scales beyond ~50K documents (10M embeddings), switching to `pgvector` is a straightforward database schema change: add `vector` column, create an HNSW index, rewrite `SearchSimilar()` to use Postgres's `<->` operator. No application logic change.
- **Note**: The decision does **not** commit `semantic_search.go` to brute-force forever; it is a deployment choice controlled by the storage layer. Future versions can transparently swap to `pgvector` by swapping the `SearchSimilar()` implementation and running a schema migration.

### 18.5 `permission_cache` Staleness & Invalidation (T156) ✓ RESOLVED (merged with T150)
**Decision**: `permission_cache` is populated during M365 ingestion (delta sync) and refreshed on **every delta sync cycle** (controlled by `DELTA_SYNC_INTERVAL`, default 5 minutes).
- **Mechanism**: `connectors/permissions.go`'s `RefreshCache()` is called at the end of each successful delta sync, re-fetching the current ACL for all modified files from MS Graph. Files that were not modified in the current delta window keep their cached permissions.
- **Staleness**: Maximum staleness is `DELTA_SYNC_INTERVAL` (5 minutes by default, tunable). If a user's permission changes while the system is not syncing, they will see the old cached permission until the next sync cycle completes.
- **Edge case**: If a user is **removed entirely from MS 365** (e.g., offboarded employee), the delta sync does not explicitly remove their `permission_cache` entries; they would become stale. **Future improvement**: add a monthly "full refresh" job that re-audits all users in `permission_cache` against the current Azure AD membership, removing entries for no-longer-active users. For v1.0, this edge case is an accepted operational risk (stale cached access for terminated users is better than incorrectly denying access to active users).
- **No schema change required**: `permission_cache(user_id, file_id, permission)` is sufficient; no explicit `expires_at` or `last_refreshed_at` column is needed. The refresh timestamp is implicitly "the time of the last successful delta sync" (available as `delta_state.last_sync_at`).

### 18.6 Open Questions Remaining (Not Blocking v1.0)

6. **NLP Extraction Local Routing** — Should ingestion-time entity/relationship extraction route through the Brain local model (§3.4, modes 2/3), or remain cloud-only? Answer deferred to Phase 2 implementation. **Provisional decision**: cloud-only in modes 1/2; optional local routing in mode 3 if extraction quality permits. Extraction accuracy is critical; local models may not be sufficient for reliable entity detection on business content. To be decided during `llm-svc` gRPC contract design (T157).

7. **`llm-svc` Deployment & Ops** — Container image build, gRPC health-check wiring, mTLS vs. plaintext, restart-on-model-swap runbook. Answer deferred to Phase 2. These are ops-layer concerns; the gRPC contract (T157–T158) and Rust service scaffolding (T159) are the blockers.

8. **Proto Versioning Strategy** — `proto/llmsvc.proto` is copied into both `src/m365-knowledge-graph/proto/` and `llm-svc/proto/`. Should this become a shared git submodule once the contract stabilizes? Answer deferred to Phase 2. **Provisional decision**: keep copies independent until v2.0; include a CI check to verify both copies are identical (detect drift).

---

## 19) Remaining Implementation Phases (Phases 1–6 + Iron-out for Groups A–I from tasks.md)

See `tasks.md` §Phase 9 (Remediation) and Dependency Order for the detailed task breakdown, dependency graph, and effort estimates following the Group A–I structure.
