## IPA Specification — REQ-M365-001: Enterprise Knowledge Graph from Microsoft 365 

### 1) Executive Summary 
Hệ thống “Enterprise Knowledge Graph” ingest dữ liệu nội bộ từ Microsoft 365 (OneDrive + Teams), trích xuất entity/relationship bằng NLP (LLM qua custom API), xây dựng Knowledge Graph trên Neo4j, và trả lời Q&A theo ngữ cảnh, có trích dẫn nguồn và tuân thủ quyền truy cập (permission-aware). Hệ thống tự cải thiện qua feedback like/dislike/flag và re-evaluation định kỳ các tri thức low-confidence. 

---

### 2) Background & Goals 
**User goal**: “Xây dựng hệ thống thông minh tự học từ dữ liệu nội bộ (OneDrive, Teams) để trả lời chính xác theo ngữ cảnh; dùng Knowledge Graph, NLP entity extraction, hybrid retrieval (graph + semantic), và self-improving feedback loop.” 

**POC scope**: 1 phòng ban (~50 users), ~10K docs, ~500K messages; xử lý theo batch và pipeline robust. 

**Locked decisions**: Tách project `m365-knowledge-graph/`; Auth Entra ID SSO + Local JWT demo; NER qua custom OpenAI-compatible API; Graph DB Neo4j; sync bằng delta queries (MS Graph API); stack Go backend + React/TS frontend; SQLite cho metadata + Neo4j cho graph. 

---

### 3) Current State (from spec) 
- Đây là đặc tả Draft cho hệ thống mới; tái sử dụng “pattern” từ RAD Knowledge Gateway (orchestrator, epoch atomicity, retrieval pipeline, graph builder cycle, LLM runtime interface, React stack), nhưng connector/domain/graph model là mới. 
- Đã xác định đầy đủ project structure, phases, schema SQLite cho Phase 1 & Phase 4, Neo4j schema, retrieval pipeline 8 stages, API endpoints, và test/acceptance flow. 

---

### 4) Scope / Out of Scope 
**In scope**
- Kết nối M365 (OneDrive/SharePoint + Teams) qua MS Graph API; incremental sync bằng delta query + lưu changeToken. 
- Parse docx/xlsx/pptx/pdf/txt + chat message thành text chunks. 
- NLP extraction entity/relationship bằng LLM custom API + confidence scoring. 
- Build graph trên Neo4j (upsert/dedup) + query/traversal. 
- Hybrid retrieval: semantic + graph expansion + rerank + context packing + answer generation có citations; permission filter là Stage 0. 
- Feedback loop: like/dislike/flag; analytics; re-evaluate low-confidence edges; export fine-tuning pairs. 
- Frontend dashboard (Q&A, entity browser, graph viz, feedback review, data sources, login, dashboard). 

**Out of scope**
- Spec không mô tả triển khai infra/CI/CD chi tiết hay chiến lược multi-department beyond POC (chỉ nêu POC scope). 

---

## 5) Architecture Design 

### 5.1 High-level Architecture 
**Major components**
1. **Auth Layer**: Entra ID SSO (OIDC OAuth2) + Local JWT fallback demo.   
2. **M365 Connectors**: MS Graph client + token mgmt + OneDrive ingestor + Teams ingestor + delta coordinator + permissions extraction/cache.   
3. **Parsing Pipeline**: Parsers docx/xlsx/pptx/pdf/txt + chunking.   
4. **Metadata Store (SQLite)**: sync state, file metadata, chunks, connections config, permission_cache; và các bảng feedback/query logs/confidence tracking (Phase 4).   
5. **NLP/Embedding**: LLM-based extractor (custom API) + embedding runtime + batch embedding.   
6. **Knowledge Graph (Neo4j)**: graph builder cycle build→validate→publish; query patterns; traversal/stats.   
7. **Hybrid Retrieval (8-stage)**: permission filter → intent → query NER → concurrent graph query + semantic search → merge/dedup → rerank → context pack → answer generation (LLM, citations).   
8. **Scheduler + WebSocket**: delta sync định kỳ; reevaluator; realtime updates về progress.   
9. **Frontend (React/TS)**: TanStack Query + Zustand + Shadcn/ui; các page theo spec. 

