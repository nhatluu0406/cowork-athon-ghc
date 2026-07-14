# Đặc tả tính năng: Knowledge Graph Doanh nghiệp từ Microsoft 365

**ID tính năng**: REQ-M365-001
**Ngày tạo**: 2026-07-09
**Trạng thái**: Bản nháp
**Tác giả**: speckit-planner
**Nhánh mục tiêu**: `001-m365-knowledge-graph`

> **Nguồn gốc**: File này hợp nhất `spec_1.1.md`, `spec_1.2.md`, và `spec_1.3.md` (các bản nháp trước đó khác biệt nhau) thành spec chuẩn, thay thế cả ba. Ba xung đột phát sinh trong quá trình hợp nhất đã được giải quyết bằng quyết định rõ ràng:
> 1. **Công cụ DB metadata → PostgreSQL** (không phải SQLite). Tất cả schema bên dưới dùng PostgreSQL DDL hợp lệ.
> 2. **Auth → Microsoft Entra ID SSO + Local JWT (demo fallback)** đã xác nhận. Thiết kế auth username/password chung (Argon2id, UserService/UserDB, `login_events`) được đề xuất trong `spec_1.3.md` không áp dụng cho tính năng này và đã được loại bỏ.
> 3. **Lưu trữ Embedding → PostgreSQL** (`embedding_models` / `chunk_embeddings` / `embedding_jobs`), thay thế các tham chiếu "SQLite FTS" trước đó.

**Đầu vào (mô tả từ người dùng)**:
> "Xây dựng một hệ thống thông minh có khả năng tự học hỏi từ dữ liệu nội bộ của công ty (lưu trữ trên OneDrive và Teams) để trả lời câu hỏi và cung cấp thông tin một cách chính xác, theo ngữ cảnh. Hệ thống sử dụng Knowledge Graph, NLP entity extraction, hybrid retrieval (graph + semantic), và self-improving feedback loop."

---

## 1) Các quyết định đã chốt (từ phiên lập kế hoạch)

| Quyết định | Lựa chọn | Lý do |
|---|---|---|
| Kiến trúc | Dự án riêng biệt (`m365-knowledge-graph/`) | Tách biệt rõ ràng, triển khai độc lập, dùng chung pattern từ RAD |
| Auth | Microsoft Entra ID SSO + Local JWT (demo) | Tích hợp native với M365; JWT fallback cho test/demo |
| LLM cho NER | Custom API endpoint | Server LLM nội bộ, giao thức tương thích OpenAI |
| Graph DB | Neo4j | Được thiết kế chuyên cho đồ thị, truy vấn phức tạp, dữ liệu quy mô doanh nghiệp |
| Chiến lược đồng bộ | Delta queries (MS Graph API) | Hiệu quả, gần thời gian thực, đồng bộ tăng dần native |
| Phạm vi POC | 1 phòng ban | ~50 người dùng, ~10K tài liệu, ~500K tin nhắn |
| Khối lượng dữ liệu | 10K+ tài liệu, 500K+ tin nhắn | Xử lý theo lô, pipeline mạnh mẽ |
| Ngôn ngữ | Go (backend) + React/TypeScript (frontend) | Cùng stack với hệ thống RAD để đội ngũ quen thuộc |
| Database | **PostgreSQL** (metadata + embeddings) + Neo4j (graph) | Pattern RAD: kho metadata nhẹ + kho đồ thị chuyên dụng |

---

## 2) Tổng quan

Enterprise Knowledge Graph là hệ thống thông minh thu thập dữ liệu công ty từ Microsoft 365 (OneDrive + Teams), trích xuất thực thể nghiệp vụ và quan hệ giữa chúng qua NLP, xây dựng cơ sở tri thức dạng đồ thị, và trả lời câu hỏi ngôn ngữ tự nhiên với các phản hồi chính xác, theo ngữ cảnh, và có nhận biết quyền truy cập. Hệ thống cải thiện theo thời gian thông qua phản hồi người dùng (like/dislike) và đánh giá lại định kỳ các tri thức có độ tin cậy thấp.

**Nguồn pattern**: Kiến trúc được vay mượn từ hệ thống **RAD Knowledge Gateway** (`/workspace`) — cụ thể là pattern orchestrator ingestion, epoch-style atomic visibility, pipeline retrieval 7 giai đoạn, chu trình graph builder, LLM runtime interface, và cấu trúc frontend React (TanStack Query + Zustand + Shadcn/ui). Tuy nhiên, domain dữ liệu, mô hình graph, và connector hoàn toàn mới.

**Phạm vi POC**: 1 phòng ban (~50 người dùng), ~10K tài liệu, ~500K tin nhắn; xử lý theo lô với pipeline thiết kế mạnh mẽ.

### Phạm vi / Ngoài phạm vi

**Trong phạm vi**
- Kết nối với M365 (OneDrive/SharePoint + Teams) qua MS Graph API; đồng bộ tăng dần qua delta query + lưu trữ changeToken.
- Parse docx/xlsx/pptx/pdf/txt + tin nhắn chat thành các chunk văn bản.
- Trích xuất entity/relationship NLP qua custom LLM API + chấm điểm độ tin cậy.
- Xây dựng graph trong Neo4j (upsert/dedup) + truy vấn/traversal.
- Hybrid retrieval: semantic + mở rộng graph + rerank + đóng gói ngữ cảnh + sinh câu trả lời có trích dẫn; lọc quyền là Stage 0.
- Feedback loop: like/dislike/flag; phân tích; đánh giá lại các cạnh có độ tin cậy thấp; xuất cặp dữ liệu fine-tuning.
- Dashboard frontend (Q&A, entity browser, trực quan hóa graph, review feedback, nguồn dữ liệu, đăng nhập, dashboard).

**Ngoài phạm vi**
- Chiến lược triển khai chi tiết hạ tầng/CI-CD hoặc mở rộng đa phòng ban vượt ngoài phạm vi POC đã nêu.

---

## 3) Kiến trúc (Tóm tắt Quyết định)

| Chiều | RAD Knowledge Gateway (nguồn pattern) | Hệ thống mới |
|---|---|---|
| *Chưa được điền trong bất kỳ bản nào* | | |

