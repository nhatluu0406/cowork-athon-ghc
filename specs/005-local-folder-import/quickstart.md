# Quickstart: Local Folder Import — Hướng dẫn dành cho implementer

**Feature**: `005-local-folder-import`
**Module path**: `github.com/rad-system/m365-knowledge-graph`
**Branch**: `005-local-folder-import`

---

## 1. Tổng quan kiến trúc

```
POST /api/local/sources  ──► LocalSourceStore (PostgreSQL local_sources)
POST /api/local/sync     ──► ImportDispatcher ──► goroutine worker pool
                                                       │
                                          ┌────────────┴───────────────┐
                                     Scanner                      Processor
                                  (filepath.WalkDir)          (per-file pipeline)
                                          │                           │
                                     DeltaResolver            Extractor (PDF/DOCX/XLSX/text)
                                  (mtime+SHA-256 diff)              │
                                                              Chunker (512-word)
                                                                      │
                                                           Embedder (llm-svc gRPC)
                                                                      │
                                                           ChunkStore + LocalFileStore
                                                                      │
                                                            Neo4jLocalDocNode
```

---

## 2. Setup môi trường phát triển

### 2.1 Yêu cầu

- Go 1.22+
- PostgreSQL 15+ (running, same instance as existing backend)
- Neo4j 5+ (running)
- `llm-svc` hoặc mock embedder cho unit tests

### 2.2 Chạy migrations

```bash
cd app/backend
psql $DATABASE_URL -f migrations/005_local_import.sql
```

File migration: `app/backend/migrations/005_local_import.sql` — tạo `local_sources`, `import_jobs`, `local_files` và alter `chunks` (xem `data-model.md §1.4`).

### 2.3 Chạy backend

```bash
cd app/backend
go run ./cmd/...
```

Không cần biến môi trường mới cho MVP — feature kích hoạt khi có ít nhất một `local_sources` row.

---

## 3. Thứ tự implementation (theo task)

### Phase A — Nền tảng (không có external dependency)

**A1**: Viết migrations SQL (`migrations/005_local_import.sql`)

**A2**: `internal/localimport/path.go` — path validation
```go
// ValidateSourcePath: filepath.Abs → filepath.Clean → HasPrefix(clean, allowedRoots)
// RedactPath(absPath, sourceRoot) → rel_path string
```
Bắt đầu ở đây vì security-critical và dễ test đơn.

**A3**: `internal/localimport/source.go` — `LocalSourceStore` CRUD
```go
type LocalSourceStore struct { db *sql.DB }
func (s *LocalSourceStore) Create(ctx, req CreateSourceRequest) (LocalSource, error)
func (s *LocalSourceStore) List(ctx) ([]LocalSource, error)
func (s *LocalSourceStore) Get(ctx, id string) (LocalSource, error)
func (s *LocalSourceStore) Update(ctx, id string, patch PatchSourceRequest) (LocalSource, error)
func (s *LocalSourceStore) Delete(ctx, id string) error
func (s *LocalSourceStore) UpdateStats(ctx, id string, fileCount int, totalSize int64) error
func (s *LocalSourceStore) SetStatus(ctx, id, status string) error
```

**A4**: `internal/localimport/job.go` — `ImportJobStore` CRUD
```go
type ImportJobStore struct { db *sql.DB }
func (s *ImportJobStore) Create(ctx, sourceID string) (ImportJob, error)
func (s *ImportJobStore) UpdateStatus(ctx, id string, status JobStatus) error
func (s *ImportJobStore) UpdateProgress(ctx, id string, progress JobProgress) error
func (s *ImportJobStore) List(ctx, filter JobFilter) ([]ImportJob, error)
func (s *ImportJobStore) MarkStaleJobs(ctx) error  // gọi khi startup
```

### Phase B — Scanner và extractor

**B1**: `internal/localimport/scanner.go`
```go
type Scanner struct {
    Source LocalSource
    // Options: MaxDepth, HiddenFiles, FollowSymlinks, IncludeExt, ExcludeExt
}
func (s *Scanner) Walk(ctx context.Context) (<-chan ScanEntry, <-chan error)
```
Dùng `filepath.WalkDir`. Symlink cycle detection với inode set (Linux) / `os.SameFile` (Windows).

**B2**: `internal/localimport/encoding.go`
```go
func DetectEncoding(sample []byte) (charset string, confidence float64, err error)
func ConvertToUTF8(data []byte, charset string) ([]byte, error)
```
Dùng `github.com/saintfish/chardet` + `golang.org/x/text`.

**B3**: `internal/localimport/extractor.go`
```go
type Extractor struct {
    pdfParser  *parsers.PDFParser
    docxParser *parsers.DocxParser
    xlsxParser *parsers.XlsxParser
    textParser *parsers.TextParser
}
func (e *Extractor) Extract(ctx context.Context, path string, mime string) (ExtractResult, error)

type ExtractResult struct {
    Text     string
    IsBinary bool
    Encoding string
    Error    error
}
```