### 5.2 Data Flow (end-to-end) 
1. Admin cấu hình M365 connection (`/api/m365/connect`) → lưu `m365_connections` (SQLite).   
2. Delta sync job/manual (`/api/m365/sync`) → Graph API delta query → cập nhật `delta_state`, upsert `m365_files`, refresh `permission_cache`.   
3. Download/parse nội dung → chunker → insert/update `chunks`.   
4. NLP extraction trên chunks → entities/relationships + confidence → graph builder dedup/upsert Neo4j; đồng thời embeddings batch để phục vụ semantic search (storage theo pattern: SQLite FTS + Neo4j).   
5. User query (`/api/knowledge/query`): chạy pipeline 8 stages (permission-aware) → answer + sources + entities.   
6. User feedback (`/api/feedback`) → lưu feedback_events; analytics (`/api/feedback/stats`); reevaluator/improver định kỳ rescan low-confidence.   

### 5.3 Key Architectural Constraints / Decisions 
- Neo4j là graph store chính; SQLite giữ metadata và feedback.   
- Incremental sync bắt buộc dùng delta queries để hiệu quả với volume 10K+ docs và 500K+ messages.   
- Permission filtering là concern xuyên suốt và là Stage 0 của retrieval pipeline; ingestion tag ACL và cache mapping user↔file.   
- LLM integration qua custom OpenAI-compatible endpoint cho NER/extraction và answer generation; embedding model cấu hình riêng.   

---

## 6) API Design 

### 6.1 API Endpoints (as specified) 
**Auth**
- `POST /api/auth/login` — Entra ID / JWT login.   
- `POST /api/auth/token/refresh` — refresh auth token. 

**M365 sources & sync**
- `POST /api/m365/connect` — configure M365 connection.   
- `GET /api/m365/sources` — list connected data sources.   
- `POST /api/m365/sync` — trigger data sync.   
- `GET /api/m365/sync/status` — get sync status. 

**Knowledge / Q&A**
- `POST /api/knowledge/query` — natural language Q&A. 

**Feedback**
- `POST /api/feedback` — submit like/dislike.   
- `GET /api/feedback/stats` — feedback analytics. 

**Entities / Graph**
- `GET /api/entities` — list/browse entities.   
- `GET /api/entities/:id` — entity detail.   
- `GET /api/graph/nodes` — graph nodes.   
- `GET /api/graph/edges` — graph edges.   
- `GET /api/graph/path` — find path between entities. 

**Stats / Realtime**
- `GET /api/stats/overview` — dashboard statistics.   
- `WS /ws?token=<JWT>` — realtime updates (sync progress, etc.). 

### 6.2 API Behavior Requirements (implied by acceptance flow) 
- Login via Entra ID → nhận JWT → các request sau được authorize.   
- Sync endpoint khởi chạy delta sync và WebSocket phát progress events.   
- Q&A trả về “contextual answer with citations”.   
- Entity/graph endpoints dùng để verify ingestion/extraction/graph build.   
- Permission-aware: user chỉ thấy entities trong phạm vi quyền M365. 

---

## 7) Database Design 

### 7.1 SQLite (Metadata + Feedback) 

**Phase 1 tables**
- `delta_state(source PK, change_token, has_more, last_sync_at)` — lưu change token cho delta queries theo từng source.   
- `m365_files(id PK, source_type, source_id, file_name, file_type, file_size, content_hash, last_modified, created_at, permissions_json)` — metadata tài liệu / Teams message; lưu ACL dạng JSON.   
- `chunks(id PK, file_id FK, chunk_index, text, content_hash, heading_path, UNIQUE(file_id, chunk_index))` — text chunks sau parse/chunking.   
- `m365_connections(id PK, name, type, tenant_id, config_json, status, created_at)` — cấu hình kết nối.   
- `permission_cache(user_id, file_id FK, permission, PRIMARY KEY(user_id, file_id))` — cache quyền user↔file. 

