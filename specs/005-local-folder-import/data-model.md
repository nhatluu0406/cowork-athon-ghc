# Data Model: Local Folder Import (005)

**Feature**: `005-local-folder-import`
**Date**: 2026-07-17

---

## 1. PostgreSQL Schema

### 1.1 `local_sources`

Một bản ghi = một thư mục cục bộ được cấu hình làm nguồn tài liệu.

```sql
CREATE TABLE local_sources (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,                        -- tên hiển thị
    folder_path     TEXT        NOT NULL,                        -- đường dẫn tuyệt đối, đã chuẩn hoá
    recursive       BOOLEAN     NOT NULL DEFAULT true,
    include_ext     TEXT[],                                      -- NULL = tất cả; VD: {'.pdf','.docx'}
    exclude_ext     TEXT[],                                      -- VD: {'.tmp','.log'}
    hidden_files    BOOLEAN     NOT NULL DEFAULT false,          -- bao gồm file ẩn (bắt đầu bằng '.')?
    follow_symlinks BOOLEAN     NOT NULL DEFAULT false,
    max_depth       INT         NOT NULL DEFAULT 100,
    enabled         BOOLEAN     NOT NULL DEFAULT true,
    status          TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','unavailable')),
    last_sync_at    TIMESTAMPTZ,
    file_count      INT         NOT NULL DEFAULT 0,
    total_size      BIGINT      NOT NULL DEFAULT 0,              -- bytes
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**State machine `status`**:
```
active  ──(folder deleted/inaccessible)──►  unavailable
unavailable  ──(folder restored, user re-enables)──►  active
active  ──(user disables: enabled=false)──►  active (still, just disabled)
```

**Constraint**: `folder_path` không chứa `..` sau khi `filepath.Clean`; không bắt đầu bằng `\\` (UNC).

---

### 1.2 `import_jobs`

Một bản ghi = một lần chạy import cho một nguồn.

```sql
CREATE TABLE import_jobs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID        NOT NULL REFERENCES local_sources(id) ON DELETE CASCADE,
    status          TEXT        NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','completed','failed','stale')),
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    files_total     INT         NOT NULL DEFAULT 0,
    files_added     INT         NOT NULL DEFAULT 0,
    files_modified  INT         NOT NULL DEFAULT 0,
    files_deleted   INT         NOT NULL DEFAULT 0,
    files_skipped   INT         NOT NULL DEFAULT 0,   -- permission-denied, filter-excluded
    files_binary    INT         NOT NULL DEFAULT 0,   -- metadata-only
    error_messages  TEXT[],
    progress_pct    INT         NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX import_jobs_source_id ON import_jobs(source_id);
CREATE INDEX import_jobs_status    ON import_jobs(status) WHERE status IN ('queued','running');
```

**State machine `status`**:
```
queued ──(worker picks up)──► running
running ──(success)──► completed
running ──(error)──► failed
running ──(server restart with job in-flight)──► stale   (set at startup)
```

Only one job per source can be `running` at a time. Enforced by dispatcher before enqueue.

---

### 1.3 `local_files`

Một bản ghi = một file đã import từ nguồn cục bộ. Dùng cho delta sync và truy vết nguồn.

```sql
CREATE TABLE local_files (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID        NOT NULL REFERENCES local_sources(id) ON DELETE CASCADE,
    rel_path        TEXT        NOT NULL,   -- đường dẫn tương đối từ folder_path
    file_name       TEXT        NOT NULL,
    file_size       BIGINT      NOT NULL,
    mtime           TIMESTAMPTZ NOT NULL,
    mime_type       TEXT        NOT NULL DEFAULT 'application/octet-stream',
    encoding        TEXT,                  -- charset được detect; NULL nếu binary
    is_binary       BOOLEAN     NOT NULL DEFAULT false,
    content_hash    TEXT        NOT NULL DEFAULT '', -- SHA-256 hex
    chunk_count     INT         NOT NULL DEFAULT 0,
    imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT local_files_source_path UNIQUE (source_id, rel_path)
);

