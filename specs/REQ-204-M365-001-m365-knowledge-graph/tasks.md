# Tasks: Enterprise Knowledge Graph from Microsoft 365 (Dual-Stack Edition)

**Feature**: REQ-M365-001 (REQ-204)  
**Branch**: `001-m365-knowledge-graph`  
**Updated**: 2026-07-18  
**Architecture**: Dual-stack (Option 1: PostgreSQL+Neo4j | Option 2: SQLite+LanceDB, configurable by DB_TYPE env var)

---

## Overview: Dual-Stack Architecture

This implementation supports TWO independent database + graph stacks, selectable at service startup:

- **Option 1 (DB_TYPE=postgres_neo4j)**: PostgreSQL (metadata/embeddings) + Neo4j (entity graph). For server deployments, multi-user, complex entity relationships.
- **Option 2 (DB_TYPE=sqlite_lancedb)**: SQLite (metadata/embeddings) + LanceDB (vector retrieval). For Windows desktop app (Cowork GHC), single-user, no external services.

Each task is labeled with **[OPT1]**, **[OPT2]**, or **[SHARED]** to indicate which stack(s) it applies to.

---

## Phase 1: Setup (Project Initialization)

**Purpose**: Foundation and project structure

- [X] T001 Create project directory structure at `app/backend/` with subdirs: cmd/, internal/, pkg/, tests/, migrations/, proto/
- [X] T002 Initialize Go module with `go mod init github.com/rad-system/m365-knowledge-graph`
- [X] T003 [P] Create `.gitignore` for Go project (vendor/, dist/, *.out, .env, .vscode/, .idea/)
- [X] T004 [P] Setup Makefile with targets: build, test, lint, run, docker-build, docker-run
- [X] T005 Create `app/backend/cmd/main.go` entry point with graceful shutdown and signal handling
- [X] T006 [P] Setup gofmt, golint in pre-commit hooks via Makefile
- [X] T007 Implement configuration loader in `app/backend/internal/config/config.go`: parse DB_TYPE env var (postgres_neo4j / sqlite_lancedb), connection strings, API keys, ports per plan.md §7

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure MUST be complete before user story implementation

⚠️ **CRITICAL**: No feature work can begin until this phase is complete

### 2.1 Database Abstraction Layer (SHARED)

- [X] T008 Define abstract `Repository` interface in `app/backend/internal/metadata/repository.go` with methods: CreateChunk, GetChunk, UpsertEntity, GetEntity, QueryChunks, UpsertPermission, GetPermissionCache, CreateSyncState, UpdateSyncState, QueryFeedback, etc. (all CRUD operations must be driver-agnostic)
- [X] T009 [SHARED] Create structured logging via slog in `app/backend/internal/common/logger.go`
- [X] T010 [SHARED] Create error types and wrapping in `app/backend/internal/common/errors.go`

### 2.2 Option 1 (PostgreSQL + Neo4j) Specific Setup

- [X] T011 [OPT1] Create PostgreSQL migration file at `app/backend/migrations/schema_postgres.sql` with all 11 tables: delta_state, m365_files, chunks, m365_connections, permission_cache, embedding_models, chunk_embeddings, embedding_jobs, query_logs, feedback_events, extraction_confidence (DDL per data-model.md §1)
- [X] T012 [OPT1] Implement PostgreSQL driver in `app/backend/internal/metadata/postgres_driver.go`: connection pool (lib/pq), transaction support, parameterized queries ($1/$2/$3), prepared statements, connection pooling (pgx)
- [X] T013 [OPT1] Implement PostgreSQL query builders in `app/backend/internal/metadata/postgres_queries.go` (CRUD operations for all 11 tables, implements Repository interface)
- [X] T014 [OPT1] Create Neo4j connection pool and query builder in `app/backend/internal/graph/neo4j_store.go` (node labels: Entity, Person, Project, Technology, Customer, Department; relationship types per data-model.md §2)
- [ ] T015 [OPT1] Create docker-compose.yml for local PostgreSQL + Neo4j stack at repo root (PostgreSQL 15, Neo4j 5.x community)