**Phase 4 tables**
- `feedback_events(id PK, query_id, user_id, feedback_type, comment, created_at)` — like/dislike/flag.   
- `query_logs(id PK, user_id, query_text, intent, results_count, latency_ms, created_at)` — lịch sử query phục vụ analytics.   
- `extraction_confidence(id PK, entity_id, relationship_type, target_entity_id, confidence, feedback_score, last_reevaluated, created_at)` — theo dõi confidence/feedback score cho edge. 

### 7.2 Neo4j (Knowledge Graph) 
**Node labels** (theo schema mẫu)
- `:Person`, `:Project`, `:Document`, `:Technology`, `:Customer`, `:Department`, `:Chunk`. 

**Relationships** (mẫu)
- Person↔Project (`MANAGES`, `WORKS_ON`), Person→Department (`BELONGS_TO`), Document/Chunk `MENTIONS` các entity, Chunk `PART_OF` Document, Project `USES` Technology, Project `SERVING` Customer, Document `CREATED_BY` Person. 

**Indices**: indices cho các thuộc tính như `Person.email`, `Person.displayName`, `Project.name`, `Document.fileName`, `Technology.name`, `Customer.name`, `Department.name`. 

---

## 8) State Machine Specifications 

### 8.1 Delta Sync State Machine (per source in `delta_state`) 
**States**
- `IDLE` (no active sync)   
- `SYNC_RUNNING` (đang gọi delta queries/pagination)   
- `SYNC_PARTIAL_HAS_MORE` (has_more=1, cần tiếp tục)   
- `SYNC_COMPLETED` (has_more=0, cập nhật last_sync_at)   
- `SYNC_FAILED` (lỗi; retry theo client retry/rate limit strategy) 

**Transitions (high-level)**
- IDLE → SYNC_RUNNING khi trigger manual (`/api/m365/sync`) hoặc scheduler `DELTA_SYNC_INTERVAL`.   
- SYNC_RUNNING → SYNC_PARTIAL_HAS_MORE nếu còn trang/has_more.   
- SYNC_PARTIAL_HAS_MORE → SYNC_RUNNING khi tiếp tục lấy delta page tiếp theo.   
- SYNC_RUNNING → SYNC_COMPLETED khi lưu change_token mới và hoàn tất.   
- (SYNC_RUNNING | SYNC_PARTIAL_HAS_MORE) → SYNC_FAILED khi lỗi; sau đó quay về IDLE hoặc retry (spec nêu Graph client có retry/rate limiting).   

### 8.2 Retrieval (Q&A) Pipeline State Machine (per query) 
Theo pipeline 8 stages:
- `STAGE0_PERMISSION_FILTER` → `STAGE1_INTENT` → `STAGE2_QUERY_NER` → parallel: (`STAGE3_GRAPH_QUERY`, `STAGE4_SEMANTIC_SEARCH`) → `MERGE_DEDUP` → `STAGE5_RERANK` → `STAGE6_CONTEXT_PACK` (default 12K tokens) → `STAGE7_ANSWER_GEN` → `DONE`. 

### 8.3 Feedback Improvement Loop State Machine 
- `FEEDBACK_COLLECTED` (insert feedback_events) → `ANALYZED` (feedback analyzer tìm trends/low-confidence hotspots) → `REEVALUATION_SCHEDULED` (scheduler) → `REEXTRACTED` (improver re-scan low-confidence edges, re-extract với LLM) → `GRAPH_UPDATED` (update confidence/edges) → quay lại steady-state. 

---

## 9) Testing Strategy 

