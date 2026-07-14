# Data Model: Enterprise Knowledge Graph from Microsoft 365

**Phase**: 1 | **Sources**: spec.md §5 (Phase 1 schema), §6 (Phase 2 schema), §8 (Phase 4 schema), §6 (Neo4j schema)

This consolidates every entity referenced by tasks.md into one place. PostgreSQL DDL is copied verbatim from spec.md (already validated as PostgreSQL, not SQLite — see spec.md provenance note). Neo4j labels/relationships are copied from spec.md §6.

## 1. PostgreSQL entities

### 1.1 `delta_state` — sync cursor per M365 source

| Field | Type | Notes |
|---|---|---|
| `source` | TEXT PK | `'onedrive:/site/drive'` or `'teams:/group/channel'` |
| `change_token` | TEXT NOT NULL | MS Graph delta token |
| `has_more` | BOOLEAN NOT NULL DEFAULT FALSE | pagination continuation flag |
| `last_sync_at` | TIMESTAMPTZ NOT NULL | |

State machine: `IDLE → SYNC_RUNNING → SYNC_PARTIAL_HAS_MORE ⇄ SYNC_RUNNING → SYNC_COMPLETED`, with `→ SYNC_FAILED` from any running state (see spec.md §15.1).

### 1.2 `m365_files` — ingested file/message metadata

| Field | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `source_type` | TEXT NOT NULL | `'onedrive'` \| `'teams'` |
| `source_id` | TEXT NOT NULL | OneDrive item ID or Teams message ID |
| `file_name` | TEXT NOT NULL | |
| `file_type` | TEXT | `docx`\|`xlsx`\|`pptx`\|`pdf`\|`txt`\|`chat_message` |
| `file_size` | INTEGER | |
| `content_hash` | TEXT | dedup/change detection |
| `last_modified` | TIMESTAMPTZ NOT NULL | |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `permissions_json` | JSONB | ACL entries snapshot at ingest time |

### 1.3 `chunks` — parsed text chunks

| Field | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `file_id` | INTEGER NOT NULL → `m365_files(id)` | |
| `chunk_index` | INTEGER NOT NULL | |
| `text` | TEXT NOT NULL | |
| `content_hash` | TEXT NOT NULL | |
| `heading_path` | TEXT | outline hierarchy for docx/pptx |
| | UNIQUE(`file_id`, `chunk_index`) | |

### 1.4 `m365_connections` — configured M365 sources

| Field | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | TEXT NOT NULL | |
| `type` | TEXT NOT NULL | `'onedrive'` \| `'teams'` |
| `tenant_id` | TEXT NOT NULL | |
| `config_json` | JSONB NOT NULL | `site_id`, `group_id`, etc. |
| `status` | TEXT NOT NULL DEFAULT `'active'` | |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### 1.5 `permission_cache` — user↔file access

| Field | Type | Notes |
|---|---|---|
| `user_id` | TEXT NOT NULL | part of PK |
| `file_id` | INTEGER NOT NULL → `m365_files(id)` | part of PK |
| `permission` | TEXT NOT NULL | `'read'`\|`'write'`\|`'owner'` |
| | PRIMARY KEY(`user_id`, `file_id`) | |

**Open gap carried from spec.md §18 item 5**: no staleness/expiry field yet — invalidation trigger on ACL change is unresolved; tasks.md T036 (permission cache refresh) should treat "refresh" as full re-pull until this is resolved, not incremental invalidation.

### 1.6 `embedding_models` — embedding model/version registry

| Field | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | TEXT NOT NULL | |
| `version` | TEXT | nullable |
| `dims` | INTEGER NOT NULL | |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| | UNIQUE(`name`, COALESCE(`version`, '')) | |

### 1.7 `chunk_embeddings` — one embedding per chunk per model

| Field | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `chunk_id` | INTEGER NOT NULL → `chunks(id)` | |
| `model_id` | INTEGER NOT NULL → `embedding_models(id)` | |
| `embedding` | BYTEA NOT NULL | serialized float32[]; see research.md §6 for `pgvector` deferral |
| `embedding_hash` | TEXT | optional dedupe/integrity |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| | UNIQUE(`chunk_id`, `model_id`) | |
| | INDEX on `chunk_id`, INDEX on `model_id` | |

### 1.8 `embedding_jobs` — batch (re-)embedding tracking

