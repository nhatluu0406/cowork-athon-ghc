#Feature Specification: Enterprise Knowledge Graph from Microsoft 365

**Feature ID**: REQ-M365-001  
**Created**: 2026-07-09  
**Status**: Draft  
**Author**: speckit-planner  
**Branch target**: `001-m365-knowledge-graph`

**Input (user description)**:  
“Build an intelligent system capable of continuously learning from the company’s internal data (stored on OneDrive and Teams) to answer questions and provide accurate, contextual information. The system uses a Knowledge Graph, NLP entity extraction, hybrid retrieval (graph + semantic), and a self-improving feedback loop.”

---

## Locked Decisions (from planning session)

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
| Database | SQLite (metadata) + Neo4j (graph) | RAD pattern: lightweight metadata + dedicated graph store |

---

## Overview

The Enterprise Knowledge Graph is an intelligent system that ingests company data from Microsoft 365 (OneDrive + Teams), extracts business entities and their relationships via NLP, builds a graph-based knowledge base, and answers natural language questions with accurate, contextual, and permission-aware responses. The system improves over time through user feedback (like/dislike) and periodic re-evaluation of low-confidence knowledge.

**Pattern source**: The architecture borrows from the existing **RAD Knowledge Gateway** (`/workspace`)—specifically the ingestion orchestrator pattern, epoch-style atomic visibility, 7-stage retrieval pipeline, graph builder cycle, LLM runtime interface, and React frontend structure (TanStack Query + Zustand + Shadcn/ui). However, the data domain, graph model, and connectors are entirely new.

---

## Architecture (Decisions Summary)

| Dimension | RAD Knowledge Gateway (pattern source) | New System |
|---|---|---|
*(No further content provided in the file under this table.)*

---

## Approach

### Project Structure

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
│   │   ├── reranker.go            # Result reranking
│   │   ├── context_packer.go      # Token-aware context assembly
│   │   └── answer_generator.go    # LLM answer generation with citations
│   │
│   ├── embedding/                  # Embedding generation
│   │   ├── runtime.go             # Embedding runtime interface
│   │   ├── custom_api.go          # Custom private API provider
│   │   ├── batch.go               # Batch embedding (worker pool)
│   │   └── store.go               # Embedding storage (SQLite FTS + Neo4j)
│   │
│   ├── feedback/                   # Self-improvement loop
│   │   ├── store.go               # Feedback collection (SQLite)
│   │   ├── analyzer.go            # Feedback analytics and trends
│   │   ├── improver.go            # Self-improvement engine
│   │   └── exporter.go            # Fine-tuning data export
│   │
│   ├── metadata/                   # SQLite metadata store
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
├── migrations/                     # SQLite migrations
├── scripts/                        # Build and utility scripts
└── tests/                          # Integration tests
    └── integration/
        ├── m365_mock.go           # Mock MS Graph API
        └── retrieval_test.go      # End-to-end retrieval tests
```

**Frontend**
```
Frontend/
├── src/
│   ├── api/ ...                   # Axios client + endpoint wrappers
│   ├── components/ ...            # UI components
│   ├── hooks/ ...                 # TanStack Query hooks + WebSocket hook
│   ├── pages/ ...                 # Q&A, Entity Browser, Graph, Admin, etc.
│   ├── store/ ...                 # Zustand store
│   ├── i18n/ ...                  # en/vi
│   └── types/ ...                 # TS types
├── package.json
└── vite.config.ts
```

---

## Phase 1: Foundation — Auth, M365 Connectors, Document Parsers

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
- `internal/metadata/schema.go` — SQLite tables for sync state, file metadata, permissions

### SQLite schema (Phase 1)
*(SQL content preserved as-is; comments translated where applicable.)*
```sql
-- Sync state for delta queries
CREATE TABLE delta_state (
    source TEXT PRIMARY KEY,  -- 'onedrive:/site/drive' or 'teams:/group/channel'
    change_token TEXT NOT NULL,
    has_more INTEGER DEFAULT 0,
    last_sync_at TEXT NOT NULL
);