### 9.1 Backend Tests 
- Unit tests theo package:
  - `go test ./internal/connectors/...`   
  - `go test ./internal/nlp/...`   
  - `go test ./internal/graph/...`   
  - `go test ./internal/retrieval/...`   
  - `go test ./internal/feedback/...`   
  - `go test ./...` 
- Integration tests (mock MS Graph API + test Neo4j):
  - `go test -tags=integration ./tests/integration/...`   
  - Có `tests/integration/m365_mock.go` và `tests/integration/retrieval_test.go`. 

### 9.2 Frontend Tests 
- Unit tests: `npm run test`   
- E2E tests: `npm run test:e2e` 

---

## 10) Acceptance Criteria (E2E Acceptance Flow) 
Hệ thống đạt acceptance khi chạy được luồng:
1. **Auth**: user login Entra ID → nhận JWT → request sau authorized.   
2. **Connect**: admin cấu hình connection → `/api/m365/connect` trả 200.   
3. **Sync**: trigger delta sync → `/api/m365/sync` start, WebSocket emit progress.   
4. **Ingest**: verify documents imported → `/api/entities?type=document` trả entities.   
5. **Extract**: verify NER ran → `/api/entities?type=person` và `type=project` có dữ liệu.   
6. **Graph**: `/api/graph/nodes` có nodes và `/api/graph/edges` có edges.   
7. **Query**: `/api/knowledge/query` trả câu trả lời theo ngữ cảnh kèm citations.   
8. **Feedback**: `/api/feedback` ghi nhận like/dislike.   
9. **Analytics**: `/api/feedback/stats` hiển thị phân phối feedback.   
10. **Permissions**: user chỉ thấy entities trong scope quyền M365.   
11. **Delta sync**: sửa doc OneDrive → delta sync sau bắt được thay đổi. 

---

## 11) Open Questions / Missing Detail (explicitly not specified) 
- Spec nêu “Embedding storage (SQLite FTS + Neo4j)” nhưng không đưa schema bảng embedding cụ thể trong SQLite/Neo4j.   
- Chưa có định nghĩa chi tiết request/response schema (JSON) cho từng endpoint (chỉ có danh sách endpoint và mục đích).   
- Chưa mô tả rõ chiến lược “epoch-style atomic visibility” áp dụng cụ thể cho sync publish trong hệ mới (chỉ nói mượn pattern).   

---

## 12) Implementation Plan (Phases) 
Thứ tự triển khai theo spec:
1. Phase 1 Foundation (Auth + connectors + parsers + SQLite schema nền).   
2. Phase 2 NLP extraction + Neo4j graph.   
3. Phase 3 Hybrid retrieval Q&A (8-stage).   
4. Phase 4 Feedback loop + re-evaluation.   
5. Phase 5 Frontend dashboard.   
6. Phase 6 Permission refinement (được coi là concern liên tục; fully implemented trong Phase 3).   

--- 

## 1) Detailed API Contracts (JSON) + Error Model

### 1.1 Common Conventions

**Headers**
- `Content-Type: application/json`
- `Authorization: Bearer <access_token>` (for protected endpoints)

**Correlation / logging fields**
- All requests should carry (or the gateway should inject) a request id that is logged with every event: `req_id`. Errors must be written to a structured log including `timestamp, level, req_id, ip, user_id, event, error`. 

---

### 1.2 Error Model (standardized)

**Error response (all endpoints)**
```json
{
  "error": {
    "code": "string",
    "message": "string",
    "req_id": "string",
    "details": { "any": "json" }
  }
}
```

**Notes**
- On rate limit violation return HTTP **429**. 
- Errors must be logged to structured logs with `timestamp, level, req_id, ip, user_id, event, error`. 
- Login attempts must be logged asynchronously into `login_events` table (must not block response). 