### Phase C — Delta sync và processor

**C1**: `internal/localimport/file.go` — `LocalFileStore` + `DeltaResolver`
```go
func (s *LocalFileStore) GetByRelPath(ctx, sourceID, relPath string) (*LocalFile, error)
func (s *LocalFileStore) Upsert(ctx, f LocalFile) error
func (s *LocalFileStore) ListBySource(ctx, sourceID string) ([]LocalFile, error)
func (s *LocalFileStore) Delete(ctx, id string) error

type DeltaResolver struct { store *LocalFileStore }
func (r *DeltaResolver) Classify(ctx, sourceID string, entry ScanEntry) (DeltaResult, error)
```

**C2**: `internal/localimport/processor.go` — orchestrate scan→extract→chunk→embed→store
```go
type Processor struct {
    scanner    *Scanner
    resolver   *DeltaResolver
    extractor  *Extractor
    chunker    *parsers.Chunker
    embedder   retrieval.EmbeddingRuntime
    fileStore  *LocalFileStore
    chunkStore *metadata.ChunkStore
    jobStore   *ImportJobStore
    neo4j      *LocalNeo4jClient
}
func (p *Processor) Run(ctx context.Context, job ImportJob) error
```

**C3**: `internal/localimport/dispatcher.go` — job queue
```go
type Dispatcher struct {
    queue    chan dispatchItem
    workers  int
    // ...
}
func NewDispatcher(workers int, processor *Processor, jobStore *ImportJobStore) *Dispatcher
func (d *Dispatcher) Start(ctx context.Context)
func (d *Dispatcher) Enqueue(job ImportJob) error  // non-blocking, returns error if full
```

### Phase D — HTTP handlers và wiring

**D1**: `internal/localimport/handler.go`
```go
func NewLocalHandler(sourceStore, jobStore, dispatcher) http.Handler
// Routes:
// POST   /api/local/sources
// GET    /api/local/sources
// GET    /api/local/sources/{id}
// PATCH  /api/local/sources/{id}
// DELETE /api/local/sources/{id}
// POST   /api/local/sync
// GET    /api/local/jobs
// GET    /api/local/jobs/{id}
```

**D2**: Wire vào `cmd/main.go` + `cmd/routes_test.go`

**D3**: Update `internal/retrieval/stages.go` — thêm JOIN `local_files` vào SemanticSearch query

### Phase E — Neo4j integration

**E1**: `internal/localimport/neo4j.go`
```go
type LocalNeo4jClient struct { driver neo4j.DriverWithContext }
func (c *LocalNeo4jClient) UpsertDocument(ctx, f LocalFile, source LocalSource) error
func (c *LocalNeo4jClient) DeleteDocument(ctx, localFileID string) error
```

---

## 4. Testing

### Unit tests (bắt buộc trước PR)

```
internal/localimport/path_test.go       -- ValidateSourcePath, RedactPath, traversal cases
internal/localimport/scanner_test.go    -- walk với tmp dir, filter, symlink, depth limit
internal/localimport/encoding_test.go   -- UTF-8, UTF-16 LE/BE, Latin-1, undetectable
internal/localimport/extractor_test.go  -- PDF, DOCX, XLSX, binary detection
internal/localimport/delta_test.go      -- Added/Modified/Unchanged/Deleted classification
```

Mục tiêu coverage: >80% cho core logic; >90% cho `path.go` và `delta.go`.

### Integration test

```
tests/integration/localimport/import_test.go
```

Setup: tạo temp dir với 10 file (PDF, DOCX, TXT, MD, XLSX, 2 binary, 1 hidden, 1 symlink). Chạy full import pipeline. Assert:
- 7 non-binary files indexed trong `local_files`
- Chunks xuất hiện trong `chunks` với `local_file_id` đúng
- `GET /api/knowledge/query?q=<known_term>` trả về kết quả có `source_type: "local"`

---

## 5. Quy tắc bảo mật bắt buộc

1. **Không log absolute path** — chỉ log `source_id` + `rel_path`. Xem `RedactPath()`.
2. **Path validation tại handler** — `ValidateSourcePath()` trước khi lưu DB.
3. **Symlink check** — `os.Lstat()` trước `os.Open()`. Nếu `follow_symlinks=false`: skip `ModeSymlink`.
4. **UNC rejection** — reject `folder_path` bắt đầu bằng `\\` (Windows).
5. **Chunk text không chứa path** — `chunk.text` chỉ là nội dung văn bản, không có metadata path.

---

## 6. Không làm (scope boundary)

- ❌ Scheduled/automatic sync (P3 stretch goal — US-6)
- ❌ Web UI cho source management (separate spec)
- ❌ Per-user ACL cho local files (future enhancement)
- ❌ NFS/SMB-specific handling (treated as local paths)
- ❌ pgvector / ANN index (deferred — brute-force đủ dùng ở scale hiện tại)
