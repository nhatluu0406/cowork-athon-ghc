---
status: "phase1-complete"
created: "2026-07-17"
updated: "2026-07-17"
---

# Implementation Plan: Local Folder Import for Knowledge Graph

**Branch**: `005-local-folder-import` | **Date**: 2026-07-17 | **Spec**: [specs/005-local-folder-import/spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-local-folder-import/spec.md`

## Summary

RAD Knowledge Gateway (`github.com/rad-system/m365-knowledge-graph`) sẽ thêm khả năng import tài liệu từ thư mục cục bộ, cho phép người dùng không có M365 API access vẫn sử dụng được hệ thống knowledge graph. Feature bổ sung package Go mới `internal/localimport/` xử lý pipeline: quét filesystem → trích xuất text (PDF/DOCX/XLSX/TXT/MD) → chunking → embedding → lưu PostgreSQL + Neo4j. Import chạy dưới dạng background goroutine pool (không cần Redis). Local content tích hợp liền mạch với `/api/knowledge/query` hiện có thông qua JOIN trên `local_file_id` trong bảng `chunks`.

**Quyết định kỹ thuật chính** (từ research.md):
- PDF: `github.com/ledongthuc/pdf` (pure Go, MIT) + fallback regex scraper
- DOCX: `github.com/fumiama/go-docx` (kiểm tra xem `internal/parsers/docx.go` đã có chưa)
- XLSX: `github.com/xuri/excelize/v2` (kiểm tra trong `go.mod`)
- Encoding detection: `github.com/saintfish/chardet` + `golang.org/x/text`
- Delta sync: mtime fast-path → SHA-256 chỉ khi mtime/size thay đổi
- Schema: 3 bảng mới (`local_sources`, `import_jobs`, `local_files`) + alter `chunks` (thêm `local_file_id` nullable)

---

## Technical Context

**Language/Version**: Go 1.22

**Primary Dependencies**:
- `github.com/ledongthuc/pdf` — PDF text extraction (pure Go, MIT) ✅ Confirmed
- `github.com/fumiama/go-docx` — DOCX extraction (kiểm tra xem docx.go stub hay đã có thư viện)
- `github.com/xuri/excelize/v2` — XLSX (kiểm tra `go.mod` — có thể đã import)
- `github.com/saintfish/chardet` — encoding detection (MIT)
- `golang.org/x/text` — encoding conversion
- Existing: `github.com/lib/pq`, `github.com/neo4j/neo4j-go-driver/v5`

**Storage**:
- PostgreSQL: 3 bảng mới + ALTER `chunks` (thêm `local_file_id UUID NULL`) — xem `data-model.md §1`
- Neo4j: node `LocalDocument`, `LocalSource`; relationship `PART_OF`, `MENTIONS` — xem `data-model.md §2`

**Testing**:
- `go test ./internal/localimport/...` — unit tests với temp dir fixtures
- `go test ./tests/integration/localimport/...` — end-to-end import → query result
- Coverage target: >80% core logic, >90% `path.go` và `delta.go`

**Target Platform**: Linux (primary) + Windows (path normalization bắt buộc)

**Project Type**: Backend service extension — REST API + background job processing

**Performance Goals**:
- SC-003: Delta sync 10.000 file (50 changed) < 5 phút
- SC-007: 100 file/giây trên 4-core CPU, 8GB RAM, SSD
- SC-004: File đến 500 MB không crash (streaming read, 8MB blocks)

**Constraints**:
- Không có external job queue; in-process goroutine pool (workers = min(4, GOMAXPROCS))
- Backward compatible M365 pipeline: không thay đổi `internal/connectors/`, `internal/retrieval/` logic
- Absolute path không được xuất hiện trong logs

**Scale/Scope**: MVP 1.000–50.000 documents; brute-force cosine similarity đủ dùng (không cần pgvector)

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Project Rules Compliance

**Architecture Rules** (`docs/architecture/decisions/`):
- ✅ Local service owns file operations; no direct renderer ↔ filesystem access
- ✅ Permission enforced at service boundary (not UI)
- ✅ One source of truth per state type (LocalSource → DB, not duplicated in JSON)
- ✅ Port/adapter seam for file parsers (encapsulated, testable)
- ⚠️ **CLARIFICATION**: Decision needed on background job storage — in-memory queue vs. persistent job table

**Coding Rules** (`coding.md`):
- ✅ File scanner module: <250 lines responsibility: directory traversal + filter logic
- ✅ Format extractors: separate modules per format, <300 lines each (pdfcpu/unioffice handle complexity)
- ✅ Service boundary: file mutations guarded, not exposed to renderer directly
- ✅ Error handling: no swallowed exceptions; explicit error types for parser/permission failures

**Testing Rules** (`testing.md`):
- ✅ Unit: file scanner, format parsers, change detection, secret redaction
- ✅ Integration: import job lifecycle, API contract, search result attribution
- ✅ Negative: permission-denied, invalid paths, binary files, encoding issues

**Security Rules** (`security.md`):
- ✅ Path validation: no `..` escapes, symlink handling configurable (default: skip)
- ✅ Secrets not in logs: sensitive paths redacted per existing policy
- ✅ Workspace boundary: enforced at service (import root must be inside workspace or explicitly allowed)
- ✅ Credential: no API keys required; uses file system ACL (future enhancement)

**Frontend Rules** (`frontend.md`):
- ✅ UI is client of service; no direct file access from renderer
- ✅ Import status renders honestly: queued → running → completed/failed (no fake progress)
- ✅ Permission prompts: local file read requires service-side validation (not just UI check)
- ⚠️ **CLARIFICATION**: UI integration point — is Knowledge surface extended, or new sub-surface created?

---

## Project Structure

### Documentation (this feature)

```text
specs/005-local-folder-import/
├── plan.md                  # This file (implementation plan)
├── spec.md                  # Feature specification
├── research.md              # Phase 0 output (research findings)
├── data-model.md            # Phase 1 output (entity definitions)
├── contracts/               # Phase 1 output (API/storage contracts)
│   ├── local-sources-api.md
│   ├── import-job-api.md
│   ├── database-schema.md
│   └── search-integration.md
├── quickstart.md            # Phase 1 output (getting started guide)
├── checklists/
│   └── requirements.md      # Requirement tracking
└── tasks.md                 # Phase 2 output (development tasks)
```

### Source Code (repository root)

Cowork GHC uses a **desktop app + backend service architecture**. Local folder import extends existing backend:

```text
# Backend service (Go)
backend/
├── src/
│   ├── local/               # NEW: local folder import module
│   │   ├── scanner/         # File scanner + change detection
│   │   │   ├── scanner.go
│   │   │   ├── filter.go
│   │   │   └── scanner_test.go
│   │   ├── extract/         # Format extractors (PDF, DOCX, etc.)
│   │   │   ├── pdf.go
│   │   │   ├── docx.go
│   │   │   ├── xlsx.go
│   │   │   └── text.go
│   │   ├── models/          # LocalSource, ImportJob entities
│   │   │   └── models.go
│   │   ├── store/           # Database persistence
│   │   │   └── local_store.go
│   │   └── service.go       # Main service interface
│   ├── api/                 # EXISTING: extend with new routes
│   │   ├── local/           # NEW: /api/local/* endpoints
│   │   │   ├── sources.go   # CRUD endpoints
│   │   │   └── sync.go      # Trigger import
│   │   └── knowledge/       # EXISTING: extend query endpoint
│   │       └── query.go
│   ├── graph/               # EXISTING: reuse for Neo4j integration
│   └── chunks/              # EXISTING: reuse for PostgreSQL chunks table

# Frontend (TypeScript + React)
app/ui/src/
├── integration/
│   ├── knowledge/           # EXISTING: Knowledge surface
│   │   ├── knowledge-panel.tsx
│   │   └── local-sources/   # NEW: sub-panel for local sources
│   │       ├── source-list.tsx
│   │       ├── add-source-modal.tsx
│   │       ├── sync-status.tsx
│   │       └── local-sources.service.ts
│   └── surfaces/
│       └── knowledge-surface.tsx  # Integrate local sources tab
├── services/
│   ├── knowledge.service.ts  # EXISTING: extend with local queries
│   └── api.service.ts        # EXISTING: call new /api/local/* routes

# Tests
test/
├── integration/
│   └── local-import-e2e.test.go
├── unit/
│   ├── scanner_test.go
│   └── extractors_test.go
└── fixtures/
    └── testdata/             # Sample PDF, DOCX, XLSX, TXT files
```

**Structure Decision**: Cowork GHC backend is single-project Go service; local folder import is a cohesive module under `backend/src/local/` extending the existing `backend/src/api/` and `backend/src/graph/` layers. No new sub-services or microservices. Frontend integration plugs into the existing Knowledge surface (part of D3 awaiting_integration state in current shell, but local sources are fully functional behind the UI).

---

## Complexity Tracking

### No Constitution Violations

This feature adheres to all architecture, coding, and security rules:

1. **Service boundary preserved** — file operations stay in Go service; renderer never touches filesystem
2. **Permission model clear** — import jobs gated at service layer, not UI presentation
3. **Existing patterns reused** — chunks table, Neo4j graph, search endpoint all reused without schema changes
4. **Single responsibility** — scanner, extractors, and orchestrator are separate, testable modules
5. **Testing coverage** — unit (parsers, scanner logic), integration (job lifecycle), E2E (packaged app)

No violations require complexity justification.

---

## Phase 0: Research ✅ DONE

Xem **[research.md](./research.md)** — toàn bộ unknowns đã được giải quyết:
- PDF library: `ledongthuc/pdf` với fallback regex scraper
- Encoding detection: `chardet` + BOM check + UTF-8 fallback
- Delta sync: mtime fast-path → SHA-256 khi cần
- Background jobs: in-process goroutine pool, state trong PostgreSQL `import_jobs`
- Path traversal: `filepath.Abs + Clean + HasPrefix(clean, root)`
- Retrieval integration: JOIN `local_file_id` trong `chunks`

---

## Phase 1: Design & Contracts ✅ DONE

Xem các artifacts:
- **[data-model.md](./data-model.md)** — PostgreSQL schema, Neo4j nodes, Go types, migration plan
- **[contracts/api.md](./contracts/api.md)** — REST API contracts `/api/local/sources` và `/api/local/sync`
- **[quickstart.md](./quickstart.md)** — hướng dẫn implementation, thứ tự task, security rules

---

## Phase 2: Implementation (READY TO START)

### Thứ tự implementation (xem quickstart.md §3 để chi tiết)

**Phase A — Nền tảng**: `migrations/005_local_import.sql` → `path.go` → `source.go` → `job.go` → `file.go`

**Phase B — Scanner/Extractor**: `scanner.go` → `encoding.go` → `parsers/pdf.go` (upgrade) → `extractor.go`

**Phase C — Delta/Processor**: `file.go` DeltaResolver → `processor.go` → `dispatcher.go`

**Phase D — API/Wiring**: `handler.go` → wire vào `cmd/main.go` → update `retrieval/stages.go`

**Phase E — Neo4j**: `neo4j.go` → wire vào processor

**Phase F — Tests**: unit tests → integration test → retrieval verification

### Phase 1a: Data Model

Extract entity definitions from spec → **data-model.md**:

**Key Entities**:

1. **LocalSource**
   - `id` (UUID)
   - `name` (string, display name)
   - `root_path` (absolute filesystem path, validated)
   - `recursive` (bool, scan subdirectories)
   - `include_patterns` (glob list, e.g., `*.pdf`, `*.docx`)
   - `exclude_patterns` (glob list, e.g., `*.tmp`, `.git`)
   - `include_hidden` (bool, default false)
   - `follow_symlinks` (bool, default false)
   - `enabled` (bool, can be disabled without deleting)
   - `last_sync` (timestamp)
   - `file_count` (int, files indexed in last sync)
   - `total_size` (int64, bytes)
   - `status` (enum: active, unavailable, error)
   - `created_at`, `updated_at` (timestamps)

2. **ImportJob**
   - `id` (UUID)
   - `source_id` (FK to LocalSource)
   - `status` (enum: queued, running, completed, failed)
   - `started_at`, `ended_at` (timestamps)
   - `files_found` (int)
   - `files_added` (int)
   - `files_modified` (int)
   - `files_deleted` (int)
   - `files_skipped` (int)
   - `progress_percent` (int, 0-100)
   - `error_count` (int)
   - `error_log` (text, redacted paths)
   - `created_at` (timestamp)

3. **LocalDocument**
   - `id` (UUID)
   - `source_id` (FK to LocalSource)
   - `relative_path` (string, path within source root)
   - `filename` (string)
   - `file_size` (int64)
   - `mime_type` (string)
   - `mtime` (timestamp, for change detection)
   - `content_hash` (string, SHA-256 for delta sync)
   - `is_binary` (bool, true → metadata only, false → extract text)
   - `encoding` (string, UTF-8|UTF-16|Latin-1, null if binary)
   - `chunk_count` (int, how many chunks in PostgreSQL)
   - `created_at`, `updated_at` (timestamps)

4. **Extension to existing `chunks` table**
   - Add `source_type` (enum: m365, local)
   - Add `source_id` (string, LocalSource.id for local, M365 folder ID for M365)
   - Add `document_id` (FK to LocalDocument for local sources, null for M365)
   - Existing `embedding_vector`, `text_content` unchanged

### Phase 1b: Interface Contracts

Define REST API contracts → **contracts/local-sources-api.md** and **contracts/import-job-api.md**:

**API Endpoints** (full OpenAPI schema in contracts/):

```text
POST   /api/local/sources              # Create local source
GET    /api/local/sources              # List sources
GET    /api/local/sources/{id}         # Get source details
PATCH  /api/local/sources/{id}         # Update source config
DELETE /api/local/sources/{id}         # Delete source (removes all indexed content)

POST   /api/local/sources/{id}/sync    # Trigger import for source
GET    /api/local/jobs                 # List import jobs
GET    /api/local/jobs/{id}            # Get job status and progress

GET    /api/knowledge/query             # EXISTING: extend to include local results
  (add source_filter: ["local", "m365", "all"])
```

**Request/Response Examples**:

```json
POST /api/local/sources
{
  "name": "My Documents",
  "root_path": "/home/user/Documents",
  "recursive": true,
  "include_patterns": ["*.pdf", "*.docx", "*.txt", "*.md"],
  "exclude_patterns": [".git/*", "node_modules/*"],
  "include_hidden": false,
  "follow_symlinks": false
}

Response 201:
{
  "id": "src-abc123",
  "name": "My Documents",
  "root_path": "/home/user/Documents",
  "status": "active",
  "last_sync": null,
  "file_count": 0,
  "total_size": 0
}

POST /api/local/sources/src-abc123/sync

Response 202 Accepted:
{
  "job_id": "job-xyz789",
  "source_id": "src-abc123",
  "status": "queued"
}

GET /api/local/jobs/job-xyz789

Response 200:
{
  "id": "job-xyz789",
  "source_id": "src-abc123",
  "status": "running",
  "started_at": "2026-07-17T10:00:00Z",
  "files_found": 250,
  "files_processed": 85,
  "progress_percent": 34,
  "error_count": 0
}

GET /api/knowledge/query?q=python&source_filter=all

Response 200:
{
  "results": [
    {
      "id": "chunk-123",
      "text": "Python is a programming language...",
      "source": {
        "type": "local",
        "source_id": "src-abc123",
        "document_path": "Documents/python-guide.pdf",
        "filename": "python-guide.pdf"
      },
      "relevance_score": 0.95
    },
    {
      "id": "chunk-456",
      "text": "Python support in Office...",
      "source": {
        "type": "m365",
        "source_id": "m365-share-789",
        "document_path": "Shared Documents/Office Integration.docx",
        "filename": "Office Integration.docx"
      },
      "relevance_score": 0.78
    }
  ]
}
```

### Phase 1c: Database Schema

**contracts/database-schema.md**:

```sql
-- New table: local_sources
CREATE TABLE local_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  recursive BOOLEAN DEFAULT true,
  include_patterns TEXT[] DEFAULT '{}',
  exclude_patterns TEXT[] DEFAULT '{}',
  include_hidden BOOLEAN DEFAULT false,
  follow_symlinks BOOLEAN DEFAULT false,
  enabled BOOLEAN DEFAULT true,
  last_sync TIMESTAMP,
  file_count INTEGER DEFAULT 0,
  total_size BIGINT DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'unavailable', 'error')),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  CONSTRAINT unique_root_path UNIQUE (root_path)
);