### 2.3 Option 2 (SQLite + LanceDB) Specific Setup

- [X] T016 [OPT2] Create SQLite migration file at `app/backend/migrations/schema_sqlite.sql` with same 11 tables as PostgreSQL version, but adjusted for SQLite dialect: BLOB instead of BYTEA, INTEGER PRIMARY KEY AUTOINCREMENT for IDs, simplified CONSTRAINT syntax, no sequences
- [X] T017 [OPT2] Implement SQLite driver in `app/backend/internal/metadata/sqlite_driver.go`: connection pool (github.com/mattn/go-sqlite3 or github.com/ncruces/go-sqlite3), enable PRAGMA journal_mode=WAL, PRAGMA busy_timeout=5000 for concurrent read+write safety
- [X] T018 [OPT2] Implement SQLite query builders in `app/backend/internal/metadata/sqlite_queries.go` (CRUD operations with ? parameterization, implements Repository interface, identical semantics to PostgreSQL queries)
- [X] T019 [OPT2] Create LanceDB client wrapper in `app/backend/internal/graph/lancedb_store.go`: vector-only retrieval (no entity graph, just embeddings + metadata), cosine similarity search in-memory after loading vectors
- [X] T020 [OPT2] Add SQLite + LanceDB to go.mod dependencies; verify no Neo4j or PostgreSQL drivers imported when DB_TYPE=sqlite_lancedb

### 2.4 Shared Infrastructure (Both Options)

- [X] T021 [SHARED] Implement database driver factory in `app/backend/internal/metadata/factory.go`: ParseDBType(env) → returns Repository interface, driver selected based on DB_TYPE
- [X] T022 [SHARED] Implement API router and middleware in `app/backend/internal/api/router.go` (CORS, auth, logging, error handling, independent of DB_TYPE)
- [X] T023 [SHARED] Implement authentication middleware (Entra ID OIDC + JWT fallback) in `app/backend/internal/auth/entra_id.go` and `app/backend/internal/auth/jwt.go`
- [X] T024 [SHARED] Implement `POST /api/auth/login` and `POST /api/auth/token/refresh` endpoints in `app/backend/internal/api/handlers_auth.go`
- [X] T025 [SHARED] Create shared type definitions in `app/backend/pkg/types/entity.go`, `graph.go`, `retrieval.go`, `feedback.go` (used by both Option 1 and Option 2)
- [X] T026 [SHARED] Implement WebSocket hub in `app/backend/internal/websocket/hub.go` (auth via ?token=JWT, emits sync_progress, extraction_progress, query_complete events)
- [X] T027 [SHARED] Create unit test framework structure under `app/backend/tests/unit/`
- [X] T028 [SHARED] Create integration test mocks for MS Graph API at `app/backend/tests/integration/m365_mock.go`

**Checkpoint**: Foundation ready — user stories can now begin in parallel (Option 1 and Option 2 are independent)

---

## Phase 3: M365 Connectors + Parsing (SHARED)

**Goal**: Ingest M365 content with incremental delta sync and parse multiple document formats. Used by both stacks.

- [X] T029 [P] [SHARED] Implement MS Graph HTTP client with retry/rate-limiting in `app/backend/internal/connectors/client.go`
- [X] T030 [P] [SHARED] Implement OAuth2 token management in `app/backend/internal/auth/entra_id.go` (client credentials + delegated tokens)
- [X] T031 [P] [SHARED] Implement OneDrive/SharePoint ingestor in `app/backend/internal/connectors/onedrive.go` (file list, download, delta query)
- [X] T032 [P] [SHARED] Implement Teams connector in `app/backend/internal/connectors/teams.go` (channel list, message fetch)
- [X] T033 [SHARED] Implement delta sync coordinator in `app/backend/internal/connectors/delta.go` (state machine: IDLE→SYNC_RUNNING→SYNC_COMPLETED/FAILED, changeToken persistence)
- [X] T034 [P] [SHARED] Implement M365 permission extraction in `app/backend/internal/connectors/permissions.go` (ACL cache into permission_cache table)
- [X] T035 [P] [SHARED] Implement document parsers in `app/backend/internal/parsers/`: docx.go, xlsx.go, pptx.go, pdf.go, text.go
- [X] T036 [SHARED] Implement text chunking logic in `app/backend/internal/parsers/chunker.go` (fixed-size chunks with overlap, writes to chunks table)
- [X] T037 [SHARED] Implement `POST /api/m365/connect` endpoint in `app/backend/internal/api/handlers_m365.go`
- [X] T038 [SHARED] Implement `POST /api/m365/sync` endpoint in `app/backend/internal/api/handlers_m365.go` (manual + scheduled delta sync, returns 202 + WebSocket events)
- [X] T039 [SHARED] Implement `GET /api/m365/sync/status` endpoint for sync state and progress
- [X] T040 [P] [SHARED] Implement `GET /api/m365/sources` endpoint to list connected M365 sources