**Khoảng trống**: bảng này nhằm đưa ra so sánh song song, giải thích cái gì được tái sử dụng vs. mới theo từng chiều kiến trúc (tầng dữ liệu, auth, retrieval, v.v.). Chưa bao giờ được điền — được gắn cờ là một mục còn mở.

### 3.1 Thành phần cấp cao

1. **Tầng Auth**: Entra ID SSO (OIDC/OAuth2) + Local JWT fallback (demo).
2. **M365 Connectors**: MS Graph client + quản lý token + OneDrive ingestor + Teams ingestor + delta coordinator + trích xuất/cache quyền.
3. **Pipeline Parsing**: parser docx/xlsx/pptx/pdf/txt + chunking.
4. **Kho Metadata (PostgreSQL)**: trạng thái đồng bộ, metadata file, chunk, cấu hình kết nối, permission_cache, embeddings; cộng thêm bảng feedback/query-log/confidence (Phase 4).
5. **NLP/Embedding**: extractor dựa trên LLM (custom API) + embedding runtime + batch embedding.
6. **Knowledge Graph (Neo4j)**: chu trình build→validate→publish; các pattern truy vấn; traversal/thống kê.
7. **Hybrid Retrieval (8 giai đoạn)**: lọc quyền → intent → query NER → truy vấn graph song song + semantic search → merge/dedup → rerank → đóng gói ngữ cảnh → sinh câu trả lời (LLM, trích dẫn).
8. **Scheduler + WebSocket**: đồng bộ delta định kỳ; reevaluator; cập nhật tiến trình realtime.
9. **Frontend (React/TS)**: TanStack Query + Zustand + Shadcn/ui.

### 3.2 Luồng dữ liệu đầu-cuối

1. Admin cấu hình kết nối M365 (`/api/m365/connect`) → lưu vào `m365_connections` (PostgreSQL).
2. Delta sync (theo lịch hoặc thủ công qua `/api/m365/sync`) → truy vấn delta Graph API → cập nhật `delta_state`, upsert `m365_files`, làm mới `permission_cache`.
3. Tải nội dung/parse → chunker → insert/update `chunks`.
4. Trích xuất NLP trên các chunk → entity/relationship + độ tin cậy → graph builder dedup/upsert vào Neo4j; embeddings được sinh theo lô và lưu trong `chunk_embeddings` cho semantic search.
5. Truy vấn người dùng (`/api/knowledge/query`) → chạy pipeline 8 giai đoạn (nhận biết quyền) → câu trả lời + nguồn + entity.
6. Phản hồi người dùng (`/api/feedback`) → lưu trong `feedback_events`; phân tích qua `/api/feedback/stats`; reevaluator/improver định kỳ quét lại các cạnh có độ tin cậy thấp.

### 3.3 Ràng buộc kiến trúc chính

- Neo4j là kho graph chính; PostgreSQL chứa metadata, embeddings, và feedback.
- Đồng bộ tăng dần phải dùng delta query để hiệu quả ở quy mô 10K+ tài liệu / 500K+ tin nhắn.
- Lọc quyền là mối quan tâm xuyên suốt và là Stage 0 của pipeline retrieval; ingestion gắn thẻ ACL và cache ánh xạ user↔file.
- Tích hợp LLM qua custom endpoint tương thích OpenAI cho NER/extraction và sinh câu trả lời; embedding model được cấu hình riêng.

---

## 4) Cách tiếp cận

### 4.1 Cấu trúc dự án Backend

