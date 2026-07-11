# Implementation Plan: Enterprise Knowledge Graph from Microsoft 365

**Branch**: `001-m365-knowledge-graph` | **Date**: 2026-07-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/REQ-204-M365-001-m365-knowledge-graph/spec.md`

## Summary

Build an Enterprise Knowledge Graph system that ingests company data from Microsoft 365 (OneDrive/SharePoint + Teams), extracts business entities and relationships via LLM-based NLP, stores them in Neo4j with metadata in PostgreSQL, and answers natural-language questions with cited, permission-aware responses. System includes a feedback loop for continuous improvement and a frontend dashboard.

**Pattern source**: RAD Knowledge Gateway (`/workspace`) — reuses ingestion orchestrator, epoch-style atomic visibility, 7-stage retrieval pipeline, graph builder cycle, LLM runtime interface, and React frontend structure.

**Locked constraints**:
1. **Database**: PostgreSQL (metadata/embeddings) + Neo4j (graph) — *not SQLite, not LanceDB*
2. **Architecture**: Standalone `m365-knowledge-graph/` backend + React frontend — *MergeAssistant (src/MergeAssistant/) is completely independent; zero shared code with src/Backend*
3. **Auth**: Microsoft Entra ID SSO (OIDC/OAuth2) + Local JWT fallback (demo/test only)
4. **POC scope**: Single department (~50 users), ~10K docs, ~500K messages
5. **NLP/Embedding provider mode** (added 2026-07-11, spec.md §3.4/§3.5): runtime-configurable via `NLP_MODE` — `1` cloud_only, `2` cloud_with_local_preprocess (default), `3` local_only. Local inference (modes 2/3) is served by the `llm-svc` Rust service (§3.5) directly (ONNX/GGUF/safetensors) — **no Ollama dependency**, to keep local footprint to a single service process within the ≤8GB RAM budget.
6. **All LLM processing moves to Rust, gRPC-only** (added 2026-07-11, spec.md §3.5 rewrite): embedding, reranking, NER/entity extraction, context compression, and answer generation all execute inside `llm-svc`. The Go backend has zero direct LLM-provider HTTP clients; it communicates with `llm-svc` exclusively via a generated gRPC client (`internal/llmsvc/`), never HTTP/REST.

## Technical Context

**Language/Version**: Go 1.22+ (backend), React 18 + TypeScript 5 (frontend)

**Primary Dependencies**: 
- Backend: Microsoft Graph SDK, Neo4j driver, PostgreSQL driver (lib/pq), `google.golang.org/grpc` + generated `internal/llmsvc` client (the only path to any LLM, local or cloud) — no direct LLM HTTP client remains in the Go backend
- `llm-svc/` (new, Rust): `tonic` + `prost` (gRPC/protobuf), `ort` (ONNX Runtime bindings), a llama.cpp-compatible crate (GGUF), `candle` (safetensors), plus an internal HTTP client for cloud LLM passthrough (`reqwest` or similar)
- Brain integration (new): `internal/brain/` — thin Go wrapper tagging gRPC calls by task type (§3.4); the actual local/cloud routing policy (`NLP_MODE`) is implemented inside `llm-svc`, reusing the Brain Platform (REQ-023) Smart Router pattern as reference
- Frontend: TanStack Query v5, Zustand v4, Shadcn/ui, React Flow (graph viz)
- **Reuse directive**: where `src/Backend/internal/llm/` (`onnx.go`, `onnx_embedder.go`, `onnx_planner.go`, `smart_router.go`, `smart_router_onnx.go`, `fallback.go`, tokenizers) and `src/Backend/internal/retriever/` (`bert_reranker.go`, `reranker_onnx*.go`) already implement equivalent model-serving/routing/reranking logic, port their algorithms to Rust rather than designing from scratch (see spec.md §3.5). Where `src/Frontend/src/pages/` already has a same-shaped page (`BrainChatPage.tsx`, `DataSourcesPage.tsx`, `EntityBrowserPage.tsx`, `FeedbackReviewPage.tsx`, `GraphPage.tsx`, `LoginPage.tsx`, `DashboardPage.tsx`), copy it as the Phase 5 starting point and edit to match this feature's API/data model instead of writing from a blank file.

**Storage**: PostgreSQL (metadata, embeddings, sync state, feedback, queries) + Neo4j (business knowledge graph)

**Testing**: Go unit tests (`go test ./...`), integration tests (`-tags=integration`), Playwright E2E

**Target Platform**: Linux server (backend), browser (frontend)

**Project Type**: Web service + frontend dashboard

**Performance Goals**: P95 query latency ≤ 30s (default 12K-token context budget)

**Constraints**: 
- Single-writer pattern for graph updates (atomic build→validate→publish cycle)
- Permission filtering at retrieval Stage 0, never as post-filter
- All writes within transactions (crash-safe)
- No partial data visible to users (atomic visibility)

**Scale/Scope**: 
- POC: 10K+ documents, 500K+ messages, 50 users
- Single department; multi-department scaling out of scope

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **INVARIANT-1 (Correctness > Performance)**: Hybrid retrieval prioritizes permission-aware filtering (correctness) over response latency; all graph writes are deterministic (dedup-on-upsert).

✅ **INVARIANT-2 (Atomic Visibility)**: Graph build→validate→publish cycle uses single transaction per epoch; no unpublished data visible to API.

✅ **INVARIANT-3 (Deterministic Indexing)**: Entity dedup keys are deterministic (name + type); edges deduplicated by (from_entity + to_entity + relationship_type).

✅ **INVARIANT-4 (Crash-Safe Writes)**: PostgreSQL with standard transactions; Neo4j upserts within single TX; delta sync persists changeToken only after successful upsert.

✅ **INVARIANT-5 (Source Traceability)**: Every extracted entity/relationship carries source_chunk_id; every citation includes file + line.

## Project Structure

### Documentation (this feature)

```text
specs/REQ-204-M365-001-m365-knowledge-graph/
├── plan.md                      # This file
├── spec.md                       # Canonical specification (locked decisions)
├── spec_ipa.md                   # Technical companion (full detail)
├── research.md                   # Phase 0 (resolve NEEDS CLARIFICATION)
├── data-model.md                 # Phase 1 (entities, relationships, schema)
├── contracts/                    # Phase 1 (API contracts, WebSocket events)
├── quickstart.md                 # Phase 1 (integration guide for frontend)
└── tasks.md                      # Phase 2 (/speckit-tasks output)
```

### Source Code (new backend)

```text
src/m365-knowledge-graph/
├── cmd/
│   └── main.go                   # Server entry point
├── internal/
│   ├── config/                   # Configuration loading (env vars)
│   ├── connectors/               # M365 Graph API clients
│   │   ├── client.go            # MS Graph HTTP client + retry/rate-limit
│   │   ├── auth.go              # OAuth2 token management
│   │   ├── onedrive.go          # OneDrive/SharePoint ingestor
│   │   ├── teams.go             # Teams connector
│   │   ├── delta.go             # Delta sync coordinator
│   │   └── permissions.go       # ACL extraction + permission_cache
│   ├── parsers/                  # Document parsers (docx/xlsx/pptx/pdf/txt)
│   ├── metadata/                 # PostgreSQL metadata store
│   │   ├── schema.go            # DDL + migration
│   │   ├── files.go             # m365_files table ops
│   │   ├── chunks.go            # chunks table ops
│   │   ├── connections.go       # m365_connections config
│   │   └── permissions.go       # permission_cache ops
│   ├── nlp/                      # Entity extraction via LLM
│   │   ├── extractor.go         # Calls internal/llmsvc.Client.ExtractEntities (gRPC) — no direct LLM client
│   │   ├── confidence.go        # Confidence scoring (0.0-1.0)
│   │   └── prompt.go            # Extraction prompt templates (assembly only; execution in llm-svc)
│   ├── embedding/                # Vector embeddings (client-side; inference in llm-svc)
│   │   ├── runtime.go           # Embedding interface (unchanged)
│   │   ├── svc_client.go        # EmbeddingRuntime wrapper over internal/llmsvc.Client.Embed
│   │   └── batch.go             # Batch embedding worker (calls svc_client.go)
│   ├── llmsvc/                    # gRPC client for llm-svc — sole LLM-provider touchpoint in Go
│   │   ├── client.go              # Embed/Rerank/ExtractEntities/Compress/DetectIntent/Generate
│   │   └── llmsvc.pb.go           # Generated from proto/llmsvc.proto
│   ├── brain/                     # Task-type tagging wrapper (NLP_MODE routing lives in llm-svc)
│   │   └── router_client.go      # Tags calls by task type, delegates to internal/llmsvc.Client
│   ├── graph/                    # Neo4j knowledge graph
│   │   ├── builder.go           # Build→validate→publish cycle
│   │   ├── neo4j_store.go       # Neo4j client + connection pool
│   │   ├── traversal.go         # BFS/DFS queries
│   │   └── stats.go             # Graph statistics
│   ├── retrieval/                # 8-stage hybrid Q&A pipeline
│   │   ├── retriever.go         # Pipeline orchestrator
│   │   ├── permission_filter.go # Stage 0: permission enforcement
│   │   ├── intent.go            # Stage 1: DetectIntent via internal/llmsvc (gRPC)
│   │   ├── semantic_search.go   # Stage 4: Embed via internal/llmsvc, vector search
│   │   ├── graph_expander.go    # Stage 3: graph traversal
│   │   ├── reranker.go          # Stage 5: Rerank via internal/llmsvc (gRPC)
│   │   ├── context_packer.go    # Stage 6: token budgeting + Compress via internal/llmsvc when over budget
│   │   └── answer_gen.go        # Stage 7: Generate via internal/llmsvc (gRPC) + citations
│   ├── feedback/                 # Feedback loop
│   │   ├── store.go             # PostgreSQL feedback storage
│   │   ├── analyzer.go          # Trend analysis
│   │   └── improver.go          # Periodic re-extraction
│   ├── scheduler/                # Background jobs
│   │   ├── delta_sync.go        # Periodic delta sync
│   │   └── reevaluator.go       # Confidence re-evaluation
│   ├── websocket/                # Real-time updates
│   │   └── hub.go               # Sync progress broadcast
│   └── api/                      # REST endpoints
│       ├── auth.go              # /api/auth/* (login, refresh)
│       ├── m365.go              # /api/m365/* (connect, sync, status)
│       ├── knowledge.go         # /api/knowledge/query (Q&A)
│       ├── feedback.go          # /api/feedback, /api/feedback/stats
│       ├── entities.go          # /api/entities (browse)
│       ├── graph.go             # /api/graph/nodes, edges, path
│       └── stats.go             # /api/stats/overview
├── tests/
│   ├── unit/                     # Per-package unit tests
│   └── integration/              # End-to-end flow tests (mocked Graph API)
├── proto/
│   └── llmsvc.proto              # gRPC contract (copy of llm-svc/proto/llmsvc.proto)
├── go.mod
├── go.sum
└── Dockerfile

