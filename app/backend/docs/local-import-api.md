# Local Folder Import API - Vietnamese Documentation

## Tổng Quan (Overview)

API Local Folder Import cho phép người dùng thêm các thư mục cục bộ vào hệ thống và tự động nhập tất cả các tài liệu để tìm kiếm. Hệ thống sẽ quét thư mục, trích xuất nội dung từ các định dạng hỗ trợ, chia nhỏ thành các đoạn (chunks), và tích hợp vào công cụ tìm kiếm kiến thức.

**Supported formats**: PDF, DOCX, XLSX, TXT, MD

**Architecture**: Local files → Scanner → Extractor → Chunker → PostgreSQL chunks table (+ embeddings) → Knowledge search

---

## Bảo Mật (Security & Auth)

- **Authentication (bắt buộc)**: MỌI endpoint `/api/local/*` yêu cầu header `Authorization: Bearer <JWT>`.
  Thiếu/token sai → `401 Unauthorized`. `JWTAuth` chưa cấu hình cũng trả `401` (fail-closed).
- **Path confinement**: chỉ chấp nhận đường dẫn tuyệt đối; UNC / `\\?\` / null-byte / `/proc` / `/sys`
  bị từ chối. Khi quét, mỗi tệp được `EvalSymlinks` và phải nằm trong thư mục gốc — symlink/junction
  trỏ ra ngoài bị bỏ qua.
- **Giới hạn tài nguyên**: tệp lớn hơn `MaxFileSize` (25 MiB) bị bỏ qua (không đọc vào bộ nhớ).
  Mỗi job có timeout 30 phút.
- **Chống trùng job**: chỉ một job `queued`/`running` cho mỗi source (unique index). Gọi sync khi đã
  có job đang chạy → `409 Conflict` (`{"error":"job_running"}`).
- **Không rò rỉ**: log và phản hồi lỗi chỉ chứa đường dẫn tương đối đã redact, không phải đường dẫn
  tuyệt đối hay nội dung tệp.
- **Chunks cục bộ**: lưu với `local_file_id` (không phải `file_id`), và được nhúng (embedding) dưới
  cùng model mà truy hồi (retrieval) sử dụng để tìm kiếm ngữ nghĩa (khi có embedding runtime).

---

## Setup Ban Đầu (Initial Setup)

### Yêu cầu (Requirements)
- PostgreSQL database with `local_sources`, `import_jobs`, `local_files`, `chunks` tables
- Migration `005_local_import.sql` applied
- Neo4j (optional, for graph-based retrieval)

### Cấu hình (Configuration)
Các cấu hình được lưu trữ trong:
- `local_sources` table: thông tin về thư mục người dùng
- `import_jobs` table: lịch sử và tiến độ công việc nhập
- `local_files` table: các tập tin được nhập
- `chunks` table: nội dung đã được chia nhỏ (có `local_file_id` FK)

---

## Các Endpoint API (Endpoints)

### 1. Tạo Nguồn Cục Bộ
```
POST /api/local/sources
```

**Request:**
```json
{
  "folder_path": "/home/user/documents",
  "name": "Tài liệu công việc",
  "description": "Các tài liệu quan trọng",
  "recursive": true,
  "follow_symlinks": false,
  "hidden_files": false,
  "max_depth": 10,
  "include_ext": [".pdf", ".docx"],
  "exclude_ext": [".tmp", ".log"]
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "folder_path": "/home/user/documents",
  "name": "Tài liệu công việc",
  "enabled": true,
  "recursive": true,
  "created_at": "2026-07-17T10:00:00Z"
}
```

**Error (400 Bad Request):**
- Path must be absolute, not relative
- Path cannot be empty
- Path cannot contain null bytes
- Path cannot contain only whitespace
- UNC paths not supported
- Windows extended-length paths (\\?\) not supported
- System directories (/proc, /sys) not supported

**Auth**: Requires valid JWT

---

### 2. Lấy Danh Sách Nguồn
```
GET /api/local/sources
```

**Query Parameters:**
- `limit` (optional): số lượng kết quả (default 50)
- `offset` (optional): vị trí bắt đầu (default 0)

**Response (200 OK):**
```json
{
  "sources": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "folder_path": "/home/user/documents",
      "name": "Tài liệu công việc",
      "enabled": true,
      "files_total": 42,
      "files_indexed": 38,
      "last_sync_at": "2026-07-17T11:30:00Z",
      "created_at": "2026-07-17T10:00:00Z"
    }
  ],
  "total": 1
}
```

**Auth**: Requires valid JWT

---

### 3. Lấy Chi Tiết Nguồn
```
GET /api/local/sources/{id}
```

**Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "folder_path": "/home/user/documents",
  "name": "Tài liệu công việc",
  "description": "Các tài liệu quan trọng",
  "enabled": true,
  "recursive": true,
  "follow_symlinks": false,
  "hidden_files": false,
  "max_depth": 10,
  "include_ext": [".pdf", ".docx"],
  "exclude_ext": [".tmp", ".log"],
  "files_total": 42,
  "files_indexed": 38,
  "last_sync_at": "2026-07-17T11:30:00Z",
  "created_at": "2026-07-17T10:00:00Z"
}
```