```
m365-knowledge-graph/
├── cmd/server/main.go              # Điểm vào, DI, khởi động
├── internal/
│   ├── api/                        # HTTP handlers, router, middleware
│   │   ├── router.go              # Đăng ký route
│   │   ├── middleware.go          # CORS, auth, logging
│   │   ├── handlers_m365.go       # Endpoint kết nối M365
│   │   ├── handlers_knowledge.go  # Endpoint Q&A
│   │   ├── handlers_entities.go   # Endpoint entity browser
│   │   ├── handlers_feedback.go   # Endpoint feedback
│   │   └── handlers_graph.go      # Endpoint trực quan hóa graph
│   │
│   ├── auth/                       # Xác thực
│   │   ├── entra_id.go            # Microsoft Entra ID SSO (OAuth2/OIDC)
│   │   └── jwt.go                 # Local JWT fallback (demo mode)
│   │
│   ├── connectors/                 # Kết nối Microsoft 365
│   │   ├── client.go              # MS Graph API client (HTTP + retry)
│   │   ├── auth.go                # Quản lý token OAuth2 (client credentials + delegated)
│   │   ├── onedrive.go            # Ingest file OneDrive/SharePoint
│   │   ├── teams.go               # Ingest chat/channel/message Teams
│   │   ├── delta.go               # Delta query coordinator (đồng bộ tăng dần)
│   │   └── permissions.go         # Trích xuất và cache quyền M365
│   │
│   ├── parsers/                    # Parser tài liệu
│   │   ├── docx.go                # Parser tài liệu Word
│   │   ├── xlsx.go                # Parser bảng tính Excel
│   │   ├── pptx.go                # Parser PowerPoint
│   │   ├── pdf.go                 # Trích xuất văn bản PDF
│   │   └── text.go                # Chunker văn bản thuần
│   │
│   ├── nlp/                        # Trích xuất entity NLP
│   │   ├── extractor.go           # Trích xuất entity + relationship dựa trên LLM
│   │   ├── prompt.go              # Prompt trích xuất cho custom LLM
│   │   ├── types.go               # Kiểu entity/relationship
│   │   └── confidence.go          # Chấm điểm độ tin cậy cho mỗi trích xuất
│   │
│   ├── graph/                      # Knowledge graph nghiệp vụ
│   │   ├── types.go               # GraphNode/GraphEdge cho domain nghiệp vụ
│   │   ├── builder.go             # GraphBuilder (build→validate→publish)
│   │   ├── neo4j_store.go         # Backend lưu trữ Neo4j
│   │   ├── neo4j_query.go         # Các pattern truy vấn Cypher
│   │   ├── traversal.go           # Tiện ích traversal graph
│   │   └── stats.go               # Thống kê graph
│   │
│   ├── retrieval/                  # Pipeline hybrid retrieval
│   │   ├── retriever.go           # Orchestrator retrieval chính
│   │   ├── intent_detector.go     # Phát hiện intent doanh nghiệp
│   │   ├── permission_filter.go   # Lọc theo quyền (Stage 0)
│   │   ├── semantic_search.go     # Tìm kiếm vector/neural
│   │   ├── graph_expander.go      # Mở rộng dựa trên graph
│   │   ├── reranker.go            # Xếp hạng lại kết quả
│   │   ├── context_packer.go      # Đóng gói ngữ cảnh theo token
│   │   └── answer_generator.go    # Sinh câu trả lời LLM có trích dẫn
│   │
│   ├── embedding/                  # Sinh embedding
│   │   ├── runtime.go             # Interface embedding runtime
│   │   ├── custom_api.go          # Nhà cung cấp custom private API
│   │   ├── batch.go               # Embedding theo lô (worker pool)
│   │   └── store.go               # Lưu trữ embedding (PostgreSQL: embedding_models/chunk_embeddings/embedding_jobs)
│   │
│   ├── feedback/                   # Vòng lặp tự cải thiện
│   │   ├── store.go               # Lưu trữ feedback (PostgreSQL)
│   │   ├── analyzer.go            # Phân tích feedback và xu hướng
│   │   ├── improver.go            # Cơ chế tự cải thiện
│   │   └── exporter.go            # Xuất dữ liệu fine-tuning
│   │
│   ├── metadata/                   # Kho metadata PostgreSQL
│   │   ├── db.go                  # Interface DB
│   │   ├── schema.go              # Schema và migration
│   │   └── query.go               # Triển khai truy vấn
│   │
│   ├── scheduler/                  # Job nền
│   │   ├── delta_sync.go          # Job đồng bộ delta định kỳ
│   │   └── reevaluator.go         # Đánh giá lại độ tin cậy định kỳ
│   │
│   ├── websocket/                  # Cập nhật realtime
│   │   └── hub.go                 # WebSocket hub (tiến trình sync, v.v.)
│   │
│   └── common/                     # Tiện ích dùng chung
│       ├── config.go              # Cấu hình và validation
│       ├── logger.go              # Logging có cấu trúc
│       └── errors.go              # Kiểu lỗi và wrapping
│
├── pkg/types/                      # Kiểu dùng chung công khai
│   ├── entity.go                  # Kiểu entity nghiệp vụ
│   ├── graph.go                   # Kiểu node/edge graph
│   ├── retrieval.go               # Kiểu retrieval và answer
│   └── feedback.go                # Kiểu feedback
├── go.mod
├── migrations/                     # Migration PostgreSQL
├── scripts/                        # Script build và tiện ích
└── tests/                          # Integration test
    └── integration/
        ├── m365_mock.go           # Mock MS Graph API
        └── retrieval_test.go      # Test retrieval end-to-end
```

### 4.2 Cấu trúc dự án Frontend

```
Frontend/
├── src/
│   ├── api/
│   │   ├── client.ts             # Axios client
│   │   ├── knowledge.ts          # Endpoint Q&A tri thức
│   │   ├── entities.ts           # Endpoint entity browser
│   │   └── feedback.ts           # Endpoint feedback
│   ├── components/
│   │   └── ui/                   # Component UI tái sử dụng
│   ├── hooks/
│   │   ├── useKnowledgeQuery.ts  # Hook truy vấn tri thức
│   │   ├── useEntities.ts        # Hook danh sách entity
│   │   ├── useFeedback.ts        # Hook feedback
│   │   └── useWebSocket.ts       # Cập nhật đồng bộ realtime
│   ├── pages/
│   │   ├── KnowledgeSearch.tsx   # Giao diện Q&A chính
│   │   ├── EntityBrowser.tsx     # Duyệt entity theo loại
│   │   ├── BusinessGraph.tsx     # Trực quan hóa graph
│   │   ├── FeedbackReview.tsx    # Review câu trả lời bị gắn cờ
│   │   ├── DataSourcesPage.tsx   # Cấu hình kết nối M365
│   │   ├── LoginPage.tsx         # Đăng nhập Entra ID / JWT
│   │   └── DashboardPage.tsx     # Dashboard tổng quan
│   ├── store/
│   │   └── useUIStore.ts         # Trạng thái UI Zustand
│   ├── i18n/                     # Đa ngôn ngữ (en, vi)
│   └── types/                    # Kiểu TypeScript
├── package.json
└── vite.config.ts
```

---

## 5) Phase 1: Nền tảng — Auth, M365 Connectors, Document Parsers

**Mục tiêu**: Kết nối với Microsoft 365, thu thập tài liệu, và parse thành các chunk văn bản.

**Package**: `internal/auth/`, `internal/connectors/`, `internal/parsers/`, `internal/metadata/`

**File chính**
- `internal/auth/entra_id.go` — Luồng OIDC với Entra ID: discovery, trao đổi token, refresh
- `internal/auth/jwt.go` — Local JWT fallback cho demo mode
- `internal/connectors/client.go` — MS Graph HTTP client với retry, phân trang, rate limiting
- `internal/connectors/auth.go` — Quản lý token OAuth2 (service principal + delegated token)
- `internal/connectors/onedrive.go` — liệt kê site → drive → file; tải nội dung; trích xuất quyền
- `internal/connectors/teams.go` — liệt kê group → channel → message; trích xuất nội dung chat
- `internal/connectors/delta.go` — delta query coordinator với lưu trữ changeToken
- `internal/connectors/permissions.go` — trích xuất và cache ánh xạ quyền user/file
- `internal/parsers/docx.go` — Parser DOCX (zip → XML → text + cấu trúc)
- `internal/parsers/xlsx.go` — Parser XLSX (trích xuất dữ liệu cell + cấu trúc sheet)
- `internal/parsers/pptx.go` — Parser PPTX (trích xuất text slide + speaker notes)
- `internal/parsers/pdf.go` — Trích xuất văn bản PDF
- `internal/parsers/text.go` — Chunker văn bản thuần (kích thước cố định có overlap)
- `internal/metadata/schema.go` — Bảng PostgreSQL cho trạng thái sync, metadata file, quyền