llm-svc/                            # NEW: Rust gRPC service (spec.md §3.5), separate deployable/Cargo.toml
├── Cargo.toml
├── proto/
│   └── llmsvc.proto               # gRPC contract (source of truth)
├── src/
│   ├── main.rs                   # tonic gRPC server bootstrap
│   ├── service.rs                # LlmSvc trait impl (Embed/Rerank/ExtractEntities/Compress/DetectIntent/Generate)
│   ├── routing.rs                # NLP_MODE policy + fallback state machine
│   ├── models/
│   │   ├── onnx.rs               # ort-based ONNX inference (embedding + rerank)
│   │   ├── gguf.rs               # GGUF inference (local generative model)
│   │   └── safetensors.rs        # candle-based inference
│   ├── cloud_proxy.rs             # Cloud LLM client (LLM_API_BASE_URL/LLM_API_KEY/LLM_MODEL)
│   └── config.rs                 # models.yaml loader + hot-reload
└── models.yaml                    # {name, format, path, dims, kind} per logical model

src/Frontend/  (or separate repo)
├── src/
│   ├── pages/
│   │   ├── LoginPage.tsx        # Entra ID + JWT fallback
│   │   ├── DashboardPage.tsx    # Overview (status, stats)
│   │   ├── SearchPage.tsx       # Q&A interface
│   │   ├── EntityBrowserPage.tsx # Entity browser + detail
│   │   ├── GraphPage.tsx        # Graph visualization (React Flow)
│   │   ├── FeedbackReviewPage.tsx # Admin feedback review
│   │   ├── DataSourcesPage.tsx  # M365 connection config
│   │   └── SettingsPage.tsx     # Admin settings
│   ├── components/              # Shared UI components
│   ├── hooks/                   # TanStack Query + custom hooks
│   ├── stores/                  # Zustand stores (UI state only)
│   └── types/
└── tests/
    ├── unit/
    └── e2e/                     # Playwright tests