| Field | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `status` | TEXT NOT NULL | `queued`\|`running`\|`succeeded`\|`failed` |
| `model_id` | INTEGER NOT NULL → `embedding_models(id)` | |
| `created_at` / `started_at` / `finished_at` | TIMESTAMPTZ | |
| `error` | TEXT | |

### 1.9 `query_logs` — Q&A query history

| Field | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `user_id` | TEXT NOT NULL | |
| `query_text` | TEXT NOT NULL | |
| `intent` | TEXT | one of the 5 intent types (§2.3) |
| `results_count` | INTEGER | |
| `latency_ms` | INTEGER | for SLO tracking |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### 1.10 `feedback_events` — user like/dislike/flag

| Field | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `query_id` | INTEGER NOT NULL → `query_logs(id)` | corrected FK type per spec.md §8 note (was TEXT in earlier draft) |
| `user_id` | TEXT NOT NULL | |
| `feedback_type` | TEXT NOT NULL | `'like'`\|`'dislike'`\|`'flag'` |
| `comment` | TEXT | |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

### 1.11 `extraction_confidence` — per-edge confidence tracking

| Field | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `entity_id` | TEXT NOT NULL | |
| `relationship_type` | TEXT NOT NULL | |
| `target_entity_id` | TEXT NOT NULL | |
| `confidence` | REAL NOT NULL | 0.0-1.0 |
| `feedback_score` | REAL | derived from feedback |
| `last_reevaluated` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

## 2. Neo4j graph model

### 2.1 Node labels

| Label | Key properties |
|---|---|
| `Person` | `email` (indexed), `displayName` (indexed), `department` |
| `Project` | `name` (indexed), `status`, `description` |
| `Document` | `fileName` (indexed), `sourceType`, `sourceId` |
| `Technology` | `name` (indexed) |
| `Customer` | `name` (indexed) |
| `Department` | `name` (indexed) |
| `Chunk` | `chunkId`, `fileHash` |

### 2.2 Relationships

| Relationship | Direction | Notes |
|---|---|---|
| `MANAGES` | `Person → Project` | |
| `WORKS_ON` | `Person → Project` | |
| `BELONGS_TO` | `Person → Department` | |
| `MENTIONS` | `Document → {Person\|Project\|Technology\|Customer}` | also `Chunk → {...}` |
| `CREATED_BY` | `Document → Person` | |
| `USES` | `Project → Technology` | |
| `SERVING` | `Project → Customer` | |
| `PART_OF` | `Chunk → Document` | |

Dedup keys (INVARIANT-3, deterministic indexing): entities deduped by `(type, name)` or `(type, email)` for `Person`; edges deduped by `(from_entity_id, to_entity_id, relationship_type)`.

### 2.3 Query-time entity/intent taxonomy (used by `intent_detector.go`)

Intents: `find_expert`, `find_document`, `find_project_info`, `find_technology_usage`, `general_question`.

## 3. Cross-store relationships

- `chunks.id` ↔ Neo4j `Chunk.chunkId` — a chunk is the join point between PostgreSQL (raw text + embedding) and Neo4j (extracted entities via `MENTIONS`/`PART_OF`).
- `m365_files.id` ↔ Neo4j `Document.sourceId` (via `m365_files.source_id`) — a document's PostgreSQL row and graph node are correlated by `source_type` + `source_id`, not by `m365_files.id` directly (Neo4j has no foreign key to the SERIAL PK).
- `permission_cache.file_id` gates which `Document`/`Chunk` nodes a user's retrieval query is allowed to traverse — enforced at retrieval Stage 0, never as a post-filter on graph results (INVARIANT-1).

## 4. Validation rules (from spec.md + INVARIANTs)

- Every `chunks` row must have a `chunk_index` unique within its `file_id` (enforced by UNIQUE constraint).
- Every extracted entity/relationship must carry a `confidence` in `[0.0, 1.0]` and be traceable to a `source_chunk_id` (INVARIANT-5) — enforced at `nlp/confidence.go` before graph upsert.
- `feedback_events.query_id` must reference an existing `query_logs.id` (INTEGER FK — corrects the type mismatch flagged in `review_1.2.md`).
- Graph writes only become visible to the retrieval pipeline after `graph/builder.go`'s validate step passes (INVARIANT-2 atomic visibility, mirroring the RAD epoch pattern).