### Schema PostgreSQL (Phase 1)

```sql
-- Trạng thái sync cho delta query
CREATE TABLE delta_state (
    source TEXT PRIMARY KEY,  -- 'onedrive:/site/drive' hoặc 'teams:/group/channel'
    change_token TEXT NOT NULL,
    has_more BOOLEAN NOT NULL DEFAULT FALSE,
    last_sync_at TIMESTAMPTZ NOT NULL
);

-- Metadata file/tài liệu đã import
CREATE TABLE m365_files (
    id SERIAL PRIMARY KEY,
    source_type TEXT NOT NULL,  -- 'onedrive' hoặc 'teams'
    source_id TEXT NOT NULL,    -- ID item OneDrive hoặc ID message Teams
    file_name TEXT NOT NULL,
    file_type TEXT,             -- 'docx', 'xlsx', 'pptx', 'pdf', 'txt', 'chat_message'
    file_size INTEGER,
    content_hash TEXT,
    last_modified TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    permissions_json JSONB      -- Các mục ACL
);

-- Chunk văn bản đã parse
CREATE TABLE chunks (
    id SERIAL PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES m365_files(id),
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    heading_path TEXT,          -- cho docx/pptx: cấu trúc outline
    UNIQUE(file_id, chunk_index)
);

-- Cấu hình kết nối MS 365
CREATE TABLE m365_connections (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,         -- 'onedrive' hoặc 'teams'
    tenant_id TEXT NOT NULL,
    config_json JSONB NOT NULL, -- site_id, group_id, v.v.
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cache quyền: quyền truy cập user_id ↔ file_id
CREATE TABLE permission_cache (
    user_id TEXT NOT NULL,
    file_id INTEGER NOT NULL REFERENCES m365_files(id),
    permission TEXT NOT NULL,   -- 'read', 'write', 'owner'
    PRIMARY KEY (user_id, file_id)
);
```

**Pattern vay mượn từ hệ thống RAD**
- `internal/ingestion/ingestion.go` → pattern orchestrator cho connect→enumerate→parse
- `internal/ingestion/file_walker.go` → pattern liệt kê, thích ứng cho phân trang Graph API
- `internal/ingestion/parsers/` → pattern interface parser
- `internal/common/config.go` → validation cấu hình khi khởi động
- `internal/auth/` → pattern middleware JWT (thích ứng cho OIDC)

---

## 6) Phase 2: Trích xuất Entity NLP + Knowledge Graph (Neo4j)

**Mục tiêu**: Trích xuất entity và relationship nghiệp vụ từ chunk văn bản; lưu vào Neo4j.

**Package**: `internal/nlp/`, `internal/graph/`, `internal/embedding/`

**File chính**
- `internal/nlp/types.go` — Kiểu Entity (Person, Project, Document, Technology, Customer, Department, Date, Amount) và kiểu relationship
- `internal/nlp/extractor.go` — Trích xuất dựa trên LLM: gửi chunk → nhận entity + relationship có cấu trúc
- `internal/nlp/prompt.go` — Prompt trích xuất được thiết kế riêng cho custom LLM
- `internal/nlp/confidence.go` — Chấm điểm độ tin cậy (0.0–1.0) cho mỗi entity/relationship trích xuất
- `internal/graph/types.go` — GraphNode/GraphEdge cho domain nghiệp vụ
- `internal/graph/builder.go` — Theo lô: nạp kết quả NLP → khử trùng lặp → upsert vào Neo4j
- `internal/graph/neo4j_store.go` — Neo4j client, upsert Cypher, connection pool
- `internal/graph/neo4j_query.go` — Các pattern truy vấn Cypher (tìm entity, tìm đường đi, tìm neighbor)
- `internal/graph/traversal.go` — BFS/DFS traversal với giới hạn độ sâu
- `internal/graph/stats.go` — Thống kê graph (số lượng node/edge, phân phối bậc)
- `internal/embedding/runtime.go` — Interface embedding
- `internal/embedding/custom_api.go` — Nhà cung cấp private API (endpoint tương thích OpenAI)
- `internal/embedding/batch.go` — Worker embedding theo lô (tối đa 100 văn bản/lô)

**Luồng trích xuất NLP**
```
TextChunk → LLM (custom API) → {
  entities: [{ type: "Person", name: "...", confidence: 0.92 }],
  relationships: [{ from: "Person:...", to: "Project:...", type: "works_on", confidence: 0.87 }]
}
```

### Schema Neo4j
```cypher
// Nhãn node
(:Person {email: "...", displayName: "...", department: "..."})
(:Project {name: "...", status: "...", description: "..."})
(:Document {fileName: "...", sourceType: "onedrive", sourceId: "..."})
(:Technology {name: "..."})
(:Customer {name: "..."})
(:Department {name: "..."})
(:Chunk {chunkId: ..., fileHash: "..."})

// Quan hệ
(:Person)-[:MANAGES]->(:Project)
(:Person)-[:WORKS_ON]->(:Project)
(:Person)-[:BELONGS_TO]->(:Department)
(:Document)-[:MENTIONS]->(:Person|Project|Technology|Customer)
(:Document)-[:CREATED_BY]->(:Person)
(:Project)-[:USES]->(:Technology)
(:Project)-[:SERVING]->(:Customer)
(:Chunk)-[:PART_OF]->(:Document)
(:Chunk)-[:MENTIONS]->(:Person|Project|Technology|Customer)

// Chỉ mục
CREATE INDEX FOR (n:Person) ON (n.email)
CREATE INDEX FOR (n:Person) ON (n.displayName)
CREATE INDEX FOR (n:Project) ON (n.name)
CREATE INDEX FOR (n:Document) ON (n.fileName)
CREATE INDEX FOR (n:Technology) ON (n.name)
CREATE INDEX FOR (n:Customer) ON (n.name)
CREATE INDEX FOR (n:Department) ON (n.name)
```

### Schema embedding PostgreSQL (Phase 2)

