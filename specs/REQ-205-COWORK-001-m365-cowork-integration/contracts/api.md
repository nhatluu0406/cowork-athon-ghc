# API & Tool Contracts: M365 Knowledge Graph Integration into Cowork GHC

New surfaces introduced on the Cowork GHC side (`/service`). All routes are loopback-only, behind the existing per-launch client token (`http-service.ts`), following the same convention as existing routers (`session/router.ts`, `permission/router.ts`, etc.).

---

## New `/service` routes — namespace `/v1/knowledge`

### `GET /v1/knowledge/status`
Returns current `KnowledgeSourceConfig` status (data-model.md §1.1), without the credential.

Response:
```json
{ "status": "not_configured" | "connected" | "unreachable" | "auth_failed", "baseUrl": "http://localhost:8080" | null, "lastHealthCheckAt": "2026-07-12T10:00:00Z" | null }
```

### `POST /v1/knowledge/configure`
Sets `baseUrl` + credential (stored via keyring, D4). Body: `{ "baseUrl": string, "token": string }`. The raw `token` is written to the keyring and never persisted in the JSON config file or echoed back in any response.

Response: same shape as `GET /v1/knowledge/status`.

### `POST /v1/knowledge/test-connection`
Forces an immediate health check against the configured M365KG backend (proxies to its `/api/stats/overview` or equivalent lightweight authenticated endpoint). Returns the same status shape, with `status` updated to `connected` / `unreachable` / `auth_failed` based on the real outcome (NFR-002 — no cached "looks connected").

### `DELETE /v1/knowledge/connection`
Clears `KnowledgeSourceConfig` and removes the keyring credential entry (R6 "Disconnect"). Response: `{ "status": "not_configured" }`.

### `POST /v1/knowledge/query` (internal — invoked by the tool runtime, not directly by the UI)
Body: `{ "query": string }`. Proxies to M365KG's `POST /api/knowledge/query` (contract: `specs/REQ-204-M365-001-m365-knowledge-graph/contracts/api.md`), attaching the stored credential as the M365KG auth header. Applies the R3 timeout (35s) and R2 reactive-refresh-on-401 behavior.

Response (success):
```json
{
  "outcome": "answered",
  "answer": "string",
  "citations": [
    { "entityType": "Person", "entityId": "string", "displayName": "string", "sourceRef": "string|null" }
  ],
  "syncedAt": "2026-07-12T09:55:00Z" | null
}
```

Response (degraded, still HTTP 200 — see FR-009, this is a domain outcome, not a transport error):
```json
{ "outcome": "unavailable" | "timeout" | "permission_denied", "answer": null, "citations": [] }
```

### `GET /v1/knowledge/graph?entityId=<id>`
Proxies to M365KG's `GET /api/graph/nodes` + `GET /api/graph/edges` (or `/api/graph/path` if a specific path is requested), bounded to `KNOWLEDGE_PANEL_MAX_NODES = 50` (R4). Response is a node/edge list ready for the Knowledge Panel's renderer (data-model.md §1.4) — Cowork does no graph computation of its own, only truncation and pass-through.

---

## Tool contract — `m365_knowledge_search` (OpenCode runtime)

Registered per FR-006, invoked by the agent during a session, gated by `ToolPermissionProxy`/`PermissionGate` (FR-008) before execution — same permission-prompt UX as filesystem tools.

**Input schema**:
```json
{ "query": "string — natural-language question requiring M365 organizational knowledge" }
```

**Output schema** (returned to the agent runtime, and the shape persisted as `KnowledgeToolInvocation`, data-model.md §1.2):
```json
{
  "outcome": "answered" | "unavailable" | "timeout" | "permission_denied",
  "answer": "string | null",
  "citations": [ { "entityType": "...", "entityId": "...", "displayName": "...", "sourceRef": "..." } ],
  "syncedAt": "string | null"
}
```

**Permission semantics**: the tool declares itself as a network-capable / external-data-access tool (same permission category as other outbound-calling tools), never as a filesystem or local-execution tool — this determines which permission-prompt copy/category the existing `ToolPermissionProxy` maps it to (`plan.md` Phase 1 to confirm the exact `PermissionActionKind` value used).

---

## Upstream M365KG endpoints this integration calls (unchanged, reference only)

| Cowork route | M365KG endpoint called | Contract source |
|---|---|---|
| `POST /v1/knowledge/test-connection` | `GET /api/stats/overview` (or lightest authenticated GET available) | REQ-204 contracts/api.md |
| `POST /v1/knowledge/query` | `POST /api/knowledge/query` | REQ-204 contracts/api.md |
| `GET /v1/knowledge/graph` | `GET /api/graph/nodes`, `GET /api/graph/edges`, `GET /api/graph/path` | REQ-204 contracts/api.md |
| (token refresh, R2) | `POST /api/auth/token/refresh` | REQ-204 contracts/api.md |
| (US-5 sync status, surfaced inline in query responses) | `GET /api/m365/sync/status` | REQ-204 contracts/api.md |

No other M365KG endpoint is called by this integration. `POST /api/m365/connect`, `POST /api/m365/sync`, `/api/feedback*`, `/api/entities` (list/browse beyond a single citation lookup), and the `WS /ws` realtime channel are explicitly not used by Cowork (Out of Scope, spec.md §2).

---

## Permission model (cross-cutting)

- Every `/v1/knowledge/query` call that reaches the network happens only after `PermissionGate` approval for that session (FR-008) — no route above bypasses it.
- `/v1/knowledge/configure` and `/v1/knowledge/test-connection` are Settings-initiated, user-present actions — not subject to the same runtime permission-prompt flow (they are the equivalent of existing `/v1/providers/*` configuration actions, which are also not gated by `PermissionGate`).
- All responses are pass-through of what the M365KG backend already permission-filtered for the configured identity (US-1 4th acceptance criterion) — Cowork applies no additional or reduced filtering.