**Checkpoint**: M365 ingestion fully functional for both stacks

---

## Phase 4a: Knowledge Graph (Option 1 - PostgreSQL + Neo4j)

**Goal**: Extract entities/relationships via LLM and build Neo4j knowledge graph (Option 1 only)

### 4a.1 NLP + Entity Extraction (via llm-svc gRPC)

- [X] T041 [OPT1] [P] Unit test MS Graph API client retry logic in `app/backend/tests/unit/connectors/client_test.go`
- [X] T042 [OPT1] [P] Unit test OAuth2 token management in `app/backend/tests/unit/auth/oauth_test.go`
- [X] T043 [OPT1] [P] Unit test document parsers (docx, xlsx, pptx, pdf) in `app/backend/tests/unit/parsers/*_test.go`
- [X] T044 [OPT1] Integration test delta sync coordinator with mocked Graph API in `app/backend/tests/integration/connectors/delta_sync_test.go`
- [X] T045 [OPT1] Integration test permission cache population in `app/backend/tests/integration/connectors/permissions_test.go`
- [X] T046 [OPT1] Implement gRPC client for llm-svc in `app/backend/internal/llmsvc/client.go` (methods: Embed, ExtractEntities, Rerank, DetectIntent, Compress, Generate)
- [X] T047 [OPT1] Implement entity extraction via llm-svc in `app/backend/internal/nlp/extractor.go` (calls internal/llmsvc.Client.ExtractEntities gRPC, no direct LLM client)
- [X] T048 [OPT1] Implement confidence scoring in `app/backend/internal/nlp/confidence.go` (0.0-1.0 scoring for extracted entities/relationships)
- [X] T049 [OPT1] Implement extraction prompt templates in `app/backend/internal/nlp/prompt.go` (assembly only; execution in llm-svc)

### 4a.2 Neo4j Graph Building (Option 1 Only)

- [X] T050 [OPT1] Implement Neo4j graph builder in `app/backend/internal/graph/builder.go` (build→validate→publish cycle, atomic transactions per data-model.md §2)
- [X] T051 [OPT1] Implement entity/relationship upsert logic in `app/backend/internal/graph/builder.go` (dedup on name+type, deterministic edge IDs)
- [X] T052 [OPT1] Implement graph validation in `app/backend/internal/graph/validator.go` (consistency checks, dedup verification)
- [X] T053 [OPT1] Implement graph publishing/activation in `app/backend/internal/graph/publisher.go` (single transaction per epoch, atomic visibility)
- [X] T054 [OPT1] Implement graph traversal/BFS in `app/backend/internal/graph/traversal.go` (entity expansion for retrieval Stage 3)
- [X] T055 [OPT1] Implement graph statistics in `app/backend/internal/graph/stats.go` (node count, edge count, relationship types)
- [X] T056 [OPT1] Implement `POST /api/entities/extract` endpoint to trigger entity extraction in `app/backend/internal/api/handlers_entities.go`

**Checkpoint (Option 1)**: Neo4j graph building fully functional

---

## Phase 4b: Vector-Based Retrieval (Option 2 - SQLite + LanceDB)

**Goal**: Vector-only retrieval using LanceDB (Option 2 only, no entity graph)