`internal/embedding/store.go` lưu vector trong PostgreSQL, khóa theo chunk và phiên bản model embedding để có thể re-embed khi đổi model:

```sql
-- Theo dõi model/phiên bản embedding nào tạo ra vector nào
CREATE TABLE embedding_models (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT,
    dims INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, COALESCE(version, ''))
);

-- Một embedding cho mỗi chunk theo mỗi model
CREATE TABLE chunk_embeddings (
    id SERIAL PRIMARY KEY,
    chunk_id INTEGER NOT NULL REFERENCES chunks(id),
    model_id INTEGER NOT NULL REFERENCES embedding_models(id),
    embedding BYTEA NOT NULL,       -- mảng float32 đã serialize; dùng kiểu `vector` của pgvector nếu cần ANN search
    embedding_hash TEXT,             -- tùy chọn, cho dedupe/integrity
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chunk_id, model_id)
);
CREATE INDEX idx_chunk_embeddings_chunk ON chunk_embeddings(chunk_id);
CREATE INDEX idx_chunk_embeddings_model ON chunk_embeddings(model_id);

-- Theo dõi job embedding theo lô (backfill / re-embedding)
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

**Pattern vay mượn từ hệ thống RAD**
- Pattern struct GraphNode/GraphEdge, chu trình build→validate→publish, pattern traversal
- Pattern interface LLM runtime (cho các cuộc gọi trích xuất)
- Pattern chấm điểm độ tin cậy

---

## 7) Phase 3: Pipeline Hybrid Retrieval + Q&A

**Mục tiêu**: Trả lời câu hỏi ngôn ngữ tự nhiên bằng graph search + semantic retrieval.

**Package**: `internal/retrieval/`

**File chính**
- `retriever.go` — Orchestrator chính: pipeline 8 giai đoạn
- `intent_detector.go` — Intent doanh nghiệp (find_expert, find_document, find_project_info, find_technology_usage, general_question)
- `permission_filter.go` — Lọc kết quả theo quyền M365 của người dùng
- `semantic_search.go` — Embed câu truy vấn → tìm chunk văn bản tương tự
- `graph_expander.go` — Mở rộng entity tìm được sang entity liên quan (BFS, độ sâu 1–2)
- `reranker.go` — Xếp hạng lại kết quả kết hợp
- `context_packer.go` — Đóng gói ngữ cảnh theo token
- `answer_generator.go` — Sinh câu trả lời LLM có trích dẫn nguồn

### Pipeline retrieval (8 giai đoạn)
```
Câu truy vấn người dùng
  ↓
Stage 0: Lọc quyền           — nạp phạm vi truy cập M365 của người dùng
  ↓
Stage 1: Phát hiện intent     — phân loại intent (find_expert, find_document, v.v.)
  ↓
Stage 2: Nhận diện Entity     — trích xuất các đề cập entity từ câu truy vấn (NER)
  ↓
Stage 3 + 4 (song song):
  ├─ Truy vấn Graph Neo4j    — traverse graph từ các entity đã nhận diện
  └─ Semantic Search         — embed câu truy vấn → tìm chunk tương tự
  ↓
  → Merge, khử trùng lặp theo entity ID
  ↓
Stage 5: Rerank              — chấm điểm theo độ liên quan + độ gần graph + độ tin cậy
  ↓
Stage 6: Đóng gói ngữ cảnh    — đóng gói theo ngân sách token (mặc định 12K token)
  ↓
Stage 7: Sinh câu trả lời     — LLM sinh câu trả lời có trích dẫn
  ↓