CREATE INDEX local_files_source_id    ON local_files(source_id);
CREATE INDEX local_files_content_hash ON local_files(content_hash);
```

---

### 1.4 Chunk linkage — migration of `chunks` table

The existing `chunks` table:
```sql
-- hiện tại
CREATE TABLE chunks (
    id           BIGSERIAL PRIMARY KEY,
    file_id      BIGINT NOT NULL REFERENCES m365_files(id) ON DELETE CASCADE,
    chunk_index  INT    NOT NULL,
    text         TEXT   NOT NULL,
    content_hash TEXT   NOT NULL,
    heading_path TEXT   NOT NULL DEFAULT ''
);
```

**Migration** — thêm cột `local_file_id` nullable:
```sql
ALTER TABLE chunks ADD COLUMN local_file_id UUID REFERENCES local_files(id) ON DELETE CASCADE;

-- Đảm bảo mỗi chunk thuộc về đúng một nguồn
ALTER TABLE chunks ADD CONSTRAINT chunks_source_xor
    CHECK (
        (file_id IS NOT NULL AND local_file_id IS NULL) OR
        (file_id IS NULL AND local_file_id IS NOT NULL)
    );

-- Bỏ NOT NULL constraint trên file_id để cho phép local-only chunks
ALTER TABLE chunks ALTER COLUMN file_id DROP NOT NULL;

CREATE INDEX chunks_local_file_id ON chunks(local_file_id) WHERE local_file_id IS NOT NULL;
```

Chunk embeddings (`chunk_embeddings`) không thay đổi — FK vào `chunks.id` vẫn hợp lệ.

---

## 2. Neo4j Graph Schema

### 2.1 Node: `LocalDocument`

```cypher
CREATE (d:LocalDocument {
    local_file_id : "<uuid>",     -- FK to local_files.id
    source_id     : "<uuid>",     -- FK to local_sources.id
    rel_path      : "reports/q1.pdf",
    file_name     : "q1.pdf",
    mime_type     : "application/pdf",
    imported_at   : datetime()
})
```

Constraint:
```cypher
CREATE CONSTRAINT local_doc_unique IF NOT EXISTS
    FOR (d:LocalDocument) REQUIRE d.local_file_id IS UNIQUE;
```

### 2.2 Relationships

```cypher
// LocalDocument ─[PART_OF]─► LocalSource
(d:LocalDocument)-[:PART_OF]->(s:LocalSource {source_id: "<uuid>"})

// LocalDocument ─[MENTIONS]─► Entity  (from existing NLP extraction)
(d:LocalDocument)-[:MENTIONS {confidence: 0.87}]->(e:Entity {name: "Project Alpha"})

// LocalDocument ─[SIMILAR_TO]─► Document | LocalDocument
// (populated by graph expansion in retrieval pipeline)
```

### 2.3 Node: `LocalSource`

```cypher
CREATE (s:LocalSource {
    source_id  : "<uuid>",
    name       : "Engineering Docs",
    folder_path: "/home/user/docs"   -- not logged, only stored in graph
})
```

---

## 3. Go Type Definitions

### 3.1 `internal/localimport/source.go`

```go
package localimport

import "time"

type LocalSource struct {
    ID             string    `json:"id"`
    Name           string    `json:"name"`
    FolderPath     string    `json:"folder_path"`
    Recursive      bool      `json:"recursive"`
    IncludeExt     []string  `json:"include_ext,omitempty"`  // nil = all
    ExcludeExt     []string  `json:"exclude_ext,omitempty"`
    HiddenFiles    bool      `json:"hidden_files"`
    FollowSymlinks bool      `json:"follow_symlinks"`
    MaxDepth       int       `json:"max_depth"`
    Enabled        bool      `json:"enabled"`
    Status         string    `json:"status"`  // "active" | "unavailable"
    LastSyncAt     *time.Time `json:"last_sync_at,omitempty"`
    FileCount      int       `json:"file_count"`
    TotalSize      int64     `json:"total_size"`
    CreatedAt      time.Time `json:"created_at"`
    UpdatedAt      time.Time `json:"updated_at"`
}
```

### 3.2 `internal/localimport/job.go`

```go
type ImportJob struct {
    ID            string     `json:"id"`
    SourceID      string     `json:"source_id"`
    Status        JobStatus  `json:"status"`
    StartedAt     *time.Time `json:"started_at,omitempty"`
    FinishedAt    *time.Time `json:"finished_at,omitempty"`
    FilesTotal    int        `json:"files_total"`
    FilesAdded    int        `json:"files_added"`
    FilesModified int        `json:"files_modified"`
    FilesDeleted  int        `json:"files_deleted"`
    FilesSkipped  int        `json:"files_skipped"`
    FilesBinary   int        `json:"files_binary"`
    Errors        []string   `json:"errors,omitempty"`
    ProgressPct   int        `json:"progress_pct"`
    CreatedAt     time.Time  `json:"created_at"`
}