### 4b.1 Embedding Generation (via llm-svc gRPC - SHARED between options)

- [X] T057 [OPT2] Implement embedding runtime interface in `app/backend/internal/embedding/runtime.go` (abstraction for LanceDB-specific logic)
- [X] T058 [OPT2] Implement embedding client wrapper over llm-svc in `app/backend/internal/embedding/svc_client.go` (calls internal/llmsvc.Client.Embed gRPC)
- [X] T059 [OPT2] Implement batch embedding worker in `app/backend/internal/embedding/batch.go` (processes chunks in batches, writes to LanceDB)
- [X] T060 [OPT2] Implement LanceDB vector storage in `app/backend/internal/graph/lancedb_store.go` (create tables, upsert vectors, cosine similarity search)

### 4b.2 Vector-Based Q&A (No Entity Graph for Option 2)

- [X] T061 [OPT2] Implement vector search in `app/backend/internal/retrieval/vector_search.go` (load embeddings from LanceDB, in-memory cosine similarity)
- [X] T062 [OPT2] Implement simplified retrieval pipeline for Option 2 (no Neo4j graph expansion Stage 3, just semantic search + rerank)
- [X] T063 [OPT2] Implement `GET /api/knowledge/search` endpoint for vector-based Q&A in Option 2 (without Neo4j entity expansion)

**Checkpoint (Option 2)**: Vector-based retrieval fully functional

---

## Phase 5: Hybrid Retrieval & Q&A (SHARED - adapted per stack)

**Goal**: 8-stage hybrid retrieval pipeline (adapts to Option 1 with graph expansion or Option 2 with vector-only)

- [X] T064 [SHARED] Implement permission filtering (Stage 0) in `app/backend/internal/retrieval/permission_filter.go`
- [X] T065 [SHARED] Implement intent detection (Stage 1) in `app/backend/internal/retrieval/intent.go` (calls llm-svc.DetectIntent gRPC)
- [X] T066 [SHARED] Implement query NER (Stage 2) in `app/backend/internal/retrieval/query_ner.go` (extract entity mentions from query via llm-svc)
- [X] T067 [OPT1] [SHARED - Option 1 only] Implement graph expansion (Stage 3 for Option 1) in `app/backend/internal/retrieval/graph_expander.go` (Neo4j BFS traversal, Option 1 only)
- [X] T068 [OPT2] [SHARED - Option 2 only] Implement vector semantic search (Stage 3 for Option 2) in `app/backend/internal/retrieval/vector_search.go` (LanceDB similarity, Option 2 only)
- [X] T069 [SHARED] Implement merge/dedup (Stage 4) in `app/backend/internal/retrieval/deduper.go` (combine graph results + semantic results)
- [X] T070 [SHARED] Implement reranking (Stage 5) in `app/backend/internal/retrieval/reranker.go` (calls llm-svc.Rerank gRPC)
- [X] T071 [SHARED] Implement context packing (Stage 6) in `app/backend/internal/retrieval/context_packer.go` (token budgeting, calls llm-svc.Compress when over budget)
- [X] T072 [SHARED] Implement answer generation (Stage 7) in `app/backend/internal/retrieval/answer_gen.go` (calls llm-svc.Generate gRPC, adds citations)
- [X] T073 [SHARED] Implement retrieval orchestrator in `app/backend/internal/retrieval/retriever.go` (pipeline coordinator, handles both Option 1 and Option 2)
- [X] T074 [SHARED] Implement `POST /api/knowledge/query` endpoint in `app/backend/internal/api/handlers_knowledge.go` (Q&A endpoint, routes through retrieval pipeline)
- [X] T075 [SHARED] Implement `GET /api/knowledge/query/{id}` endpoint to retrieve past query results

**Checkpoint**: Hybrid retrieval fully functional (both stacks)

---

## Phase 6: Feedback Loop (SHARED)

**Goal**: Capture user feedback and drive improvement