→ { answer: "...", sources: [...], entities: [...] }
```

**Pattern vay mượn từ hệ thống RAD**
- Pattern pipeline 7 giai đoạn → mở rộng thành 8 giai đoạn bằng cách thêm bộ lọc quyền
- Phân loại intent, tìm kiếm vector, mở rộng graph, rerank có độ tin cậy, đóng gói ngữ cảnh theo token, hydrate nguồn

---

## 8) Phase 4: Vòng lặp Feedback Tự cải thiện

**Mục tiêu**: Thu thập feedback, phân tích xu hướng, đánh giá lại các cạnh có độ tin cậy thấp.

**Package**: `internal/feedback/`

**File chính**
- `store.go` — Lưu trữ feedback trên PostgreSQL
- `analyzer.go` — Phân tích: câu trả lời xu hướng, điểm nóng độ tin cậy thấp
- `improver.go` — Định kỳ: quét lại các cạnh có độ tin cậy thấp → trích xuất lại bằng LLM
- `exporter.go` — Xuất cặp hội thoại cho fine-tuning

### Bổ sung PostgreSQL (Phase 4)
```sql
-- Lịch sử truy vấn cho phân tích (tạo trước: feedback_events tham chiếu đến bảng này)
CREATE TABLE query_logs (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    query_text TEXT NOT NULL,
    intent TEXT,
    results_count INTEGER,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Feedback người dùng trên câu trả lời
CREATE TABLE feedback_events (
    id SERIAL PRIMARY KEY,
    query_id INTEGER NOT NULL REFERENCES query_logs(id),
    user_id TEXT NOT NULL,
    feedback_type TEXT NOT NULL,  -- 'like', 'dislike', 'flag'
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Theo dõi độ tin cậy theo từng cạnh
CREATE TABLE extraction_confidence (
    id SERIAL PRIMARY KEY,
    entity_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    confidence REAL NOT NULL,
    feedback_score REAL,          -- suy ra từ feedback
    last_reevaluated TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

*Ghi chú: `feedback_events.query_id` giờ là `INTEGER REFERENCES query_logs(id)` — các bản nháp trước đó khai báo là `TEXT` không có FK với `query_logs.id` (kiểu `INTEGER`), một lỗi type mismatch được gắn cờ trong `review_1.2.md`. Đã sửa ở đây khi chuyển sang PostgreSQL DDL hợp lệ.*

**Pattern vay mượn từ hệ thống RAD**
- Pattern chấm điểm độ tin cậy
- Pattern job định kỳ cho đánh giá lại
- Pattern thu thập metrics

---

## 9) Phase 5: Frontend — Dashboard Tri thức Doanh nghiệp

**Mục tiêu**: Frontend React với Q&A, entity browser, trực quan hóa graph, feedback, và admin.

**Trang chính**
- `KnowledgeSearch.tsx` — Q&A ngôn ngữ tự nhiên với giao diện chat, trích dẫn nguồn, nút feedback
- `EntityBrowser.tsx` — Danh sách entity có thể lọc theo loại (person, project, document, v.v.), xem chi tiết với relationship
- `BusinessGraph.tsx` — Trực quan hóa graph tương tác (React Flow / D3.js), lọc theo loại entity, node có thể click
- `FeedbackReview.tsx` — Giao diện admin để review câu trả lời bị gắn cờ, điều chỉnh điểm tin cậy
- `DataSourcesPage.tsx` — Cấu hình kết nối M365, xem trạng thái sync, kích hoạt sync thủ công
- `LoginPage.tsx` — Đăng nhập Entra ID + fallback JWT local
- `DashboardPage.tsx` — Tổng quan: truy vấn gần đây, trạng thái sync, thống kê graph, xu hướng feedback *(phụ thuộc vào `/api/feedback/stats` của Phase 4 — không được liệt kê như một phụ thuộc trong bảng Tóm tắt Phase; xem ghi chú §17)*

**Pattern vay mượn từ frontend RAD**
- Axios client với interceptor, hook WebSocket, chat UI, trực quan hóa graph, trạng thái Zustand, hook TanStack Query, i18n (en/vi), component Shadcn/ui

---

## 10) Phase 6: Retrieval Nhận biết Quyền (tinh chỉnh)

**Mục tiêu**: Đảm bảo mọi truy vấn retrieval đều tôn trọng quyền M365. Được tinh chỉnh thành một mối quan tâm liên tục, với triển khai đầy đủ trong Phase 3.

- Lọc quyền là Stage 0 của pipeline retrieval
- Tại thời điểm ingestion, mỗi tài liệu được gắn thẻ với các mục ACL M365 của nó
- Pipeline retrieval lọc kết quả theo quyền đã cache của người dùng đã xác thực
- `internal/connectors/permissions.go` xử lý trích xuất ACL và làm mới cache

*Ghi chú: các sản phẩm bàn giao của phase này trùng lặp đáng kể với Phase 3 và `permissions.go` của Phase 1 — được giữ nguyên không đổi từ tất cả các bản nháp gốc; `review_1.2.md` khuyến nghị gộp vào Phase 3.*

---

## 11) Phạm vi MS Graph API

| Phạm vi | Mục đích | Loại |
|---|---|---|
| `Sites.Read.All` | Đọc site SharePoint | Quyền ứng dụng |
| `Files.Read.All` | Đọc file OneDrive/SharePoint | Quyền ứng dụng |
| `Chat.Read.All` | Đọc chat 1:1 Teams | Quyền ứng dụng |
| `ChannelMessage.Read.All` | Đọc tin nhắn kênh Teams | Quyền ứng dụng |
| `Group.Read.All` | Đọc thành viên Teams/group | Quyền ứng dụng |
| `People.Read` | Đọc hồ sơ người dùng | Ủy quyền (cho SSO) |
| `User.Read` | Đọc hồ sơ của chính mình | Ủy quyền |

---

## 12) Cấu hình

Các biến môi trường chính:

| Biến | Mục đích | Mặc định |
|---|---|---|
| `HOST` | Địa chỉ bind server | `0.0.0.0` |
| `PORT` | Port server | `8080` |
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL | (bắt buộc, vd. `postgres://user:pass@localhost:5432/m365kg`) |
| `M365_TENANT_ID` | Tenant ID Microsoft Entra | (bắt buộc) |
| `M365_CLIENT_ID` | Client ID đăng ký ứng dụng | (bắt buộc) |
| `M365_CLIENT_SECRET` | Secret đăng ký ứng dụng | (bắt buộc) |
| `M365_AUTH_MODE` | Chế độ auth | `entra_id` |
| `NEO4J_URI` | URI kết nối Neo4j | `bolt://localhost:7687` |
| `NEO4J_USERNAME` | Username Neo4j | `neo4j` |
| `NEO4J_PASSWORD` | Password Neo4j | (bắt buộc) |
| `LLM_API_BASE_URL` | Endpoint custom LLM API | (bắt buộc) |
| `LLM_API_KEY` | API key custom LLM | (tùy chọn) |
| `LLM_MODEL` | Tên model cho completion | `gpt-4o-mini` |
| `LLM_EMBED_MODEL` | Model cho embedding | `text-embedding-3-small` |
| `JWT_SECRET` | Secret JWT (demo mode) | (tự sinh) |
| `ALLOWED_ORIGINS` | Nguồn CORS | `http://localhost:5173` |
| `DELTA_SYNC_INTERVAL` | Chu kỳ delta sync | `5m` |

*`DATABASE_URL` thay thế biến `DATA_DIR` trước đó, biến mô tả một đường dẫn hệ thống file (phù hợp với SQLite nhúng, không phải PostgreSQL client-server) — được gắn cờ trong `review_1.2.md`.*

---

## 13) Các file cần tạo

### Go Backend
**Package mới:**

| Package | File | Mục đích |
|---------|-------|---------|
| `internal/auth/` | `entra_id.go`, `jwt.go`, `middleware.go` | Xác thực |
| `internal/connectors/` | `client.go`, `auth.go`, `onedrive.go`, `teams.go`, `delta.go`, `permissions.go` | Connector M365 |
| `internal/parsers/` | `docx.go`, `xlsx.go`, `pptx.go`, `pdf.go`, `text.go` | Parser tài liệu |
| `internal/nlp/` | `extractor.go`, `prompt.go`, `types.go`, `confidence.go` | Trích xuất NLP |
| `internal/graph/` | `types.go`, `builder.go`, `neo4j_store.go`, `neo4j_query.go`, `traversal.go`, `stats.go` | Graph nghiệp vụ |
| `internal/retrieval/` | `retriever.go`, `intent_detector.go`, `permission_filter.go`, `semantic_search.go`, `graph_expander.go`, `reranker.go`, `context_packer.go`, `answer_generator.go` | Pipeline Q&A |
| `internal/embedding/` | `runtime.go`, `custom_api.go`, `batch.go`, `store.go` | Embedding |
| `internal/feedback/` | `store.go`, `analyzer.go`, `improver.go`, `exporter.go` | Vòng lặp feedback |
| `internal/metadata/` | `db.go`, `schema.go`, `query.go` | Metadata PostgreSQL |
| `internal/scheduler/` | `delta_sync.go`, `reevaluator.go` | Job nền |
| `internal/websocket/` | `hub.go` | Cập nhật realtime |
| `internal/common/` | `config.go`, `logger.go`, `errors.go` | Tiện ích |
| `pkg/types/` | `entity.go`, `graph.go`, `retrieval.go`, `feedback.go` | Kiểu công khai |

**Điểm vào:**
- `cmd/server/main.go` — DI, khởi động, kết nối tất cả service

### Frontend

| Trang | Mục đích |
|------|---------|
| `KnowledgeSearch.tsx` | Giao diện Q&A chính |
| `EntityBrowser.tsx` | Duyệt entity theo loại |
| `BusinessGraph.tsx` | Trực quan hóa graph |
| `FeedbackReview.tsx` | Review câu trả lời bị gắn cờ |
| `DataSourcesPage.tsx` | Cấu hình kết nối M365 |
| `LoginPage.tsx` | Đăng nhập Entra ID / JWT |
| `DashboardPage.tsx` | Dashboard tổng quan |

### API Endpoint

| Method | Path | Mục đích |
|--------|------|---------|
| POST | `/api/auth/login` | Đăng nhập Entra ID / JWT |
| POST | `/api/auth/token/refresh` | Làm mới token auth |
| POST | `/api/m365/connect` | Cấu hình kết nối M365 |
| GET | `/api/m365/sources` | Danh sách nguồn dữ liệu đã kết nối |
| POST | `/api/m365/sync` | Kích hoạt sync dữ liệu |
| GET | `/api/m365/sync/status` | Lấy trạng thái sync |
| POST | `/api/knowledge/query` | Q&A ngôn ngữ tự nhiên |
| POST | `/api/feedback` | Gửi like/dislike |
| GET | `/api/feedback/stats` | Phân tích feedback |
| GET | `/api/entities` | Danh sách/duyệt entity |
| GET | `/api/entities/:id` | Chi tiết entity |
| GET | `/api/graph/nodes` | Node graph |
| GET | `/api/graph/edges` | Edge graph |
| GET | `/api/graph/path` | Tìm đường đi giữa các entity |
| GET | `/api/stats/overview` | Thống kê dashboard |
| WS | `/ws?token=<JWT>` | Cập nhật realtime |

---

## 14) Tái sử dụng (pattern từ hệ thống RAD tại `/workspace`)

| Pattern | Nguồn RAD | Cách dùng trong hệ thống mới |
|---------|-----------|-----------------|
| Orchestrator ingestion | `internal/ingestion/ingestion.go` | Cùng pattern orchestrator cho connect→enumerate→parse |
| Mô hình graph | `internal/graph/types.go` | Pattern struct GraphNode/GraphEdge, mở rộng kiểu |
| Graph builder | `internal/graph/builder.go` | Chu trình build→validate→publish (thích ứng cho Neo4j) |
| Interface LLM runtime | `internal/llm/runtime.go` | Interface embedding + trích xuất NER |
| SmartRouter | `internal/llm/smart_router.go` | Pattern chọn provider |
| Retrieval 7 giai đoạn | `internal/retriever/retriever.go` | Pipeline 8 giai đoạn (thêm bộ lọc quyền) |
| Phát hiện intent | `internal/retriever/intent_detector.go` | Phân loại intent doanh nghiệp |
| Đóng gói ngữ cảnh | `internal/retriever/context_packer.go` | Đóng gói ngữ cảnh theo token |
| Lọc quyền | `internal/retriever/metadata_filter.go` | Pattern lọc, thích ứng cho ACL M365 |
| Chấm điểm độ tin cậy | `internal/knowledge/confidence.go` | Độ tin cậy theo mỗi entity/relationship |
| Epoch atomicity | `internal/epoch/` | Pattern hiển thị đồng bộ nguyên tử |
| JWT auth | `internal/auth/` | Middleware JWT (entra_id + demo fallback) |
| WebSocket hub | `internal/websocket/` | Tiến trình sync realtime và cập nhật truy vấn |
| Error wrapping | `internal/common/errors.go` | Kiểu lỗi có cấu trúc |
| Config validation | `internal/common/config.go` | Validation cấu hình khi khởi động |
| Axios client | `Frontend/src/api/client.ts` | HTTP client với interceptor |
| TanStack Query | `Frontend/src/hooks/` | Hook trạng thái server |
| Zustand store | `Frontend/src/store/useUIStore.ts` | Quản lý trạng thái UI |
| WebSocket hook | `Frontend/src/hooks/useWebSocket.ts` | Cập nhật realtime với backoff |
| Chat UI | `Frontend/src/pages/BrainChatPage.tsx` | Giao diện chat Q&A (thích ứng) |
| Graph viz | `Frontend/src/pages/CodeGraph.tsx` | Graph tương tác (thích ứng cho nghiệp vụ) |
| i18n | `Frontend/src/i18n/` | Đa ngôn ngữ en/vi |
| Shadcn/ui | `Frontend/src/components/ui/` | Button, Card, Badge, Modal, v.v. |

---

## 15) Đặc tả Máy trạng thái

### 15.1 Máy trạng thái Delta Sync (theo mỗi nguồn trong `delta_state`)

**Trạng thái**
- `IDLE` (không có sync đang chạy)
- `SYNC_RUNNING` (delta query/phân trang đang chạy)
- `SYNC_PARTIAL_HAS_MORE` (`has_more=true`, cần tiếp tục)
- `SYNC_COMPLETED` (`has_more=false`, `last_sync_at` đã cập nhật)
- `SYNC_FAILED` (lỗi; retry theo chiến lược retry/rate-limit của client)

**Chuyển trạng thái**
- `IDLE → SYNC_RUNNING` khi kích hoạt thủ công (`/api/m365/sync`) hoặc scheduler tick (`DELTA_SYNC_INTERVAL`).
- `SYNC_RUNNING → SYNC_PARTIAL_HAS_MORE` nếu còn nhiều trang.
- `SYNC_PARTIAL_HAS_MORE → SYNC_RUNNING` khi lấy trang delta tiếp theo.
- `SYNC_RUNNING → SYNC_COMPLETED` khi `change_token` mới được lưu và sync hoàn tất.
- `(SYNC_RUNNING | SYNC_PARTIAL_HAS_MORE) → SYNC_FAILED` khi lỗi; quay về `IDLE` hoặc retry (client có retry/rate-limiting).

### 15.2 Máy trạng thái Pipeline Retrieval (Q&A) (theo mỗi truy vấn)

```
STAGE0_PERMISSION_FILTER → STAGE1_INTENT → STAGE2_QUERY_NER
  → song song: (STAGE3_GRAPH_QUERY, STAGE4_SEMANTIC_SEARCH)
  → MERGE_DEDUP → STAGE5_RERANK → STAGE6_CONTEXT_PACK (mặc định 12K token)
  → STAGE7_ANSWER_GEN → DONE
```

### 15.3 Máy trạng thái Vòng lặp Cải thiện Feedback

```
FEEDBACK_COLLECTED (insert feedback_events)
  → ANALYZED (analyzer tìm xu hướng/điểm nóng độ tin cậy thấp)
  → REEVALUATION_SCHEDULED (scheduler)
  → REEXTRACTED (improver quét lại các cạnh độ tin cậy thấp, trích xuất lại bằng LLM)
  → GRAPH_UPDATED (độ tin cậy/cạnh đã cập nhật)
  → quay về trạng thái ổn định
```

---

## 16) Kiểm chứng

### Test Backend
```bash
# Unit test theo package
cd m365-knowledge-graph && go test ./internal/connectors/...
cd m365-knowledge-graph && go test ./internal/nlp/...
cd m365-knowledge-graph && go test ./internal/graph/...
cd m365-knowledge-graph && go test ./internal/retrieval/...
cd m365-knowledge-graph && go test ./internal/feedback/...
cd m365-knowledge-graph && go test ./...

# Integration test (với MS Graph API mock + Neo4j test)
cd m365-knowledge-graph && go test -tags=integration ./tests/integration/...
```

### Test Frontend
```bash
# Unit test
cd Frontend && npm run test

# E2E test
cd Frontend && npm run test:e2e
```

### Luồng nghiệm thu E2E
1. **Auth**: Người dùng đăng nhập qua Entra ID → nhận JWT → các request tiếp theo được xác thực
2. **Kết nối**: Admin cấu hình kết nối M365 → `/api/m365/connect` trả về 200
3. **Sync**: Kích hoạt delta sync → `/api/m365/sync` bắt đầu, WebSocket phát sự kiện tiến trình
4. **Ingest**: Xác nhận tài liệu đã import → `/api/entities?type=document` trả về entity
5. **Extract**: Xác nhận NER đã chạy → `/api/entities?type=person` và `/api/entities?type=project` trả về entity
6. **Graph**: Xác nhận graph đã build → `/api/graph/nodes` trả về node, `/api/graph/edges` trả về edge
7. **Query**: Đặt câu hỏi Q&A → `/api/knowledge/query` trả về câu trả lời theo ngữ cảnh có trích dẫn
8. **Feedback**: Gửi like/dislike → `/api/feedback` ghi lại phản hồi
9. **Phân tích**: Kiểm tra xu hướng → `/api/feedback/stats` hiển thị phân phối feedback
10. **Quyền**: Xác nhận người dùng chỉ thấy entity trong phạm vi truy cập M365 của họ
11. **Delta sync**: Cập nhật tài liệu trên OneDrive → lần delta sync tiếp theo bắt được thay đổi

---

## 17) Tóm tắt các Phase (Thứ tự triển khai)

| Phase | Phạm vi | Sản phẩm chính | Phụ thuộc |
|---|---|---|---|
| 1 | Nền tảng | M365 đã kết nối, file đã ingest, chunk đã parse | Không |
| 2 | Knowledge Graph | Entity + relationship trong Neo4j | Phase 1 |
| 3 | Pipeline Q&A | Câu trả lời ngôn ngữ tự nhiên có trích dẫn | Phase 1, 2 |
| 4 | Vòng lặp Feedback | Like/dislike → đánh giá lại | Phase 3 |
| 5 | Frontend | Dashboard UI đầy đủ | Phase 1–3 *(cũng cần Phase 4 cho `FeedbackReview.tsx` / panel xu hướng feedback trên dashboard — xem `review_1.2.md`)* |
| 6 | Quyền | Retrieval nhận biết quyền đầy đủ | Phase 1, 3 |

---

## 18) Câu hỏi còn mở

1. Bảng Tóm tắt Quyết định Kiến trúc (§3) chưa bao giờ được điền — đâu là ranh giới dự kiến giữa tái sử dụng và mới theo từng chiều kiến trúc?
2. Chưa có yêu cầu nào giải quyết việc đồng ý/lưu trữ/ẩn danh khi ingest nội dung `Chat.Read.All` / `ChannelMessage.Read.All` (quyền truy cập chat riêng tư toàn tenant) — đây có phải là rủi ro chấp nhận được cho POC, hay cần có chính sách rõ ràng trước Phase 1?
3. Phase 6 nên vẫn là phase riêng, hay gộp vào Phase 3 vì các sản phẩm bàn giao của nó đã được bao phủ ở đó?
4. `chunk_embeddings.embedding` nên dùng kiểu `vector` của `pgvector` cho ANN search, hay tìm kiếm chính xác/brute-force (qua giai đoạn retrieval `semantic_search.go`) là đủ ở quy mô dữ liệu POC này (~10K tài liệu)?
5. `permission_cache` vẫn chưa có trường staleness/expiry, mặc dù Phase 6 mô tả "làm mới cache" là trách nhiệm của `permissions.go` — cơ chế nào kích hoạt việc vô hiệu hóa khi ACL M365 của người dùng thay đổi?