type JobStatus string

const (
    JobQueued    JobStatus = "queued"
    JobRunning   JobStatus = "running"
    JobCompleted JobStatus = "completed"
    JobFailed    JobStatus = "failed"
    JobStale     JobStatus = "stale"
)
```

### 3.3 `internal/localimport/file.go`

```go
type LocalFile struct {
    ID          string     `json:"id"`
    SourceID    string     `json:"source_id"`
    RelPath     string     `json:"rel_path"`
    FileName    string     `json:"file_name"`
    FileSize    int64      `json:"file_size"`
    Mtime       time.Time  `json:"mtime"`
    MimeType    string     `json:"mime_type"`
    Encoding    *string    `json:"encoding,omitempty"`
    IsBinary    bool       `json:"is_binary"`
    ContentHash string     `json:"content_hash"`
    ChunkCount  int        `json:"chunk_count"`
    ImportedAt  time.Time  `json:"imported_at"`
    UpdatedAt   time.Time  `json:"updated_at"`
}

// ScanEntry is an in-memory snapshot of a file discovered during filesystem walk.
type ScanEntry struct {
    RelPath  string
    FileName string
    Size     int64
    Mtime    time.Time
    IsDir    bool
    IsSymlink bool
    Mode     os.FileMode
}

// DeltaResult classifies a file after comparing to stored state.
type DeltaResult struct {
    Entry   ScanEntry
    Action  DeltaAction  // Added | Modified | Unchanged | Deleted
    Stored  *LocalFile   // nil if new
}

type DeltaAction int

const (
    DeltaAdded     DeltaAction = iota
    DeltaModified
    DeltaUnchanged
    DeltaDeleted
)
```

---

## 4. Retrieval Integration

### 4.1 Source attribution in query results

`internal/retrieval/stages.go` — `SearchResult` struct gets two new optional fields:

```go
type SearchResult struct {
    ChunkID     int64   `json:"chunk_id"`
    Text        string  `json:"text"`
    Score       float64 `json:"score"`
    // Existing:
    FileID      *int64  `json:"file_id,omitempty"`
    // New:
    LocalFileID *string `json:"local_file_id,omitempty"`
    SourceType  string  `json:"source_type"`  // "m365" | "local"
    DisplayPath string  `json:"display_path"` // "Local: reports/q1.pdf" | "OneDrive: ..."
}
```

### 4.2 SQL change in SemanticSearch

```sql
SELECT
    c.id AS chunk_id,
    c.text,
    c.file_id,
    c.local_file_id,
    CASE
        WHEN c.local_file_id IS NOT NULL THEN 'local'
        ELSE 'm365'
    END AS source_type,
    CASE
        WHEN c.local_file_id IS NOT NULL THEN 'Local: ' || lf.rel_path
        ELSE 'M365: ' || mf.file_name
    END AS display_path
FROM chunks c
JOIN chunk_embeddings ce ON ce.chunk_id = c.id
LEFT JOIN local_files lf ON lf.id = c.local_file_id
LEFT JOIN m365_files mf  ON mf.id = c.file_id
WHERE ce.model_id = $1
```

---

## 5. Migration Plan

| Step | SQL | Rollback |
|------|-----|---------|
| M1 | `CREATE TABLE local_sources` | `DROP TABLE local_sources` |
| M2 | `CREATE TABLE import_jobs` | `DROP TABLE import_jobs` |
| M3 | `CREATE TABLE local_files` | `DROP TABLE local_files` |
| M4 | `ALTER TABLE chunks ADD COLUMN local_file_id UUID` | `ALTER TABLE chunks DROP COLUMN local_file_id` |
| M5 | `ALTER TABLE chunks ALTER COLUMN file_id DROP NOT NULL` | `ALTER TABLE chunks ALTER COLUMN file_id SET NOT NULL` (only if no local rows exist) |
| M6 | Add `chunks_source_xor` CHECK constraint | `ALTER TABLE chunks DROP CONSTRAINT chunks_source_xor` |
| M7 | Create Neo4j constraints | Recreatable any time |

Migrations thực hiện trong transaction riêng; M4–M6 cùng một transaction vì có dependency.