- [X] T076 [SHARED] Implement feedback storage in `app/backend/internal/feedback/store.go` (PostgreSQL/SQLite, writes to feedback_events table)
- [X] T077 [SHARED] Implement feedback analytics in `app/backend/internal/feedback/analyzer.go` (trend analysis, low-confidence edge detection)
- [X] T078 [SHARED] Implement confidence-driven re-evaluator in `app/backend/internal/feedback/improver.go` (periodic re-extraction of low-confidence entities)
- [X] T079 [SHARED] Implement `POST /api/feedback/{query_id}` endpoint in `app/backend/internal/api/handlers_feedback.go` (submit feedback: like/dislike/flag)
- [X] T080 [SHARED] Implement `GET /api/feedback/stats` endpoint for feedback statistics

**Checkpoint**: Feedback loop fully functional

---

## Phase 7: Scheduling & Background Jobs (SHARED)

**Goal**: Periodic sync and re-evaluation

- [X] T081 [SHARED] Implement delta sync scheduler in `app/backend/internal/scheduler/delta_sync.go` (periodic M365 sync, configurable interval)
- [X] T082 [SHARED] Implement confidence re-evaluator scheduler in `app/backend/internal/scheduler/reevaluator.go` (periodic re-extraction of low-confidence edges)
- [X] T083 [SHARED] Implement scheduler lifecycle in `app/backend/cmd/main.go` (start/stop background jobs on service startup/shutdown)

**Checkpoint**: Background jobs operational

---

## Phase 8: API Endpoints & Entity Browser (SHARED)

**Goal**: Complete API surface and data exploration

- [X] T084 [SHARED] Implement `GET /api/entities` endpoint in `app/backend/internal/api/handlers_entities.go` (list entities with filters)
- [X] T085 [OPT1] Implement `GET /api/entities/{id}` endpoint (entity detail, Option 1 includes related entities from Neo4j)
- [X] T086 [OPT2] Implement `GET /api/entities/{id}` endpoint (entity detail, Option 2 includes related vectors from LanceDB metadata)
- [X] T087 [OPT1] Implement `GET /api/graph/nodes` endpoint in `app/backend/internal/api/handlers_graph.go` (Option 1 only, returns Neo4j nodes)
- [X] T088 [OPT1] Implement `GET /api/graph/edges` endpoint (Option 1 only, returns Neo4j relationships)
- [X] T089 [OPT1] Implement `GET /api/graph/path` endpoint (Option 1 only, entity path finding in Neo4j)
- [X] T090 [SHARED] Implement `GET /api/stats/overview` endpoint in `app/backend/internal/api/handlers_stats.go` (system metrics: entity count, chunk count, query count)

**Checkpoint**: Full entity/graph browsing API available

---

## Phase 9: Testing & Integration (SHARED)

**Goal**: Comprehensive testing for both stacks

- [X] T091 [SHARED] Create integration test suite for M365 ingestion in `app/backend/tests/integration/m365_test.go` (mocked Graph API)
- [X] T092 [OPT1] Create integration test for Neo4j graph building in `app/backend/tests/integration/graph_test.go` (Option 1 only)
- [X] T093 [OPT2] Create integration test for LanceDB vector storage in `app/backend/tests/integration/lancedb_test.go` (Option 2 only)
- [X] T094 [SHARED] Create integration test for retrieval pipeline in `app/backend/tests/integration/retrieval_test.go` (end-to-end: sync → extract → query)
- [X] T095 [SHARED] Create end-to-end test for both stacks (same ingestion → different graph backends)
- [X] T096 [SHARED] Run unit tests: `go test -v ./internal/... -cover` (target ≥80% coverage)
- [X] T097 [SHARED] Run integration tests: `go test -v -tags=integration ./tests/integration/...`

**Checkpoint**: All tests passing, both stacks verified

---

## Phase 10: Performance Testing (SHARED)

**Goal**: Verify both stacks meet latency targets