**Suggested error codes (aligned to tasks/DoD)**
- `AUTH_INVALID_CREDENTIALS`
- `AUTH_TOKEN_EXPIRED`
- `AUTH_TOKEN_REVOKED`
- `AUTH_REFRESH_INVALID`
- `RATE_LIMITED`
- `VALIDATION_ERROR`
- `INTERNAL_ERROR`

(Only the 429 requirement and structured logging requirement are explicitly defined; the exact code strings are a proposal to make the error model actionable.) 

---

## 2) Auth Endpoints — Detailed Contracts

Background indicates **Auth endpoints**: `login`, `logout`, `refresh`, with DoD including **TokenService issue/verify/revoke**, **RevocationStore**, **rate limiting middleware**, **argon2id verify**, and **password policy integration**. 

### 2.1 POST `/api/auth/login`

**Purpose**
- Verify credentials via UserService against User Store, using **Argon2id verify** (hash verify, do not expose plaintext). 
- Issue access + refresh tokens via TokenService. 
- Log every login attempt to `login_events` asynchronously. 

**Request**
```json
{
  "identifier": "string",
  "password": "string",
  "device": {
    "device_id": "string",
    "device_name": "string"
  }
}
```

**Response 200**
```json
{
  "access_token": "string",
  "access_token_expires_at": "RFC3339 timestamp string",
  "refresh_token": "string",
  "refresh_token_expires_at": "RFC3339 timestamp string",
  "token_type": "Bearer",
  "user": {
    "user_id": "string",
    "identifier": "string"
  }
}
```

**Error responses**
- `401` invalid credentials:
```json
{
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Invalid credentials",
    "req_id": "string",
    "details": {}
  }
}
```
- `429` rate limited (sliding window rate limit middleware): 
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "req_id": "string",
    "details": {
      "retry_after_seconds": 60
    }
  }
}
```

**Logging requirements**
- Log all login attempts to `login_events` asynchronously. 
- Log errors to structured logs (timestamp, level, req_id, ip, user_id, event, error). 

---

### 2.2 POST `/api/auth/refresh`

**Purpose**
- Verify refresh token and issue new access token; also support refresh rotation if needed.
- Must support `issue/verify/expire/revoke` behaviors per TokenService DoD. 

**Request**
```json
{
  "refresh_token": "string"
}
```

**Response 200**
```json
{
  "access_token": "string",
  "access_token_expires_at": "RFC3339 timestamp string",
  "refresh_token": "string",
  "refresh_token_expires_at": "RFC3339 timestamp string",
  "token_type": "Bearer"
}
```

**Error responses**
- `401` invalid/expired refresh:
```json
{
  "error": {
    "code": "AUTH_REFRESH_INVALID",
    "message": "Refresh token is invalid or expired",
    "req_id": "string",
    "details": {}
  }
}
```
- `401` revoked refresh:
```json
{
  "error": {
    "code": "AUTH_TOKEN_REVOKED",
    "message": "Refresh token has been revoked",
    "req_id": "string",
    "details": {}
  }
}
```

**Logging**
- Errors logged to structured logs. 

---

### 2.3 POST `/api/auth/logout`

**Purpose**
- Revoke refresh token into Revocation Store when logout is called. 
- Background explicitly states: “Revoke refresh token into Revocation Store when logout.” 

**Request**
```json
{
  "refresh_token": "string"
}
```

**Response 200**
```json
{
  "ok": true
}
```

**Error responses**
- `401` if token invalid (optional enforcement):
```json
{
  "error": {
    "code": "AUTH_REFRESH_INVALID",
    "message": "Refresh token is invalid",
    "req_id": "string",
    "details": {}
  }
}
```

**Logging**
- Errors logged to structured logs. 

---

## 3) User / Password Policy Integration (API touchpoints)

Background tasks mention “password policy integration validator, signup change pwd”.   
The auth service design states it verifies credentials via User Store. 

If these endpoints exist in your gateway, define:

### 3.1 POST `/api/auth/signup` (if applicable)

**Request**
```json
{
  "identifier": "string",
  "password": "string"
}
```

**Validation**
- Apply password policy validator (as required by tasks). 

**Response 201**
```json
{
  "user_id": "string",
  "identifier": "string"
}
```

### 3.2 POST `/api/auth/change-password` (if applicable)

**Request**
```json
{
  "old_password": "string",
  "new_password": "string"
}
```

**Validation**
- Apply password policy validator. 

**Response 200**
```json
{ "ok": true }
```

(Endpoints are implied by “signup/change pwd” in tasks; exact paths are not specified in the provided background, so treat these as proposed contracts aligned to the tasks.) 

---

## 4) Embedding Schema (for `internal/embedding/` module)

The background documents do **not** provide any existing embedding schema details. They only describe auth-service components and general task items.   
So the schema below is a **proposed PostgreSQL embedding schema** consistent with:
- A PostgreSQL user DB is present in the architecture components. 
- A “schema migration script” DoD exists, implying DB migrations are part of the workflow. 

### 4.1 Goals for Embedding Schema
- Store embeddings produced by the embedding runtime and allow lookup by:
  - source item (file/message)
  - chunk id/index
  - embedding model/version
- Support re-embedding when model changes.
- Support integrity and traceability for retrieval.

### 4.2 Proposed Tables (PostgreSQL)

#### `embedding_models`
Tracks what model produced which vectors.
```sql
CREATE TABLE embedding_models (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT,
  dims INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, COALESCE(version, ''))
);
```

#### `chunk_embeddings`
Stores one embedding per chunk per model.
```sql
CREATE TABLE chunk_embeddings (
  id BIGSERIAL PRIMARY KEY,
  chunk_id BIGINT NOT NULL,              -- references your chunks table id
  model_id BIGINT NOT NULL REFERENCES embedding_models(id),
  embedding BYTEA NOT NULL,              -- store serialized float32 array (implementation-defined)
  embedding_hash TEXT,                   -- optional, for dedupe/integrity
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chunk_id, model_id)
);