CREATE INDEX idx_local_sources_enabled ON local_sources(enabled);

-- New table: import_jobs
CREATE TABLE import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES local_sources(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  files_found INTEGER DEFAULT 0,
  files_added INTEGER DEFAULT 0,
  files_modified INTEGER DEFAULT 0,
  files_deleted INTEGER DEFAULT 0,
  files_skipped INTEGER DEFAULT 0,
  progress_percent INTEGER DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  error_count INTEGER DEFAULT 0,
  error_log TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_import_jobs_source_id ON import_jobs(source_id);
CREATE INDEX idx_import_jobs_status ON import_jobs(status);

-- New table: local_documents
CREATE TABLE local_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES local_sources(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  mtime TIMESTAMP,
  content_hash TEXT,
  is_binary BOOLEAN DEFAULT false,
  encoding TEXT,
  chunk_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  CONSTRAINT unique_document_per_source UNIQUE (source_id, relative_path)
);

CREATE INDEX idx_local_documents_source_id ON local_documents(source_id);
CREATE INDEX idx_local_documents_hash ON local_documents(content_hash);

-- Alter existing chunks table
ALTER TABLE chunks ADD COLUMN source_type TEXT DEFAULT 'm365' CHECK (source_type IN ('m365', 'local'));
ALTER TABLE chunks ADD COLUMN source_id TEXT;
ALTER TABLE chunks ADD COLUMN document_id UUID REFERENCES local_documents(id) ON DELETE CASCADE;

CREATE INDEX idx_chunks_source_type ON chunks(source_type);
CREATE INDEX idx_chunks_source_id ON chunks(source_id);
CREATE INDEX idx_chunks_local_document ON chunks(document_id);

-- Migration: Set existing M365 content as source_type='m365'
UPDATE chunks SET source_type = 'm365' WHERE source_type IS NULL;
```

### Phase 1d: Search Integration Contract

**contracts/search-integration.md**:

Existing `/api/knowledge/query` endpoint extends with:
- `source_filter` query param (optional: all|local|m365, default: all)
- Response documents include `source` object with `type`, `source_id`, `document_path`, `filename`
- Neo4j query appends local node traversal: `(local_doc:LocalDocument)-->(chunks)` alongside M365 path
- Search UI renders source attribution in results (e.g., "Local: Documents/report.pdf" vs "M365: Shared Documents/report.docx")

### Phase 1e: Quickstart Guide

**quickstart.md**: 
- How to configure a local source via API
- How to trigger a sync
- How to query results including local documents
- Example: "Import a folder with 10 PDFs, search for a term, verify results appear"

### Phase 1f: Agent Context Update

Update `CLAUDE.md` reference between `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` markers to point to `specs/005-local-folder-import/plan.md`.

---

## Phase 2: Implementation (NOT YET STARTED)

Phase 2 begins after Phase 1 design artifacts are approved.

**Key implementation tasks** (generated during Phase 2):

1. Backend service layer: LocalSourceService, ImportJobOrchestrator
2. File scanner: directory traversal, filter matching, change detection
3. Format extractors: PDF, DOCX, XLSX, TXT/MD text extraction
4. API routes: CRUD sources, trigger sync, query integration
5. Database migrations: create new tables, alter chunks table
6. Neo4j graph integration: LocalDocument nodes and relationships
7. Frontend: LocalSources panel, import status, search results with attribution
8. Tests: unit (parsers, scanner), integration (E2E import→search), E2E packaged app
9. Documentation: admin guide (configuring sources), user guide (searching local docs)

---

## Open Items

1. **Background Job Queue** — In-memory queue (simple, MVP) vs. persistent job table (resumable, complex)? Decision pending Phase 0 research.

2. **UI Integration Point** — Extend existing Knowledge surface with "Local Sources" tab, or create new standalone surface? Current Knowledge surface is `awaiting_integration` (D3); local sources are independent but can coexist.

3. **ACL Inheritance** — MVP assumes all imported files are publicly readable within knowledge graph. OS-level ACL respect (Windows NTFS, Linux file permissions) is a Phase 3 enhancement.

4. **Workspace Boundary** — Can users import files outside their workspace root? Decision: allowed in MVP with explicit path validation; future enhancement to enforce workspace boundary strictly.

---

## Success Criteria (from spec)

- [ ] Users successfully import 1,000 documents and retrieve search results within 2 seconds
- [ ] Text extraction accuracy ≥95% for supported formats
- [ ] Delta sync processes 10k files with 50 changes in <5 minutes
- [ ] System handles files up to 500 MB without memory errors
- [ ] Search results correctly attribute sources (100% accurate)
- [ ] Import error rate <1% for readable files
- [ ] Import rate: 100 files/second on standard hardware
- [ ] Workflow (add source → configure → sync → search) completes in <3 minutes
- [ ] Path validation prevents 100% of directory traversal attempts
- [ ] Zero data corruption when local and M365 sources coexist

---

**Next Step**: Proceed to Phase 0 research. Dispatch agents to investigate file parsing libraries, encoding strategies, job queue patterns, and Neo4j graph design.
