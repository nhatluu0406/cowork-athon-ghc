# API Contracts: Enterprise Knowledge Graph from Microsoft 365

**Phase**: 1 | **Source**: spec.md §13 (Files to Create → API Endpoints), §11 (MS Graph scopes), §15.2 (retrieval state machine)

All endpoints are prefixed by the backend's configured `HOST:PORT` (see plan.md §7 Configuration). Auth: `Authorization: Bearer <JWT>` header, issued by either Entra ID exchange (`/api/auth/login`) or local JWT fallback in demo mode. WebSocket auth follows the RAD pattern (`ws://host/ws?token=<JWT>` per CLAUDE.md §3 — reused, not re-invented).

## Auth

### `POST /api/auth/login`
- **Body**: `{ "mode": "entra_id" | "jwt_demo", "code"?: string, "username"?: string, "password"?: string }`
- **200**: `{ "access_token": string, "refresh_token": string, "expires_in": number }`
- **401**: invalid credentials / OIDC exchange failure

### `POST /api/auth/token/refresh`
- **Body**: `{ "refresh_token": string }`
- **200**: `{ "access_token": string, "expires_in": number }`
- **401**: expired/invalid refresh token

## M365 Connections

### `POST /api/m365/connect`
- **Body**: `{ "name": string, "type": "onedrive" | "teams", "tenant_id": string, "config": object }`
- **200**: `{ "id": number, "status": "active" }` → persisted to `m365_connections`
- **400**: invalid config (missing `site_id`/`group_id` for the given type)

### `GET /api/m365/sources`
- **200**: `[{ "id": number, "name": string, "type": string, "status": string, "last_sync_at": string|null }]`

### `POST /api/m365/sync`
- **Body**: `{ "source_id"?: number }` — omit to sync all sources
- **202**: `{ "job_started": true }` — triggers delta sync; progress via WebSocket
- **409**: sync already `SYNC_RUNNING` for this source

### `GET /api/m365/sync/status`
- **Query**: `?source_id=<number>` optional
- **200**: `[{ "source": string, "state": "IDLE"|"SYNC_RUNNING"|"SYNC_PARTIAL_HAS_MORE"|"SYNC_COMPLETED"|"SYNC_FAILED", "last_sync_at": string, "error"?: string }]`

## Knowledge Q&A

### `POST /api/knowledge/query`
- **Body**: `{ "query": string, "lang"?: "en"|"vi"|"ja" }`
- **200**:
  ```json
  {
    "answer": "string",
    "sources": [{ "chunk_id": number, "file_name": string, "heading_path": string|null }],
    "entities": [{ "id": string, "type": string, "name": string }],
    "intent": "find_expert" | "find_document" | "find_project_info" | "find_technology_usage" | "general_question",
    "latency_ms": number
  }
  ```
- **403**: query touches only entities outside the caller's `permission_cache` scope — permission filter (Stage 0) returns empty result set, not an error, unless the query itself is malformed
- Pipeline stages executed server-side per spec.md §15.2: `permission_filter → intent → query_ner → (graph_query ∥ semantic_search) → merge_dedup → rerank → context_pack → answer_gen`

## Feedback

### `POST /api/feedback`
- **Body**: `{ "query_id": number, "feedback_type": "like" | "dislike" | "flag", "comment"?: string }`
- **201**: `{ "id": number }`
- **404**: `query_id` does not reference an existing `query_logs` row

### `GET /api/feedback/stats`
- **200**: `{ "by_type": { "like": number, "dislike": number, "flag": number }, "trends": [...], "low_confidence_hotspots": [...] }`

## Entities

### `GET /api/entities`
- **Query**: `?type=person|project|document|technology|customer|department` optional, `?q=<search>` optional
- **200**: `[{ "id": string, "type": string, "name": string, "confidence"?: number }]` — filtered by caller's permission scope

### `GET /api/entities/:id`
- **200**: `{ "id": string, "type": string, "properties": object, "relationships": [{ "type": string, "target_id": string, "target_type": string }] }`
- **404**: unknown entity, or entity outside caller's permission scope (indistinguishable from not-found, by design)

## Graph

### `GET /api/graph/nodes`
- **Query**: `?type=<label>` optional, `?limit=<number>` default 100
- **200**: `[{ "id": string, "label": string, "properties": object }]`

### `GET /api/graph/edges`
- **Query**: `?type=<relationship>` optional, `?limit=<number>` default 200
- **200**: `[{ "from": string, "to": string, "type": string }]`

### `GET /api/graph/path`
- **Query**: `?from=<entity_id>&to=<entity_id>&max_depth=<number>` (default 2, per spec.md BFS depth 1-2 constraint)
- **200**: `{ "paths": [[{ "id": string, "label": string }, ...]] }`
- **404**: no path within `max_depth`

## Stats

### `GET /api/stats/overview`
- **200**: `{ "documents": number, "entities": number, "relationships": number, "recent_queries": number, "sync_status": [...] }`

## WebSocket

### `WS /ws?token=<JWT>`
- Reuses RAD's WebSocket auth pattern verbatim (CLAUDE.md §3): missing/invalid token → HTTP 401, close code 4401, frontend must not auto-reconnect.
- **Events emitted**: `sync_progress` (`{ source, state, files_processed, files_total }`), `extraction_progress` (`{ chunks_processed, chunks_total }`), `query_complete` (`{ query_id }`).

## Permission model (cross-cutting, applies to all endpoints above)

Every read endpoint (`/api/knowledge/query`, `/api/entities*`, `/api/graph/*`) is implicitly scoped by the caller's `permission_cache` entries. This is enforced at the retrieval/query layer (Stage 0), never as an HTTP-layer post-filter — per INVARIANT-1 (correctness > performance) and spec.md §10.

## MS Graph API scopes required by connectors (not exposed to frontend, listed for completeness)

| Scope | Purpose |
|---|---|
| `Sites.Read.All` | Read SharePoint sites |
| `Files.Read.All` | Read OneDrive/SharePoint files |
| `Chat.Read.All` | Read Teams 1:1 chats |
| `ChannelMessage.Read.All` | Read Teams channel messages |
| `Group.Read.All` | Read Teams/group membership |
| `People.Read` / `User.Read` | Delegated, for SSO profile |