CREATE INDEX idx_chunk_embeddings_chunk ON chunk_embeddings(chunk_id);
CREATE INDEX idx_chunk_embeddings_model ON chunk_embeddings(model_id);
```

#### `embedding_jobs` (optional but recommended for batch/backfill)
Tracks batch embedding generation.
```sql
CREATE TABLE embedding_jobs (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL,                  -- 'queued'|'running'|'succeeded'|'failed'
  model_id BIGINT NOT NULL REFERENCES embedding_models(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT
);
```

### 4.3 Notes / Constraints
- If you plan to do ANN search in Postgres, you’d typically use a vector type/extension; however, the provided background does not mention this, so the schema stores the embedding as `BYTEA` (implementation-defined serialization). 
- Migrations: “schema migration script” is explicitly in tasks/DoD; the above should be delivered as migrations. 

---

## 5) Implementation/DoD Traceability (from background)

- **Schema + migration script** must run successfully. 
- **UserService lookup** and **Argon2id verify** (hash verify, do not expose plaintext). 
- **TokenService** must support issue/verify/expire/revoke. 
- **RateLimitMiddleware** must implement sliding window and return **429**. 
- **Auth endpoints** login/logout/refresh must pass AC00101.05. 
- **Logging**: async login attempt logging to `login_events`; structured error logging. 
- **Components**: Auth Service interacts with UserService + UserDB PostgreSQL; revocation stored in Redis/in-memory per design. 

---

## Open Questions (needed to finalize contracts precisely)
1) What are the exact existing endpoint paths for signup/change-password (if they exist), and what is AC00101.05’s detailed criteria?   
2) What is the canonical identifier type for user login (email/username)? (background only says “lookup” and “credentials”).   
3) What is the canonical `chunks` table schema in your metadata DB so `chunk_id` can be a real FK? (not provided in background). 