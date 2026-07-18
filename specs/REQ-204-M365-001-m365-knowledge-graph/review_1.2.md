# Requirements Analysis Report — Enterprise Knowledge Graph from Microsoft 365 (REQ-M365-001)

## Executive Summary
- Requirements analyzed: 1 top-level feature spec, structured as 6 implementation phases (no discrete REQ-XXX per-requirement files were provided — see Open Questions)
- Implemented: 0 (Status: Draft; no code, task, or test artifacts provided)
- Missing: 1 section left empty in the doc itself (Architecture Decisions Summary table), plus 3 tables carrying placeholder "(...preserved/translated)" annotations instead of content
- Duplicated: 1 (Phase 6 substantially duplicates Phase 3's permission-filter work)
- Conflicting: 1 (database engine: "postgresql" decision vs. SQLite-syntax schema)
- Blocked: 0 explicitly stated, but Phase 5 has an undeclared dependency on Phase 4
- Ready for implementation: Phase 1 and Phase 2 are closest; Phase 3, 4, 5, 6 have gaps noted below

## Overall Quality: Average
Strong on breadth — project structure, API surface, DB/graph schemas, and a concrete E2E test flow all trace back cleanly to the original user request. Weaker on per-phase rigor: no phase has explicit acceptance criteria, business value, assumptions, or constraints; one architecture table is empty; and the Locked Decisions table conflicts with the SQL actually written in the doc. These are fixable, but should be resolved before implementation starts on Phase 1.

## Findings

### Critical
- **Database engine conflict.** Locked Decisions (line 26) commits to "postgresql (metadata) + Neo4j (graph)," but every SQL schema in the doc (Phase 1, lines 192–241; Phase 4, lines 383–413) uses `INTEGER PRIMARY KEY AUTOINCREMENT` — SQLite syntax, invalid in PostgreSQL (which uses `SERIAL`/`GENERATED ALWAYS AS IDENTITY`). The `DATA_DIR` config variable (line 474, "postgresql data directory," default `~/.m365kg/data`) also describes a filesystem path, which fits an embedded SQLite file, not a client-server Postgres instance. As written, this schema will not run against Postgres. — source: spec.md lines 26, 192–241, 383–413, 474.
- **Architecture Decisions Summary table is empty.** The table header (lines 40–41) sets up columns "RAD Knowledge Gateway (pattern source)" vs. "New System" but has zero rows; the doc explicitly notes "(No further content provided in the file under this table.)" This is the one section meant to give a side-by-side architecture comparison, and it's missing entirely. — source: spec.md lines 38–42.

### High
- **Phase 6 duplicates Phase 3.** Phase 6 ("Permission-Aware Retrieval (refinement)") states its own goal is "refined into a continuous concern, with full implementation in Phase 3," then repeats bullets already covered by Phase 3 (permission filter as Stage 0) and Phase 1 (`permissions.go` ACL extraction). No unique deliverable is defined for Phase 6 beyond restating prior phases, yet the Phases Summary table (line 606) still lists it as a distinct phase with dependencies "Phase 1, 3" and deliverable "Full permission-aware retrieval." — source: spec.md lines 441–448, 606.
- **Undeclared dependency: Phase 5 → Phase 4.** `FeedbackReview.tsx` (line 431) and `DashboardPage.tsx`'s "feedback trends" panel (line 434) are Phase 5 deliverables that require Phase 4's feedback API (`/api/feedback/stats`) to exist. The Phases Summary table (line 606) lists Phase 5's dependencies as "Phase 1–3" only, omitting Phase 4. Building strictly in the stated dependency order would leave two Phase 5 pages non-functional. — source: spec.md lines 431, 434, 606.
- **Highly privileged Graph API scopes with no governance requirement.** `Chat.Read.All` and `ChannelMessage.Read.All` (lines 459–460) are application-level permissions that let the connector read every user's 1:1 Teams chats and channel messages tenant-wide. These are among Microsoft's most sensitive application permissions, and the spec has no requirement addressing consent, retention, redaction, or opt-out for ingesting private chat content into a knowledge graph. This is a compliance/privacy gap, not just a technical one. — source: spec.md lines 452–461.

### Medium
- **Permission cache has no staleness/expiry field.** `permission_cache` (lines 236–241) stores only `user_id`, `file_id`, `permission` — no `last_updated` or TTL column — even though Phase 6 describes "cache refresh" as a responsibility of `permissions.go`. Without a documented invalidation trigger, a user removed from a document's ACL in M365 could keep retrieval access until an unspecified refresh happens. E2E acceptance step 10 tests permission scoping but not revocation/staleness. — source: spec.md lines 236–241, 442–448, 593.
- **Terminology mismatch between stores.** The metadata schema uses `content_hash` (line 219, `chunks` table) while the Neo4j schema uses `fileHash` (line 291, `Chunk` node) for what appears to be the same concept. Left as-is, this creates ambiguity for whoever writes the graph-builder sync code. — source: spec.md lines 219, 291.
- **No phase explicitly owns `internal/scheduler/` or `internal/websocket/`.** Both packages appear in the Project Structure (lines 123–129) and Files to Create (lines 505–506), but neither `delta_sync.go`, `reevaluator.go`, nor `hub.go` is listed under any phase's "Key files." Delta sync is implied by Phase 1's goal and `reevaluator.go` by Phase 4's, but the doc never states it, and `websocket/hub.go` (needed for the "WebSocket emits progress events" behavior in E2E step 3) isn't tied to any phase at all. — source: spec.md lines 123–129, 505–506, 586.
- **Type mismatch in feedback schema.** `query_logs.id` is `INTEGER PRIMARY KEY AUTOINCREMENT` (line 394) but `feedback_events.query_id` is declared `TEXT` (line 385) with no foreign key. If `query_id` is meant to reference `query_logs.id`, the types don't match and the relationship isn't enforced. — source: spec.md lines 385, 394.

### Low
- **Default model names may not match the "custom LLM" decision.** `LLM_MODEL` defaults to `gpt-4o-mini` and `LLM_EMBED_MODEL` to `text-embedding-3-small` (lines 484–485), even though Locked Decisions specifies a custom/internal LLM endpoint. Likely just a placeholder assuming OpenAI-compatible naming on the internal server, but worth confirming the internal server actually serves models under these exact names. — source: spec.md lines 20, 484–485.
- **Redundant decision rows.** "POC scope" and "Data volume" (Locked Decisions, lines 23–24) both state effectively the same figures (~10K docs, ~500K messages) under two different row labels. Not a conflict, just duplication. — source: spec.md lines 23–24.
- **Three tables carry meta-annotations instead of being self-contained.** Lines 189, 495, and 549 include bracketed notes like "(Table content translated; structure preserved.)" — these read like leftover conversion artifacts rather than finished spec content, and slightly undermine confidence that nothing else was silently dropped during translation. — source: spec.md lines 189, 495, 549.

## Recommendations
1. Resolve the Postgres-vs-SQLite conflict before Phase 1 starts — either rewrite the schema in valid PostgreSQL DDL, or correct the Locked Decisions table and `DATA_DIR` description to say SQLite. This blocks any real schema work.
2. Fill in the empty Architecture Decisions Summary table (lines 40–42) — it's the section meant to justify what's reused vs. new, and it's currently blank.
3. Either give Phase 6 a concrete, non-overlapping deliverable or fold its content into Phase 3/Phase 1 and remove it from the Phases Summary table to avoid double-counting effort.
4. Add Phase 4 to Phase 5's declared dependencies in the Phases Summary table, since `FeedbackReview.tsx` and the dashboard's feedback-trends panel need it.
5. Add a requirement addressing data governance for `Chat.Read.All`/`ChannelMessage.Read.All` (consent, retention, redaction, opt-out) before committing to those scopes — this is a privacy exposure, not just a technical one.
6. Add a `last_updated`/TTL column to `permission_cache` plus a stated refresh trigger, and extend the E2E flow to test permission revocation, not just initial scoping.
7. Standardize `content_hash` vs `fileHash` naming across the Postgres and Neo4j schemas.
8. Explicitly assign `internal/scheduler/` and `internal/websocket/` to the phases that need them (Phase 1 and Phase 4 for scheduler; likely Phase 1 or 3 for websocket, given the sync-progress use case).

## Traceability Summary
*Skipped in the standard Requirement → Plan → Task → Implementation → Test → Bug → Release sense — only this single spec.md was provided, with no separate plan/, tasks/, or tests/ documents to trace against.* The closest analogue is the Phases Summary table (lines 598–607), covered under Dependency Graph Summary below.

## Dependency Graph Summary
Based on the Phases Summary table (lines 598–607) cross-checked against phase content:
- No circular dependencies found among the 6 declared phases.
- No missing dependencies (every phase referenced in the table is itself a phase defined in the doc).
- **Hidden dependency (inferred, not confirmed):** Phase 5 → Phase 4, via `FeedbackReview.tsx` and the dashboard's feedback-trends panel (see High finding above).
- **Possibly unnecessary dependency (suggestion only):** Phase 6 declares dependencies on "Phase 1, 3," but since its content is described as already delivered by Phase 3, it may not need to exist as a separate node in this graph at all — a judgment call for the user, not a fact.

## Complexity & Risk Table
| Phase | Complexity | Risk | Notes |
|---|---|---|---|
| 1 — Foundation | L | Integration risk (Graph API pagination/rate limits and delta-token persistence failure modes not detailed); Security risk (broad app-only scopes, secret storage unspecified) | Two connectors, two auth modes, five parsers, delta sync — largest surface area with the fewest details on failure handling |
| 2 — NLP + Knowledge Graph | L | Technical risk (no human-review/validation step for LLM-extracted entities beyond a confidence score); Performance risk (~10K docs + ~500K messages through a custom LLM extractor with no stated throughput/cost budget) | Confidence scoring exists, but there's no stated threshold for excluding low-confidence extractions |
| 3 — Hybrid Retrieval + Q&A | XL | Performance risk (no latency target for the 8-stage pipeline; no fallback if graph+semantic merge over-returns candidates before the 12K-token context budget) | Highest architectural complexity — ties Phase 1 and 2 outputs together into a live query path |
| 4 — Feedback Loop | M | Same DB-engine risk as Phase 1; schema type-mismatch between `query_logs.id` and `feedback_events.query_id` | Mostly CRUD + a periodic job; moderate once the DB conflict is resolved |
| 5 — Frontend | M | Scheduling risk from the undeclared Phase 4 dependency noted above | Several pages, i18n, graph visualization — breadth more than depth |
| 6 — Permission-Aware Retrieval (refinement) | S | Maintenance risk — scope overlaps Phase 3, so effort/ownership could be double-counted, or the phase could ship with nothing left to build | See Duplication finding above |

## Open Questions
- No REQ-XXX/, plan/, tasks/, or tests/ folders were provided — only this single spec.md. Is this the complete document set for this feature, or are there companion planning/task files elsewhere that should be included?
- The doc repeatedly says architecture and patterns are "borrowed from the existing RAD Knowledge Gateway (`/workspace`)." No folder is connected in this session, so none of the reuse claims (ingestion orchestrator, 7-stage pipeline, epoch atomicity, etc.) could be verified against the actual RAD source. If you'd like that verified, connect the relevant folder/repo and I can cross-check the borrowed-pattern claims.
- Is "postgresql" in the Locked Decisions table intentional, or was this schema copied from a SQLite-based system (the `AUTOINCREMENT` syntax and file-path `DATA_DIR` strongly suggest the latter)? This determines whether Recommendation 1 means "rewrite the SQL" or "rename the decision."

## Suggested Additions
*(Suggested — not currently in the spec)*
- Rate limiting/backoff policy for the MS Graph connector beyond the general "retry" mention in `client.go` — relevant given tenant-wide app-permission scopes are subject to Graph throttling.
- Audit logging for who queried what and which entities/documents were surfaced in an answer — relevant given the permission-aware retrieval requirement and the sensitivity of ingesting private Teams chats.
- Observability/metrics for the NLP extraction and retrieval pipeline (e.g., extraction failure rate, per-stage retrieval latency) — the doc mentions "Metrics collection patterns" are borrowed from RAD (line 419) but doesn't specify what's actually measured for this system.
- Backup/recovery requirement for the Neo4j graph store — losing the graph means losing all extracted entities/relationships, expensive to rebuild from ~10K docs + ~500K messages.

Categories like i18n (already covered — en/vi) and accessibility were left out deliberately rather than padded in, given the POC scope (~50 users, single department).