# API Contracts: Local Folder Import (005)

**Base path**: `/api/local`
**Auth**: Bearer JWT (existing `internal/api/authz.go` middleware)
**Content-Type**: `application/json`

---

## 1. `POST /api/local/sources` — Tạo nguồn cục bộ

### Request

```json
{
  "name": "Engineering Docs",
  "folder_path": "/home/user/engineering",
  "recursive": true,
  "include_ext": [".pdf", ".docx", ".md"],
  "exclude_ext": [],
  "hidden_files": false,
  "follow_symlinks": false,
  "max_depth": 100
}
```

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `name` | string | ✓ | 1–200 chars |
| `folder_path` | string | ✓ | Absolute path; validated server-side (no `..`, no UNC) |
| `recursive` | bool | — | Default: `true` |
| `include_ext` | string[] | — | Each starts with `.`; `null` or omit = all types |
| `exclude_ext` | string[] | — | Each starts with `.` |
| `hidden_files` | bool | — | Default: `false` |
| `follow_symlinks` | bool | — | Default: `false` |
| `max_depth` | int | — | 1–1000; Default: `100` |

### Responses

**201 Created**
```json
{
  "id": "a3f7c2d1-...",
  "name": "Engineering Docs",
  "folder_path": "/home/user/engineering",
  "recursive": true,
  "include_ext": [".pdf", ".docx", ".md"],
  "exclude_ext": [],
  "hidden_files": false,
  "follow_symlinks": false,
  "max_depth": 100,
  "enabled": true,
  "status": "active",
  "last_sync_at": null,
  "file_count": 0,
  "total_size": 0,
  "created_at": "2026-07-17T10:00:00Z",
  "updated_at": "2026-07-17T10:00:00Z"
}
```

**400 Bad Request** — validation error
```json
{ "error": "invalid_path", "message": "folder_path must be an absolute path" }
```

**409 Conflict** — path already registered as a source
```json
{ "error": "path_exists", "message": "a source with this folder_path already exists" }
```

**Error codes**: `invalid_path` | `path_not_found` | `path_not_directory` | `path_traversal` | `path_exists` | `invalid_request`

---

## 2. `GET /api/local/sources` — Liệt kê nguồn

### Response 200
```json
{
  "sources": [
    {
      "id": "a3f7c2d1-...",
      "name": "Engineering Docs",
      "folder_path": "/home/user/engineering",
      "recursive": true,
      "enabled": true,
      "status": "active",
      "last_sync_at": "2026-07-17T09:00:00Z",
      "file_count": 342,
      "total_size": 124500000
    }
  ]
}
```

Note: `folder_path` is returned to authenticated users only. Ensure path is not included in error logs.

---

## 3. `GET /api/local/sources/{id}` — Chi tiết nguồn

### Path parameter
- `id`: UUID of the local source

### Response 200 — same shape as single source object from POST response

**404 Not Found**
```json
{ "error": "not_found", "message": "source not found" }
```

---

## 4. `PATCH /api/local/sources/{id}` — Cập nhật nguồn

Partial update — only provided fields are changed.

### Request (all fields optional)
```json
{
  "name": "Engineering Docs v2",
  "enabled": false,
  "include_ext": [".pdf"],
  "recursive": false
}
```

Note: `folder_path` cannot be changed after creation (must delete and recreate). Changing `include_ext`/`exclude_ext` takes effect on the next sync.

### Response 200 — updated source object

**400** if attempting to change `folder_path`:
```json
{ "error": "immutable_field", "message": "folder_path cannot be changed; delete and recreate the source" }
```

---

## 5. `DELETE /api/local/sources/{id}` — Xoá nguồn

Removes the source and all associated data: `local_files`, chunks with `local_file_id`, embeddings, Neo4j nodes. Runs as a background cleanup job.

### Response 202 Accepted
```json
{
  "id": "a3f7c2d1-...",
  "cleanup_started": true
}
```

**404** if source not found.

Note: Returns 202 (not 204) because cleanup is asynchronous for large sources.

---

## 6. `POST /api/local/sync` — Trigger import

### Request
```json
{
  "source_id": "a3f7c2d1-..."
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `source_id` | UUID | ✓ | Must exist and be enabled |

### Response 202 Accepted
```json
{
  "job_id": "b8e21f3a-...",
  "source_id": "a3f7c2d1-...",
  "status": "queued"
}
```

**400** — source disabled:
```json
{ "error": "source_disabled", "message": "source is disabled; enable it before syncing" }
```

**409** — job already running:
```json
{ "error": "job_running", "message": "an import job is already running for this source", "job_id": "..." }
```

**404** — source not found.

---

## 7. `GET /api/local/jobs` — Liệt kê import jobs

### Query parameters
- `source_id` (optional): filter by source
- `status` (optional): `queued` | `running` | `completed` | `failed`
- `limit` (optional): default 20, max 100
- `offset` (optional): default 0

### Response 200
```json
{
  "jobs": [
    {
      "id": "b8e21f3a-...",
      "source_id": "a3f7c2d1-...",
      "status": "completed",
      "started_at": "2026-07-17T09:00:00Z",
      "finished_at": "2026-07-17T09:02:14Z",
      "files_total": 342,
      "files_added": 300,
      "files_modified": 40,
      "files_deleted": 2,
      "files_skipped": 5,
      "files_binary": 8,
      "errors": [],
      "progress_pct": 100,
      "created_at": "2026-07-17T09:00:00Z"
    }
  ],
  "total": 1
}
```

---

## 8. `GET /api/local/jobs/{id}` — Chi tiết job

### Response 200 — single job object (same shape as list item)

Includes `errors` array with up to 100 recent error messages.

---

## 9. Error Response Shape (tất cả endpoints)

```json
{
  "error": "<error_code>",
  "message": "<human-readable message, never contains raw paths or secrets>"
}
```

HTTP status codes:
- `400` — validation error, bad request
- `401` — missing/invalid JWT
- `403` — forbidden (future: ACL check)
- `404` — resource not found
- `409` — conflict (duplicate, already running)
- `500` — unexpected server error (message: generic, details in server log only)

---

## 10. Integration with `/api/knowledge/query`

No API change. Local documents appear automatically in results once indexed. Result items gain two new fields:

```json
{
  "chunk_id": 12345,
  "text": "...",
  "score": 0.92,
  "source_type": "local",
  "display_path": "Local: reports/q1-2026.pdf"
}
```

For M365 results: `"source_type": "m365"`, `"display_path": "OneDrive: Engineering/spec.docx"`.