```

**Structure Decision**: Web service architecture (Option 2) — standalone Go backend (`m365-knowledge-graph/`) with React/TypeScript frontend, plus (added 2026-07-11, revised same day) a standalone Rust gRPC service `llm-svc/` handling all LLM-related computation (embedding, rerank, NER, compression, answer generation — local models and cloud passthrough alike). No shared imports with src/Backend or any other module; `llm-svc/` has its own build/deploy lifecycle, called by the Go backend **only over gRPC** (never HTTP/REST) via `internal/llmsvc/client.go`.

## Implementation Phases

| Phase | Scope | Key Deliverable | Duration | Dependencies |
|-------|-------|-----------------|----------|---|
| 0 | Research & Design | Resolve NEEDS CLARIFICATION items; finalize data model, API contracts | 2-3 days | None |
| 1 | Foundation | M365 connectors, delta sync, document parsing, PostgreSQL schema | 1-2 weeks | Phase 0 |
| 2 | Knowledge Graph | NLP extraction, Neo4j graph builder, embedding pipeline | 1-2 weeks | Phase 1 |
| 3 | Q&A Pipeline | 8-stage retrieval, permission filtering, answer generation | 1-2 weeks | Phase 1, 2 |
| 4 | Feedback Loop | Like/dislike/flag storage, analytics, re-evaluation | 1 week | Phase 3 |
| 5 | Frontend | Dashboard UI, Q&A chat, entity browser, graph viz | 2-3 weeks | Phases 1-4 |
| 6 | Hardening | Permission audit, cache invalidation, security tests | 1 week | Phase 5 |
| 7 | Brain Integration + `llm-svc` (added 2026-07-11, revised to gRPC + full-LLM-scope same day) | `llm-svc` Rust gRPC service (ONNX/GGUF/safetensors + cloud proxy) hosting embedding, rerank, NER, compression, and answer generation; `NLP_MODE` switch (1/2/3) implemented inside `llm-svc`; Go migrates fully off direct LLM HTTP clients onto `internal/llmsvc` gRPC client; no-Ollama local inference | 3-4 weeks | Phase 2 (embeddings/extraction), Phase 3 (retrieval stages) |

**Total Estimate**: 11-16 weeks for a fully integrated POC (revised from 8-12 weeks; Phase 7 grew from 2-3 to 3-4 weeks when its scope expanded from embeddings-only to all LLM processing + gRPC contract).

## Complexity Tracking

No Constitution violations identified. All INVARIANT-1~5 are respected by design:
- Correctness: Permission filtering at Stage 0, deterministic dedup
- Atomic visibility: Graph build→validate→publish in single TX
- Deterministic indexing: Entity dedup by name+type, edge dedup by source+target+type
- Crash-safe: PostgreSQL TX + Neo4j TX + changeToken persistence strategy
- Source traceability: Every entity/relationship carries source_chunk_id; citations include file+line
