# Research: Local Folder Import (005)

**Phase**: 0 — Pre-implementation research
**Feature**: `005-local-folder-import`
**Project**: RAD Knowledge Gateway (`github.com/rad-system/m365-knowledge-graph`)
**Date**: 2026-07-17

---

## 1. Codebase Inventory

### 1.1 Existing parser package (`internal/parsers/`)

| File | State | Notes |
|------|-------|-------|
| `pdf.go` | ⚠️ Stub | Regex-based text scraping — misses encrypted/complex PDFs. Does **not** use a real PDF library. |
| `docx.go` | ? | Exists; needs inspection |
| `xlsx.go` | ? | Exists; needs inspection |
| `text.go` | ? | Exists; needs inspection |
| `pptx.go` | exists | Out of scope for this feature |
| `chunker.go` | ✅ Real | Word-based sliding window, 512-word chunks, 128-word overlap, MD5 content hash |

**Resolution**: The PDF parser must be replaced or augmented with a proper library before Local Folder Import can meet SC-002 (95% extraction accuracy). This is a prerequisite task.

### 1.2 Existing storage layer

**PostgreSQL (`internal/metadata/`)**

Current tables (confirmed from query.go):
- `m365_files` — source files (source_type, source_id, drive_id, file_name, file_type, file_size, content_hash, last_modified, permissions_json)
- `chunks` — text chunks (file_id, chunk_index, text, content_hash, heading_path)
- `chunk_embeddings` — (chunk_id, model_id, embedding BYTEA)
- `embedding_models` — (name, version, dims)
- `delta_state` — per-source change tokens (source, change_token, has_more, last_sync_at)
- `m365_connections` — connector config (name, type, tenant_id, config_json, status)
- `permission_cache` — (user_id, file_id, permission)
- `embedding_jobs`, `query_logs`, `feedback_events`, `extraction_confidence`

**Neo4j (`internal/graph/`)**

Used for entity/relationship graph. Nodes linked to m365_files.file_id.

### 1.3 Existing scheduler pattern

`internal/scheduler/delta_sync.go` — ticker-based background job, no external queue. Pattern:
```go
type DeltaSyncScheduler struct { interval time.Duration; stop chan struct{} }
func (s *DeltaSyncScheduler) Start(ctx context.Context, fn func(context.Context) error)
```
Local import jobs will follow this same pattern for background execution.

### 1.4 Existing handler pattern

`internal/api/handlers_m365.go` — pattern for CRUD+sync handlers:
- Struct-based dependency injection (`M365Deps`)
- Direct `*sql.DB` usage (no ORM)
- `http.HandlerFunc` returns
- JSON encode/decode inline

### 1.5 Module path

`github.com/rad-system/m365-knowledge-graph` — new packages go under `internal/localimport/`.

---

## 2. Technical Unknowns Resolved

### Q1: Which Go PDF library to use?

**Decision**: `github.com/ledongthuc/pdf` (MIT, pure Go, no CGO)

- `pdfcpu` — good for manipulation, text extraction is limited
- `dslipak/pdf` / `ledongthuc/pdf` — pure Go, adequate for structured PDFs
- `gen2brain/go-fitz` (MuPDF via CGO) — best accuracy but requires CGO + system lib; rejected for cross-platform build simplicity

Fallback: If `ledongthuc/pdf` fails on a given PDF (encrypted, XFA, etc.), fall back to current regex scraper and mark the chunk as `low_confidence: true`.

**Action**: Replace `internal/parsers/pdf.go` with `ledongthuc/pdf`-based implementation. Keep the regex scraper as fallback.

### Q2: Which Go DOCX library to use?

**Decision**: `github.com/fumiama/go-docx` (MIT, pure Go)

Alternative: `baliance/gooxml` (archived) — rejected; unmaintained.

The existing `internal/parsers/docx.go` needs inspection. If it's already using a library, reuse it.

### Q3: Which Go XLSX library to use?

**Decision**: `github.com/xuri/excelize/v2` (BSD-3, pure Go, actively maintained)

The existing `internal/parsers/xlsx.go` may already import excelize — inspect before adding dependency.

### Q4: Encoding detection for text files