-- Imported file/document metadata
CREATE TABLE m365_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,  -- 'onedrive' or 'teams'
    source_id TEXT NOT NULL,    -- OneDrive item ID or Teams message ID
    file_name TEXT NOT NULL,
    file_type TEXT,             -- 'docx', 'xlsx', 'pptx', 'pdf', 'txt', 'chat_message'
    file_size INTEGER,
    content_hash TEXT,
    last_modified TEXT NOT NULL,
    created_at TEXT NOT NULL,
    permissions_json TEXT       -- JSON of ACL entries
);

-- Parsed text chunks
CREATE TABLE chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES m365_files(id),
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    heading_path TEXT,          -- for docx/pptx: outline hierarchy
    UNIQUE(file_id, chunk_index)
);

-- MS 365 connection configuration
CREATE TABLE m365_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,         -- 'onedrive' or 'teams'
    tenant_id TEXT NOT NULL,
    config_json TEXT NOT NULL,  -- site_id, group_id, etc.
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL
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

## Phase 2: NLP Entity Extraction + Knowledge Graph (Neo4j)

**Goal**: Extract business entities and relationships from text chunks; store in Neo4j.

**Packages**: `internal/nlp/`, `internal/graph/`, `internal/embedding/`

**Key files**
- `internal/nlp/types.go` — Entity types (Person, Project, Document, Technology, Customer, Department, Date, Amount) and relationship types  
- `internal/nlp/extractor.go` — LLM-based extraction: send chunk → get structured entities + relationships  
- `internal/nlp/prompt.go` — Extraction prompts tailored for custom LLM  
- `internal/nlp/confidence.go` — Confidence scoring (0.0–1.0) per extracted entity/relationship  
- `internal/graph/types.go` — GraphNode/GraphEdge for business domain  
- `internal/graph/builder.go` — Batch: ingest NLP results → deduplicate → upsert to Neo4j  
- `internal/graph/neo4j_store.go` — Neo4j client, Cypher upserts, connection pool  
- `internal/graph/neo4j_query.go` — Cypher query patterns (find entity, find paths, find neighbors)  
- `internal/graph/traversal.go` — BFS/DFS traversal with depth limit  
- `internal/graph/stats.go` — Graph statistics (node/edge counts, degree distribution)  
- `internal/embedding/runtime.go` — Embedding interface  
- `internal/embedding/custom_api.go` — Private API provider (OpenAI-compatible endpoint)  
- `internal/embedding/batch.go` — Batch embedding worker (up to 100 texts/batch)

**NLP extraction flow**
```
TextChunk → LLM (custom API) → {
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

**Patterns borrowed from RAD system**
- GraphNode/GraphEdge struct patterns, build→validate→publish cycle, traversal patterns  
- LLM runtime interface patterns (for extraction calls)  
- Confidence scoring patterns

---

## Phase 3: Hybrid Retrieval Pipeline + Q&A

**Goal**: Answer natural language questions using graph search + semantic retrieval.

**Packages**: `internal/retrieval/`

**Key files**
- `retriever.go` — Main orchestrator: 8-stage pipeline  
- `intent_detector.go` — Enterprise intents (find_expert, find_document, find_project_info, find_technology_usage, general_question)  
- `permission_filter.go` — Filter results by user’s M365 permissions  
- `semantic_search.go` — Embed query → search similar text chunks  
- `graph_expander.go` — Expand found entities to related entities (BFS, depth 1–2)  
- `reranker.go` — Rerank combined results  
- `context_packer.go` — Token-aware context assembly  
- `answer_generator.go` — LLM answer generation with source citations  

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

## Phase 4: Self-Improvement Feedback Loop

**Goal**: Collect feedback, analyze trends, re-evaluate low-confidence edges.

**Packages**: `internal/feedback/`

**Key files**
- `store.go` — SQLite-backed feedback storage  
- `analyzer.go` — Analytics: trending answers, low-confidence hotspots  
- `improver.go` — Periodic: re-scan low-confidence edges → re-extract with LLM  
- `exporter.go` — Export conversation pairs for fine-tuning  

### SQLite additions (Phase 4)
```sql
-- User feedback on answers
CREATE TABLE feedback_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    feedback_type TEXT NOT NULL,  -- 'like', 'dislike', 'flag'
    comment TEXT,
    created_at TEXT NOT NULL
);