**Error (404 Not Found)**: Unknown source ID

**Auth**: Requires valid JWT

---

### 4. Cập Nhật Nguồn
```
PATCH /api/local/sources/{id}
```

**Request:**
```json
{
  "name": "Tên mới",
  "enabled": true,
  "include_ext": [".pdf"],
  "exclude_ext": []
}
```

**Response (200 OK)**: Updated source object

**Auth**: Requires valid JWT

---

### 5. Xóa Nguồn
```
DELETE /api/local/sources/{id}
```

**Response (202 Accepted):**
```json
{
  "message": "Source and associated files are being deleted asynchronously",
  "job_id": "cleanup-job-123"
}
```

**Behavior**:
- Sets running jobs to 'stale' status
- Deletes all `local_files` records (cascades to `chunks`)
- Deletes the source record
- Cleanup happens asynchronously

**Auth**: Requires valid JWT

---

### 6. Kích Hoạt Đồng Bộ Hóa
```
POST /api/local/sync
```

**Request:**
```json
{
  "source_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response (202 Accepted):**
```json
{
  "job_id": "job-uuid-456",
  "status": "queued",
  "source_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Error (400 Bad Request)**:
- Source is disabled (`source_disabled`)
- Invalid path

**Error (409 Conflict)**:
```json
{
  "error": "job_running",
  "job_id": "currently-running-job-id"
}
```

**Auth**: Requires valid JWT

---

### 7. Lấy Danh Sách Công Việc Nhập
```
GET /api/local/jobs
```

**Query Parameters:**
- `source_id` (optional): lọc theo nguồn
- `status` (optional): queued, running, completed, failed, stale
- `limit` (optional): số lượng kết quả (default 50)
- `offset` (optional): vị trí bắt đầu (default 0)

**Response (200 OK):**
```json
{
  "jobs": [
    {
      "id": "job-uuid-456",
      "source_id": "550e8400-e29b-41d4-a716-446655440000",
      "status": "completed",
      "files_total": 42,
      "files_added": 5,
      "files_modified": 3,
      "files_deleted": 1,
      "files_skipped": 33,
      "progress_pct": 100,
      "error_messages": [],
      "started_at": "2026-07-17T11:30:00Z",
      "finished_at": "2026-07-17T11:45:00Z"
    }
  ]
}
```

**Auth**: Requires valid JWT

---

### 8. Lấy Chi Tiết Công Việc
```
GET /api/local/jobs/{id}
```

**Response (200 OK):**
```json
{
  "id": "job-uuid-456",
  "source_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "files_total": 42,
  "files_added": 5,
  "files_modified": 3,
  "files_deleted": 0,
  "files_skipped": 34,
  "files_binary": 2,
  "progress_pct": 81,
  "error_messages": [
    "permission_denied: docs/confidential.pdf",
    "unsupported_format: media/video.mp4"
  ],
  "started_at": "2026-07-17T11:30:00Z",
  "finished_at": null
}
```

**Error (404 Not Found)**: Unknown job ID

**Auth**: Requires valid JWT

---

## Tích Hợp Tìm Kiếm (Search Integration)

### Truy Vấn Tài Liệu Cục Bộ
```
GET /api/knowledge/query?q=<term>
```

**Response includes local files:**
```json
{
  "results": [
    {
      "id": "result-123",
      "source_type": "local",
      "display_path": "Local: docs/report.pdf",
      "title": "Báo cáo hàng năm",
      "content_preview": "...",
      "relevance_score": 0.92,
      "chunk_text": "Năm 2026 có những thay đổi..."
    },
    {
      "id": "result-m365-456",
      "source_type": "m365",
      "display_path": "M365: SharePoint/Shared Documents/Analysis.docx",
      "title": "Phân tích chi tiết",
      "content_preview": "...",
      "relevance_score": 0.88
    }
  ]
}
```

**Search Logic**:
1. Chuỗi truy vấn được chuyển đổi thành embedding
2. Tìm các chunks tương tự từ cả `local_files` và `m365_files`
3. Xếp hạng theo relevance score
4. Trả về kết quả hỗn hợp (local + M365)

---

## Quy Trình Nhập (Import Pipeline)

```
┌─────────────────────┐
│   Người dùng        │
│ POST /api/local/sync│
└──────────┬──────────┘
           │
           ▼
┌──────────────────────┐
│  Dispatcher Queue    │
│ (capacity: 100)      │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Worker (N workers)  │
│ (max 4 concurrent)   │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Scanner             │
│ Walk(ctx)            │
│ - Recursive          │
│ - Filters            │
│ - Symlinks           │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Delta Resolver      │
│ - Fast path (mtime)  │
│ - Hash (SHA-256)     │
│ - Action: Added/Mod  │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Extractor           │
│ - Detect encoding    │
│ - Parse PDF/DOCX...  │
│ - Binary check       │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Chunker             │
│ - Split by size      │
│ - Preserve headings  │
│ - Batch >500 chunks  │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Chunk Store         │
│ - Batch INSERT (T048)│
│ - local_file_id FK   │
│ - Fallback to single │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Neo4j (Optional)    │
│ - LocalDocument node │
│ - PART_OF rel        │
│ - MENTIONS rel       │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Knowledge Search    │
│ - Embeddings         │
│ - Semantic search    │
│ - source_type:local  │
└──────────────────────┘
```

---

## Delta Sync (Đồng Bộ Hóa Thay Đổi)

### Cơ Chế
Mỗi lần nhập, hệ thống:
1. Quét thư mục lại
2. So sánh với `local_files` table
3. Phân loại: Added, Modified, Unchanged, Deleted
4. Cập nhật `chunks` chỉ cho các tập tin thay đổi
5. Xóa chunks và bản ghi cho các tập tin đã xóa

**Performance**:
- Unchanged files → skip (no processing)
- Added/Modified → re-extract và insert chunks
- Deleted → delete from DB
- Batch insert for >500 chunks in a file

---

## Xử Lý Lỗi (Error Handling)

### Permission Errors
```
EPERM / Access Denied:
- Tập tin được bỏ qua
- Đường dẫn được ghi lại (redacted)
- Tối đa 100 lỗi lưu trữ
- Công việc tiếp tục xử lý các tập tin khác
```

### Unsupported Formats
```
Binary/Unknown:
- Metadata lưu: file_name, size, mtime
- Content extraction bỏ qua (IsBinary=true)
- Không có chunks được tạo
- Có thể tìm kiếm bằng tên tập tin
```

### Large Files
```
Streaming extraction:
- PDF/DOCX >8MB: streaming reader
- Ngừng xử lý nếu quá hạn
- Tập tin được ghi lại là binary
```

---

## Database Schema (Tham Khảo)

```sql
-- Nguồn cục bộ
CREATE TABLE local_sources (
  id UUID PRIMARY KEY,
  folder_path TEXT NOT NULL,
  name TEXT,
  description TEXT,
  enabled BOOLEAN DEFAULT true,
  recursive BOOLEAN DEFAULT true,
  follow_symlinks BOOLEAN DEFAULT false,
  hidden_files BOOLEAN DEFAULT false,
  max_depth INT DEFAULT 10,
  include_ext TEXT[] DEFAULT '{}',
  exclude_ext TEXT[] DEFAULT '{}',
  files_total INT DEFAULT 0,
  files_indexed INT DEFAULT 0,
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Công việc nhập
CREATE TABLE import_jobs (
  id UUID PRIMARY KEY,
  source_id UUID REFERENCES local_sources(id),
  status TEXT DEFAULT 'queued',
  files_total INT DEFAULT 0,
  files_added INT DEFAULT 0,
  files_modified INT DEFAULT 0,
  files_deleted INT DEFAULT 0,
  files_skipped INT DEFAULT 0,
  files_binary INT DEFAULT 0,
  progress_pct INT DEFAULT 0,
  error_messages TEXT[] DEFAULT '{}',
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tập tin cục bộ
CREATE TABLE local_files (
  id UUID PRIMARY KEY,
  source_id UUID REFERENCES local_sources(id),
  rel_path TEXT NOT NULL,
  file_name TEXT,
  file_size INT64,
  mtime TIMESTAMP,
  mime_type TEXT,
  encoding TEXT,
  is_binary BOOLEAN DEFAULT false,
  content_hash TEXT,
  chunk_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Chunks (nội dung chia nhỏ)
CREATE TABLE chunks (
  id SERIAL PRIMARY KEY,
  file_id BIGINT REFERENCES m365_files(id) ON DELETE CASCADE,
  local_file_id UUID REFERENCES local_files(id) ON DELETE CASCADE,
  chunk_index INT,
  text TEXT,
  content_hash TEXT,
  heading_path TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT chunks_source_xor CHECK (
    (file_id IS NOT NULL AND local_file_id IS NULL) OR
    (file_id IS NULL AND local_file_id IS NOT NULL)
  )
);
```

---

## Best Practices (Hướng Dẫn Tốt Nhất)

### Bảo Mật (Security)
- ✅ Xác thực JWT bắt buộc trên tất cả endpoint
- ✅ Xác thực đường dẫn: absolute + no UNC + no /proc
- ✅ Không lưu plaintext secrets
- ✅ Redact đường dẫn trong logs
- ✅ Giới hạn error_messages ở 100 entry

### Hiệu Suất (Performance)
- ✅ Batch insert chunks (>500 per file)
- ✅ Delta sync (skip unchanged)
- ✅ Tối đa 4 workers đồng thời
- ✅ Streaming read cho tập tin lớn

### Khả Năng Phục Hồi (Resilience)
- ✅ Bỏ qua lỗi per-file, tiếp tục
- ✅ Lưu error messages để audit
- ✅ Fallback single insert nếu batch fails
- ✅ Mark stale jobs nếu source bị xóa

---

## Ví Dụ Cấu Hình (Configuration Examples)

### Chỉ PDF, không đệ quy
```json
{
  "folder_path": "/data/pdfs",
  "name": "PDF Archive",
  "recursive": false,
  "include_ext": [".pdf"]
}
```

### Tất cả tệp, loại trừ logs
```json
{
  "folder_path": "/documents",
  "name": "All Documents",
  "recursive": true,
  "exclude_ext": [".log", ".tmp", ".bak"]
}
```

### Tài liệu Office, sâu 5 cấp
```json
{
  "folder_path": "/work",
  "name": "Office Documents",
  "recursive": true,
  "max_depth": 5,
  "include_ext": [".docx", ".xlsx", ".pptx"]
}
```

---

## Troubleshooting

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-----------|----------|
| 401 Unauthorized | Không có JWT hoặc JWT không hợp lệ | Thêm token hợp lệ vào header Authorization |
| 404 Not Found | Source ID không tồn tại | Kiểm tra source ID, liệt kê nguồn |
| 400 Invalid Path | Đường dẫn không tuyệt đối / UNC | Sử dụng absolute path (e.g. /home/user/docs) |
| 409 Job Running | Công việc nhập đang chạy | Đợi công việc hoàn thành hoặc xóa source |
| Files not indexed | Công việc vẫn đang chạy / Lỗi trích xuất | Kiểm tra job status, xem error_messages |

---

**Version**: 1.0  
**Last Updated**: 2026-07-17  
**Language**: Vietnamese / Tiếng Việt