**Decision**: `golang.org/x/text/encoding/charmap` + `golang.org/x/text/transform` for UTF-16 / Latin-1. For auto-detection: `github.com/saintfish/chardet` (Go port of ICU's charset detector, MIT).

Strategy:
1. Check BOM: UTF-8 BOM (`EF BB BF`), UTF-16 LE/BE BOM
2. Try `chardet.Detect()` on the first 4KB
3. If confidence < 0.7 → treat as binary (metadata-only)
4. Convert to UTF-8 before chunking

### Q5: Background job processing (no external queue)

**Decision**: In-process goroutine pool with a bounded channel queue, same pattern as `scheduler/delta_sync.go`.

Design:
```
LocalImportQueue (chan ImportJob, buffer=100)
→ N worker goroutines (N = min(4, GOMAXPROCS))
→ each worker runs: scan → extract → chunk → embed → store
```

Job state is persisted in `import_jobs` PostgreSQL table. Workers update status to `running` on pickup, `completed`/`failed` on finish.

Import jobs survive server restart? **No** — in-flight jobs become `stale` on restart; a restart scanner marks them `failed` and allows re-triggering. This matches the existing embedding_jobs pattern.

### Q6: Delta sync strategy

**Decision**: Hash-based change detection using SHA-256 of file content, stored per `local_document`.

Comparison on each sync:
1. Walk filesystem → collect `(relative_path, mtime, size)`
2. For files where `mtime` or `size` differs from stored record → re-read and compute SHA-256
3. If SHA-256 differs → mark as `modified`, re-extract and re-chunk
4. If `mtime`/`size` identical → skip (fast path, no disk read)
5. Files in DB but not on disk → mark as `deleted`, remove chunks + embeddings + graph nodes

mtime-only delta as optimization: only recompute SHA-256 when mtime changes. This handles the common case of filesystem restores that reset mtime without content change.

### Q7: Path traversal prevention in Go

**Decision**: Validate using `filepath.Clean` + `strings.HasPrefix(cleaned, allowedRoot)` after `filepath.Abs`.

```go
func validateSourcePath(root, userInput string) (string, error) {
    abs, err := filepath.Abs(userInput)
    if err != nil { return "", err }
    clean := filepath.Clean(abs)
    // Reject UNC paths on Windows
    if strings.HasPrefix(clean, `\\`) { return "", ErrUNCPath }
    // Reject paths outside allowed roots (if any workspace boundary applies)
    return clean, nil
}
```

Symlink resolution: use `os.Lstat` to detect symlinks; if `follow_symlinks=false`, skip `os.ModeSymlink` entries. If `follow_symlinks=true`, resolve with `filepath.EvalSymlinks` and check the resolved path against the source root to detect escapes (cycle detection via visited inode set).

### Q8: Sensitive path redaction from logs

**Decision**: Redact path components after the configured source root. Log only source ID + relative path, never absolute path.

```go
func redactPath(absPath, sourceRoot string) string {
    rel, err := filepath.Rel(sourceRoot, absPath)
    if err != nil { return "<redacted>" }
    return rel
}
```

For error events: log `source_id=<uuid> rel_path=<relative>`. Never log `absPath` directly.

### Q9: How does local source content appear in `/api/knowledge/query`?

**Confirmed**: The retrieval pipeline (`internal/retrieval/stages.go`) operates on `chunks` + `chunk_embeddings` + Neo4j via file_id. As long as local documents insert into `m365_files` (or a parallel `local_files` table with same schema shape) and `chunks`, they participate in semantic search automatically.

**Decision**: Reuse `m365_files` table for local files with `source_type = 'local'` and `source_id = <local_source_uuid>`. No schema change to the retrieval pipeline needed. Source attribution in results comes from the `source_type` field.

Alternatively: a separate `local_files` table mirrors `m365_files` schema, avoiding `source_type` overloading. **Preferred** for isolation (FR-029, FR-030).

**Final decision**: New table `local_files` with same chunk FK structure. Retrieval pipeline gets a new optional JOIN to include local chunks. This keeps M365 and local data separate without risk of cross-contamination.

### Q10: Concurrent writes during import

**Decision**: File snapshot at job start. The scanner records `(path, mtime, size)` at scan time. If a file changes mid-processing, the next sync will detect it. No file locking needed — reads are sequential per file.

### Q11: Large file handling (>100MB, up to 500MB)

**Decision**: Streaming read with chunked processing.

```go
// Stream file in 8MB blocks, feed to parser
// Parser emits text segments as it reads
// Chunker accumulates segments into 512-word chunks
// Each chunk → embed → store immediately (don't hold all in memory)
```

For XLSX with many sheets: process sheet-by-sheet. For DOCX: process paragraph-by-paragraph.

### Q12: Binary file detection

**Decision**: Use `net/http.DetectContentType` on the first 512 bytes (uses Go's built-in sniff table). If detected MIME is not in `text/`, `application/pdf`, `application/vnd.openxmlformats*`, or `application/vnd.ms-excel*` → mark as binary.

Secondary: check file extension against supported set. If extension is supported but MIME detection says binary → try parsing anyway; if parsing returns empty string → fall back to metadata-only.

### Q13: Symlink cycle detection

**Decision**: Track visited inodes using `os.Lstat()` → `Sys().(*syscall.Stat_t).Ino` on Linux. On Windows, use `os.SameFile` comparison between the symlink target and each ancestor directory.

---

## 3. New Tables Required

### 3.1 `local_sources`

Stores configured local folder sources. Separate from `m365_connections` (FR-029).

```sql
CREATE TABLE local_sources (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    folder_path TEXT NOT NULL,  -- absolute path, OS-native separator
    recursive   BOOLEAN NOT NULL DEFAULT true,
    include_ext TEXT[],         -- NULL = all; e.g. {'.pdf','.docx'}
    exclude_ext TEXT[],         -- e.g. {'.tmp','.log'}
    hidden_files BOOLEAN NOT NULL DEFAULT false,  -- include hidden files?
    follow_symlinks BOOLEAN NOT NULL DEFAULT false,
    max_depth   INT NOT NULL DEFAULT 100,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    status      TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'unavailable'
    last_sync_at TIMESTAMPTZ,
    file_count  INT NOT NULL DEFAULT 0,
    total_size  BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.2 `import_jobs`

Tracks each import execution.

```sql
CREATE TABLE import_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID NOT NULL REFERENCES local_sources(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'queued',  -- queued|running|completed|failed
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    files_total     INT NOT NULL DEFAULT 0,
    files_added     INT NOT NULL DEFAULT 0,
    files_modified  INT NOT NULL DEFAULT 0,
    files_deleted   INT NOT NULL DEFAULT 0,
    files_skipped   INT NOT NULL DEFAULT 0,
    files_binary    INT NOT NULL DEFAULT 0,
    error_messages  TEXT[],
    progress_pct    INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX import_jobs_source_id ON import_jobs(source_id);
CREATE INDEX import_jobs_status    ON import_jobs(status);
```

### 3.3 `local_files`

Per-file tracking for delta sync. Mirrors `m365_files` schema where needed for retrieval compatibility.

```sql
CREATE TABLE local_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       UUID NOT NULL REFERENCES local_sources(id) ON DELETE CASCADE,
    rel_path        TEXT NOT NULL,          -- path relative to source folder_path
    file_name       TEXT NOT NULL,
    file_size       BIGINT NOT NULL,
    mtime           TIMESTAMPTZ NOT NULL,
    mime_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
    encoding        TEXT,                   -- detected charset, NULL for binary
    is_binary       BOOLEAN NOT NULL DEFAULT false,
    content_hash    TEXT NOT NULL DEFAULT '', -- SHA-256 of file content
    chunk_count     INT NOT NULL DEFAULT 0,
    imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(source_id, rel_path)
);
CREATE INDEX local_files_source_id  ON local_files(source_id);
CREATE INDEX local_files_content_hash ON local_files(content_hash);
```

### 3.4 Chunk linkage

Reuse existing `chunks` table with `file_id` FK. Need a bridge:

**Option A**: Add `local_file_id UUID REFERENCES local_files(id)` nullable column to `chunks`.

**Option B**: Create `local_chunks` table mirroring `chunks` structure.

**Decision**: Option A — add nullable `local_file_id` to `chunks`. Keep `file_id` for M365. A chunk has either `file_id` OR `local_file_id`, not both. Add CHECK constraint: `(file_id IS NOT NULL) <> (local_file_id IS NOT NULL)`.

Retrieval queries join on either column. Minimizes schema migration scope.

---

## 4. Go Package Structure

```
internal/
  localimport/
    source.go          -- LocalSource entity, CRUD store
    job.go             -- ImportJob entity, job store
    file.go            -- LocalFile entity, file store  
    scanner.go         -- filesystem walker (recursive, filters, symlink handling)
    path.go            -- path validation, redaction, normalization
    dispatcher.go      -- job queue (channel-based), worker pool
    processor.go       -- orchestrates: scan → extract → chunk → embed → store
    extractor.go       -- routes to parsers by MIME type
    encoding.go        -- text encoding detection + conversion
    neo4j.go           -- creates/updates graph nodes for local docs
    handler.go         -- HTTP handlers: POST/GET/DELETE /api/local/sources, POST /api/local/sync
```

---

## 5. Retrieval Pipeline Integration

`internal/retrieval/stages.go` — SemanticSearch currently queries:
```sql
SELECT c.id, c.text, ... FROM chunks c 
JOIN chunk_embeddings ce ON ce.chunk_id = c.id
WHERE ce.model_id = $1
```

After this feature: also join local chunks via `local_file_id`. The `ScoredChunk` struct adds a `SourceType` field (`"m365"` | `"local"`) populated from the JOIN.

Source attribution in query results: current `retrieval.Result` struct needs `SourceType` and `SourcePath` fields. The `localimport.LocalFile.rel_path` provides the display path (e.g., `"Local: reports/q1.pdf"`).

---

## 6. Performance Analysis

| Operation | Target (SC-007) | Strategy |
|-----------|----------------|----------|
| Scan 10K files | < 30s | `filepath.WalkDir` with goroutine per-dir (bounded pool) |
| Delta check 10K files (50 changed) | < 5min (SC-003) | mtime fast-path: skip SHA-256 if mtime+size unchanged |
| Embed + store 100 files/s (SC-007) | — | Batch DB inserts (`COPY`-style); embed in parallel (bounded) |
| Large file 500MB (SC-004) | no crash | Streaming read, 8MB blocks, immediate chunk→embed→store |

Batch insert strategy: use `pq.CopyIn` (lib/pq bulk copy) for `chunks` inserts during large imports. Fallback to multi-row `INSERT` if copy fails.

---

## 7. Security Checklist

| Threat | Mitigation |
|--------|-----------|
| Path traversal | `filepath.Abs` + `filepath.Clean` + `strings.HasPrefix(clean, sourceRoot)` |
| Symlink escape | `os.Lstat` + `filepath.EvalSymlinks` + root check on resolved path |
| UNC path injection (Windows) | Reject paths starting with `\\` |
| Sensitive path in logs | Log only `source_id` + `rel_path`, never absolute path |
| Excessive resource use | Per-source file size limit; configurable max_depth |

---

## 8. Open Questions (Deferred)

| # | Question | Decision |
|---|----------|----------|
| OQ-1 | Auto-scheduled sync (cron-style per source) | Out of scope for MVP; US-6 is P3 stretch goal |
| OQ-2 | pgvector for ANN search as corpus grows | Deferred per existing research.md §6 decision |
| OQ-3 | ACL inheritance from OS (per-user file permissions) | Future enhancement; MVP treats all local files as readable |
| OQ-4 | Network file systems (NFS/SMB) — special handling? | Treated as local paths; no NFS-specific code |
| OQ-5 | Web UI for source management | Separate spec; this feature delivers API only |

---

## 9. Dependency Changes

Add to `go.mod`:
```
github.com/ledongthuc/pdf        v0.0.0-20240201131950-da5d75209b0d  # PDF text extraction
github.com/fumiama/go-docx       v1.1.3                               # DOCX (if existing docx.go is stub)
github.com/xuri/excelize/v2      v2.8.1                               # XLSX (if not already present)
github.com/saintfish/chardet     v0.0.0-20230101081208-5e3ef4b5456d   # encoding detection
golang.org/x/text                v0.14.0                              # encoding conversion
```

Check existing `go.mod` before adding — `excelize` may already be imported by `internal/parsers/xlsx.go`.

---

## 10. Constitution Compliance Check

| Principle | How this feature satisfies it |
|-----------|-------------------------------|
| I. Accuracy Over Speed | PDF library upgrade (ledongthuc/pdf) + fallback; encoding detection before chunking |
| II. Semantic Knowledge > Raw Text | Graph nodes created for each local document with entity extraction via existing NLP pipeline |
| III. Test-First Deterministic Verification | Unit tests for scanner, path validator, encoding detector; integration test uses temp dir with known files |
| IV. Hybrid Retrieval Architecture | Local chunks join the same semantic + graph retrieval pipeline as M365 |
| V. Source-of-Truth Hierarchy & Traceability | `local_files.rel_path` + `source_id` provides full traceability; `source_type='local'` in results |