-- Query history for analytics
CREATE TABLE query_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    query_text TEXT NOT NULL,
    intent TEXT,
    results_count INTEGER,
    latency_ms INTEGER,
    created_at TEXT NOT NULL
);

-- Per-edge confidence tracking
CREATE TABLE extraction_confidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    confidence REAL NOT NULL,
    feedback_score REAL,         -- derived from feedback
    last_reevaluated TEXT,
    created_at TEXT NOT NULL
);
```

**Patterns borrowed from RAD system**
- Confidence scoring patterns  
- Periodic job pattern for re-evaluation  
- Metrics collection patterns  

---

## Phase 5: Frontend — Enterprise Knowledge Dashboard

**Goal**: React frontend with Q&A, entity browser, graph visualization, feedback, and admin.

**Key pages**
- `KnowledgeSearch.tsx` — Natural language Q&A with chat interface, source citations, feedback buttons  
- `EntityBrowser.tsx` — Filterable list of entities by type + relationship detail view  
- `BusinessGraph.tsx` — Interactive graph visualization (React Flow / D3.js), filtering, clickable nodes  
- `FeedbackReview.tsx` — Admin interface to review flagged answers, adjust confidence scores  
- `DataSourcesPage.tsx` — Configure M365 connections, view sync status, trigger manual sync  
- `LoginPage.tsx` — Entra ID login + local JWT fallback  
- `DashboardPage.tsx` — Overview: recent queries, sync status, graph stats, feedback trends  

**Patterns borrowed from RAD frontend**
- Axios client with interceptors, WebSocket hook, chat UI, graph visualization, Zustand state, TanStack Query hooks, i18n (en/vi), Shadcn/ui components

---

## Phase 6: Permission-Aware Retrieval (refinement)

**Goal**: Ensure every retrieval respects M365 permissions. This is refined into a continuous concern, with full implementation in Phase 3.

- Permission filtering is Stage 0 of the retrieval pipeline  
- At ingestion time, each document is tagged with its M365 ACL entries  
- The retrieval pipeline filters results by the authenticated user’s cached permissions  
- `internal/connectors/permissions.go` handles ACL extraction and cache refresh  

---

## MS Graph API Scopes

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

## Configuration

Key environment variables:

| Variable | Purpose | Default |
|---|---|---|
| `HOST` | Server bind address | `0.0.0.0` |
| `PORT` | Server port | `8080` |
| `DATA_DIR` | SQLite data directory | `~/.m365kg/data` |
| `M365_TENANT_ID` | Microsoft Entra tenant ID | (required) |
| `M365_CLIENT_ID` | App registration client ID | (required) |
| `M365_CLIENT_SECRET` | App registration client secret | (required) |
| `M365_AUTH_MODE` | Auth mode | `entra_id` |
| `NEO4J_URI` | Neo4j connection URI | `bolt://localhost:7687` |
| `NEO4J_USERNAME` | Neo4j username | `neo4j` |
| `NEO4J_PASSWORD` | Neo4j password | (required) |
| `LLM_API_BASE_URL` | Custom LLM API endpoint | (required) |
| `LLM_API_KEY` | Custom LLM API key | (optional) |
| `LLM_MODEL` | Model name for completions | `gpt-4o-mini` |
| `LLM_EMBED_MODEL` | Model for embeddings | `text-embedding-3-small` |
| `JWT_SECRET` | JWT secret (demo mode) | (auto-generated) |
| `ALLOWED_ORIGINS` | CORS origins | `http://localhost:5173` |
| `DELTA_SYNC_INTERVAL` | Delta sync interval | `5m` |

