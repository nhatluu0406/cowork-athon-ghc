# Data Model: M365 Knowledge Graph ↔ Cowork GHC Integration

This model covers only the **new** entities this integration introduces on the Cowork GHC side, plus how they reference the **existing, unmodified** M365KG data model (`specs/REQ-204-M365-001-m365-knowledge-graph/data-model.md`). No M365KG schema (PostgreSQL or Neo4j) changes as part of this REQ.

---

## 1. Cowork-side entities (new)

Cowork GHC has no database — all persistence is JSON files under `.runtime/` (`service/src/composition/compose-service.ts`). New entities follow this same file-based convention; no new database is introduced.

### 1.1 `KnowledgeSourceConfig` — `.runtime/knowledge-source.json`

| Field | Type | Notes |
|---|---|---|
| `baseUrl` | string | M365KG Go backend base URL, e.g. `http://localhost:8080`. Default unset (`not_configured`). |
| `credentialRef` | string | Opaque handle into the Windows keyring credential store (`m365-knowledge` kind, D4) — **never the raw token itself**. |
| `status` | enum | `not_configured` \| `connected` \| `unreachable` \| `auth_failed` — last-known health, refreshed on each health check (FR-004), not a proactive background value (R2). |
| `lastHealthCheckAt` | ISO 8601 timestamp | Set on every health-check call (Settings "test connection", or lazily on first tool use per session). |
| `configuredAt` | ISO 8601 timestamp | When the user first configured the source. |

**Validation rules**:
- `baseUrl` must be a well-formed HTTP(S) URL; no validation of reachability at save time beyond an explicit "test connection" action (US-3).
- `credentialRef` is null when `status = not_configured`; never both null and any other status.
- File written via write-to-temp-then-atomic-rename, matching the existing `conversation/store.ts` persistence convention (crash-safety, good practice per constitution INVARIANT-4 applied generically, spec.md D6).

### 1.2 `KnowledgeToolInvocation` — attached to existing turn/activity metadata, not a new top-level store

Cowork already models tool calls as part of a conversation turn's activity/timeline metadata (`app/ui/src/activity-model.ts`, `app/ui/src/timeline-view.ts`). This integration adds one new tool-invocation record shape, persisted the same way existing tool-call records are (inside the conversation's persisted JSON, `service/src/conversation/store.ts`), not a separate file.

| Field | Type | Notes |
|---|---|---|
| `toolName` | literal `"m365_knowledge_search"` | Matches FR-006. |
| `query` | string | The natural-language question sent to `/api/knowledge/query`. |
| `outcome` | enum | `answered` \| `unavailable` \| `timeout` \| `permission_denied` — maps FR-008/FR-009's clean-degradation states to a persisted, inspectable value. |
| `answer` | string \| null | Present only when `outcome = answered`. |
| `citations` | `KnowledgeCitation[]` | See §1.3. Empty array when `outcome != answered`. |
| `syncedAt` | ISO 8601 timestamp \| null | Copied from the M365KG response's sync-status metadata (US-5), if provided. |
| `requestedAt` / `respondedAt` | ISO 8601 timestamps | For latency observability and R3's timeout-boundary testing. |

### 1.3 `KnowledgeCitation` — nested within `KnowledgeToolInvocation`

| Field | Type | Notes |
|---|---|---|
| `entityType` | enum | `Person` \| `Project` \| `Document` \| `Technology` \| `Customer` \| `Department` — mirrors M365KG Neo4j node labels 1:1 (REQ-204 data-model.md §2.1); **not redefined**, just referenced. |
| `entityId` | string | Opaque ID as returned by the M365KG backend (`/api/entities/:id`); Cowork does not interpret its structure. |
| `displayName` | string | For rendering in the Knowledge Panel (FR-011) — copied from the backend response, not recomputed. |
| `sourceRef` | string \| null | For `Document` citations, a reference usable with `/api/entities/:id` or a direct link, per M365KG's own source-traceability principle (REQ-204 INVARIANT-5, applied at the M365KG layer — Cowork does not re-derive file/line provenance, it only displays what the backend already computed). |

### 1.4 `KnowledgePanelGraphView` — ephemeral, not persisted

Computed at render time from `/api/graph/nodes` + `/api/graph/edges` (or `/api/graph/path`) for a given `entityId`, bounded per R4 (`KNOWLEDGE_PANEL_MAX_NODES = 50`). Not stored — re-fetched each time the panel opens, since it's a read-only view of live M365KG graph state that may change between sessions.

---

## 2. Cross-system relationships

```
Cowork Conversation (existing)
 └─ Turn (existing)
     └─ KnowledgeToolInvocation (new)          — persisted in the turn's activity metadata
         ├─ query, outcome, answer, syncedAt
         └─ KnowledgeCitation[] (new)
             ├─ entityType  ─────────────────► M365KG Neo4j node label (Person/Project/Document/...)
             ├─ entityId    ─────────────────► M365KG entity primary reference (/api/entities/:id)
             └─ sourceRef   ─────────────────► M365KG chunks.id / m365_files.id (via backend, opaque to Cowork)

Cowork KnowledgeSourceConfig (new, singleton per workspace)
 ├─ baseUrl        ─────────────────────────► M365KG Go backend (`internal/api/router.go`)
 └─ credentialRef  ─────────────────────────► Windows keyring entry ─► M365KG JWT/Entra token
                                                                        (validated via /api/auth/token/refresh)
```

**Key invariant**: Cowork never stores a copy of M365KG's underlying entity/graph/chunk data. Every `KnowledgeCitation` is a **reference**, re-resolved against the live M365KG backend on each panel open (§1.4) — this avoids Cowork's JSON-file persistence ever holding a stale, unpermissioned, or orphaned copy of M365 data outside the M365KG system's own permission-aware retrieval boundary (respects REQ-204 INVARIANT-1: permission enforcement happens once, at the M365KG retrieval layer, and Cowork must not cache around it).

---

## 3. What is explicitly NOT modeled here

- No new PostgreSQL table, no new Neo4j label/relationship — those remain exactly as defined in `specs/REQ-204-M365-001-m365-knowledge-graph/data-model.md`.
- No Cowork-side duplication of `permission_cache` — Cowork has no user↔file ACL concept of its own for M365 data; it relies entirely on the M365KG backend having already filtered results for the authenticated M365 identity before Cowork ever sees them (US-1's fourth acceptance criterion).
- No multi-user Cowork concept — Cowork GHC is a single-user local desktop app; `KnowledgeSourceConfig` is one config per workspace, not per-user-per-workspace (out of scope, matches existing Cowork single-user model).