- [X] T098 [OPT1] Load test PostgreSQL + Neo4j with 500K chunks, 10K entities: verify P95 query latency ≤30s (per spec §Performance Goals), concurrent reads
- [X] T099 [OPT2] Load test SQLite + LanceDB with 500K chunks: verify P95 query latency ≤30s, concurrent reads with WAL mode
- [X] T100 [SHARED] Profile memory usage for both stacks (target: <2GB per Option 2 for Windows app)
- [X] T101 [SHARED] Document performance trade-offs: Option 1 (server-scale, concurrent writes), Option 2 (desktop app, single-writer serialization acceptable)

**Checkpoint**: Performance targets validated

---

## Phase 11: Documentation & Integration with Cowork GHC (SHARED)

**Goal**: Make Option 2 usable in Cowork GHC

- [X] T102 [SHARED] Create `app/backend/docs/ARCHITECTURE.md` documenting dual-stack design, DB_TYPE configuration, Option 1 vs Option 2 trade-offs
- [X] T103 [SHARED] Create `app/backend/docs/INTEGRATION.md` for frontend teams (API contracts, WebSocket events, error codes)
- [X] T104 [SHARED] Create `app/backend/README.md` with build instructions for both stacks: `DB_TYPE=postgres_neo4j make run` and `DB_TYPE=sqlite_lancedb make run`
- [X] T105 [OPT2] Create Cowork GHC integration task: wire Option 2 backend into Cowork service startup (use SQLite + LanceDB by default in desktop app)
- [X] T106 [SHARED] Create deployment guide: Option 1 for server (PostgreSQL + Neo4j provisioning), Option 2 for desktop (file-based, no provisioning)
- [X] T107 [SHARED] Add `.env.example` with all configuration variables (DB_TYPE, DATABASE_URL, NEO4J_URI, LLM_*, JWT_SECRET, M365_*, etc.)

**Checkpoint**: Full documentation, Cowork GHC integration ready

---

## Phase 12: Polish & Cleanup (SHARED)

**Goal**: Code quality, error handling, observability

- [X] T108 [SHARED] Code review: ensure no PostgreSQL/Neo4j drivers imported when DB_TYPE=sqlite_lancedb (and vice versa)
- [X] T109 [SHARED] Error handling: consistent error codes across both stacks, proper HTTP status codes in API responses
- [X] T110 [SHARED] Logging: structured logs (slog) for debugging, log levels consistent across both stacks
- [X] T111 [SHARED] Graceful degradation: handle missing llm-svc service, database unavailability, M365 API rate limits
- [X] T112 [SHARED] Final integration test: deploy both stacks end-to-end, verify no regressions

**Checkpoint**: Production-ready, both stacks fully functional

---

## Summary

- **Total Tasks**: 112
- **Shared Tasks**: 62 (M365 connectors, retrieval, feedback, scheduling, API)
- **Option 1 (PostgreSQL+Neo4j) Specific**: 28
- **Option 2 (SQLite+LanceDB) Specific**: 22
- **Parallel Opportunities**: ~25 tasks marked [P] (independent operations, can run concurrently)

**MVP Scope** (Phase 0-5 + core testing):
- Phase 1-2: Foundation (both stacks)
- Phase 3: M365 ingestion (both stacks)
- Phase 4a OR 4b: Choose Option 1 (Neo4j) OR Option 2 (LanceDB)
- Phase 5: Retrieval (adapted per stack)
- Phase 9: Testing

**Estimated Effort**: 
- Option 1 (PostgreSQL+Neo4j): ~8-10 weeks
- Option 2 (SQLite+LanceDB): ~6-8 weeks
- Both stacks together: ~12-14 weeks (parallel work, shared layers reduce overhead)

---

## Configuration & Build

### Building for Option 1 (PostgreSQL + Neo4j)
```bash
export DB_TYPE=postgres_neo4j
export DATABASE_URL=postgres://user:pass@localhost:5432/m365kg
export NEO4J_URI=bolt://localhost:7687
export NEO4J_USERNAME=neo4j
export NEO4J_PASSWORD=password
make build
make run
```

### Building for Option 2 (SQLite + LanceDB)
```bash
export DB_TYPE=sqlite_lancedb
export DATABASE_URL=file:///path/to/cowork-ghc.db?cache=shared
make build
make run
```

Both stacks: identical business logic, different persistence. Switchable at startup.