---

## Files to Create

### Go Backend — New packages
*(Table content translated; structure preserved.)*
- `internal/auth/` — `entra_id.go`, `jwt.go`, `middleware.go`: Authentication  
- `internal/connectors/` — `client.go`, `auth.go`, `onedrive.go`, `teams.go`, `delta.go`, `permissions.go`: M365 connectors  
- `internal/parsers/` — `docx.go`, `xlsx.go`, `pptx.go`, `pdf.go`, `text.go`: Document parsers  
- `internal/nlp/` — `extractor.go`, `prompt.go`, `types.go`, `confidence.go`: NLP extraction  
- `internal/graph/` — `types.go`, `builder.go`, `neo4j_store.go`, `neo4j_query.go`, `traversal.go`, `stats.go`: Business graph  
- `internal/retrieval/` — `retriever.go`, `intent_detector.go`, `permission_filter.go`, `semantic_search.go`, `graph_expander.go`, `reranker.go`, `context_packer.go`, `answer_generator.go`: Q&A pipeline  
- `internal/embedding/` — `runtime.go`, `custom_api.go`, `batch.go`, `store.go`: Embeddings  
- `internal/feedback/` — `store.go`, `analyzer.go`, `improver.go`, `exporter.go`: Feedback loop  
- `internal/metadata/` — `db.go`, `schema.go`, `query.go`: SQLite metadata  
- `internal/scheduler/` — `delta_sync.go`, `reevaluator.go`: Background jobs  
- `internal/websocket/` — `hub.go`: Real-time updates  
- `internal/common/` — `config.go`, `logger.go`, `errors.go`: Utilities  
- `pkg/types/` — `entity.go`, `graph.go`, `retrieval.go`, `feedback.go`: Public types  

**Entry point**
- `cmd/server/main.go` — DI, startup, wire all services

### Frontend pages
- `KnowledgeSearch.tsx` — Main Q&A interface  
- `EntityBrowser.tsx` — Browse entities by type  
- `BusinessGraph.tsx` — Graph visualization  
- `FeedbackReview.tsx` — Review flagged answers  
- `DataSourcesPage.tsx` — Configure M365 connections  
- `LoginPage.tsx` — Entra ID / JWT login  
- `DashboardPage.tsx` — Overview dashboard  

---

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
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

## Reuse (patterns from RAD system at `/workspace`)

*(Table content translated; references preserved.)*
- Ingestion orchestrator, graph model, graph builder cycle, LLM runtime interface, SmartRouter provider selection pattern  
- 7-stage retrieval pipeline → extended to 8-stage pipeline (permission filter added)  
- Intent detection, context packing, permission filtering, confidence scoring, epoch atomicity, JWT auth, WebSocket hub  
- Error wrapping, config validation  
- Frontend patterns: Axios client, TanStack Query hooks, Zustand store, WebSocket hook, chat UI, graph visualization, i18n, Shadcn/ui  

---

## Verification

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

## Phases Summary (Implementation Order)

| Phase | Scope | Key Deliverable | Dependencies |
|---|---|---|---|
| 1 | Foundation | M365 connected, files ingested, chunks parsed | None |
| 2 | Knowledge Graph | Entities + relationships in Neo4j | Phase 1 |
| 3 | Q&A Pipeline | Natural language answers with citations | Phase 1, 2 |
| 4 | Feedback Loop | Like/dislike → re-evaluation | Phase 3 |
| 5 | Frontend | Full dashboard UI | Phase 1–3 |
| 6 | Permissions | Full permission-aware retrieval | Phase 1, 3 |
