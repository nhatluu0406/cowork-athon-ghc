# Enterprise Knowledge Graph from Microsoft 365 — Technical Specification (IPA Companion)

## 0. Document Control

| Field | Value |
|---|---|
| **Title** | Enterprise Knowledge Graph from Microsoft 365 |
| **Project / Product** | RAD platform extension — Enterprise Knowledge Graph (`m365-knowledge-graph/`) |
| **Document ID** | REQ-204 / REQ-M365-001 — `spec_ipa.md` |
| **Version / Status** | Draft (not yet reviewed/approved) |
| **Owner / Authors** | speckit-planner (original), maintained alongside `spec.md` |
| **Reviewers / Approvers** | Not yet assigned — see [§23 Open Questions](#23-open-questions) |
| **Created Date** | 2026-07-09 (as `spec.md`) / 2026-07-10 (this IPA companion) |
| **Updated Date** | 2026-07-10 |
| **Related Docs / Links** | `spec.md` (canonical architecture/design reference — DB/Neo4j schemas, API contracts, state machines); `spec_1.1.md`, `spec_1.2.md`, `spec_1.3.md` (superseded drafts, consolidated into `spec.md`); `review_1.2.md` (review notes that drove the PostgreSQL/auth/embedding decisions in `spec.md` §0 provenance) |

> **Provenance**: This document restates `spec.md` (the canonical architecture/design reference for REQ-M365-001) in this project's full technical-spec template. It introduces **no new architectural decisions** — every design choice, schema, endpoint, and phase below is sourced from `spec.md`. Where `spec.md` does not specify something the template asks for (SLO targets, request/response schemas, observability plan, etc.), this document says so explicitly rather than inventing values — consistent with the `[NEEDS CLARIFICATION]` markers already used in the User-Story companion this file supersedes. Functional Requirements (FR-###) and Success Criteria (SC-###) numbering is preserved unchanged from the prior IPA draft so existing references remain valid.

---

## 1. Executive Summary

- **What is being built/changed**: A new system, the Enterprise Knowledge Graph, that continuously ingests company data from Microsoft 365 (OneDrive/SharePoint + Teams), extracts business entities and relationships via LLM-based NLP, stores them as a permission-aware knowledge graph (Neo4j) plus a semantic embedding index (PostgreSQL), and answers natural-language questions with cited, permission-scoped answers. A feedback loop (like/dislike/flag) drives periodic re-evaluation of low-confidence extractions.
- **Why it matters**:
  - *Business*: Employees currently have no single, natural-language way to find "who knows what" or "what's the state of X" across scattered OneDrive documents and Teams conversations; this system makes that tacit organizational knowledge queryable and cited.
  - *Technical*: Reuses proven patterns from the RAD Knowledge Gateway (epoch-style atomicity, 7-stage retrieval pipeline, graph builder cycle, LLM runtime abstraction, React frontend stack) to avoid re-deriving a retrieval architecture from scratch, while building an entirely new connector/graph-model/domain layer for the M365 + business-entity domain.
  - **Note on architecture reuse mapping**: `spec.md` §3 explicitly flags that the side-by-side "what's reused vs. new per architectural dimension" table was never populated — see [§23 Open Questions](#23-open-questions) item 1.
- **High-level approach**: A standalone Go backend (`m365-knowledge-graph/`) + React/TypeScript frontend, structured in six phases: (1) M365 connectors + parsing, (2) NLP extraction + Neo4j graph, (3) 8-stage hybrid retrieval Q&A pipeline, (4) feedback/self-improvement loop, (5) frontend dashboard, (6) permission-aware retrieval hardening (largely folded into Phase 3).
- **Expected outcomes / success metrics**: See [§20 Acceptance Criteria](#20-acceptance-criteria) and [§7.2 Non-Functional Requirements](#72-non-functional-requirements) — most numeric SLO targets are **proposed placeholders**, not settled targets; `spec.md` contains no target-metrics table for this feature (unlike, e.g., REQ-022's SLO table).
- **Key risks & mitigations (brief)**:
  - Teams 1:1 chat ingestion (`Chat.Read.All`) is a tenant-wide, app-level permission with no stated consent/redaction policy → tracked as an accepted risk for the single-department POC, pending a compliance decision (see [§18 Risk Analysis](#18-risk-analysis)).
  - `permission_cache` has no staleness/refresh trigger, creating a window where a user retains access to content their M365 ACL no longer grants → flagged as an open gap, not a resolved design.
  - Delta-token expiry (forcing a full re-sync) and LLM-extraction-confidence-below-threshold handling are both currently unresolved edge cases (see [§18](#18-risk-analysis)).

---

## 2. Background & Context

- **Current product context**: This is a **net-new system**, not a modification of an existing product. It is built as a sibling project to the RAD Knowledge Gateway (`/workspace`), borrowing that system's ingestion orchestrator pattern, epoch-style atomic visibility, 7-stage retrieval pipeline, graph builder cycle, LLM runtime interface, and React frontend structure — but the data domain (M365/business entities), graph model, and connectors are entirely new (`spec.md` §2).
- **Drivers**: Business need to make tacit knowledge scattered across OneDrive documents and Teams conversations queryable in natural language, with answers grounded in permission-scoped source content rather than fabricated.
- **Constraints**:
  - POC scope is a single department (~50 users), ~10K documents, ~500K messages (`spec.md` §1, "Locked Decisions").
  - Stack is fixed to Go (backend) + React/TypeScript (frontend) for team familiarity with the existing RAD stack.
  - Metadata + embeddings live in PostgreSQL; the business knowledge graph lives in Neo4j — this split was a locked decision, not left open (`spec.md` §0 provenance note, resolving an earlier SQLite-vs-PostgreSQL conflict across draft revisions).
- **Assumptions**: See [§ Assumptions](#assumptions) below (carried over verbatim from the prior IPA draft — unchanged).
- **Dependencies**:
  - Microsoft Entra ID tenant + app registration with the Graph API scopes in [§11.2](#112-events--messaging-contracts) / `spec.md` §11.
  - An internal, OpenAI-compatible custom LLM endpoint for both NER/extraction and embeddings.
  - Provisioned, reachable PostgreSQL and Neo4j instances (infra provisioning itself is out of scope for this spec).

---

## 3. Current State (As-Is)

### 3.1 Current Behavior / Workflow

Not applicable in the conventional sense — there is no predecessor system being replaced. Today, employees find information by manually searching OneDrive/SharePoint, scrolling Teams channel history, or asking colleagues directly. There is no natural-language Q&A, no cross-document entity graph, and no permission-aware retrieval layer over M365 content.

### 3.2 Existing Architecture Overview

- No components of this system exist in production yet; this is greenfield within its own project directory (`m365-knowledge-graph/`).
- The **pattern source** is the RAD Knowledge Gateway at `/workspace`, whose relevant existing components are reused as *patterns* (copied/adapted code shape, not shared runtime): ingestion orchestrator, graph builder, 7-stage retriever, LLM runtime interface, WebSocket hub, Axios client, TanStack Query hooks, Zustand store (`spec.md` §14 full reuse table).
- Existing data stores in the pattern-source system (SQLite WAL, LanceDB) are **not** reused directly — this system uses PostgreSQL + Neo4j instead, a deliberate divergence documented in `spec.md` §0.

### 3.3 Known Issues / Pain Points

Since there is no current system, this section instead captures the pain points motivating the build (equivalent to a needs analysis):

- Knowledge about "who's working on X" or "what's the status of Project Y" is siloed in individual memory, scattered documents, and unsearchable chat history.
- No mechanism exists today to answer such questions while respecting each user's actual M365 permission scope.
- No feedback mechanism exists to identify or correct low-confidence or wrong organizational knowledge over time.

---

## 4. Problem Statement

Employees cannot ask a natural-language question and get an accurate, cited answer grounded in the company's own OneDrive/Teams content — today's alternative is manual search across siloed tools or asking a colleague, with no permission-aware guarantee and no mechanism to improve answer quality over time based on user feedback. If nothing is built, this tacit knowledge remains locked in unstructured documents and chat history, undiscoverable except by people who already know where to look — and any future ad-hoc attempt to bolt on search risks either leaking content across M365 permission boundaries or fabricating unattributed answers.

*Note: `spec.md` does not state quantified evidence/impact (e.g., support-ticket counts, time-to-find metrics) for this problem — this is a build-first-measure-later POC, not a data-driven business case. Treat the above as the stated rationale, not a validated impact analysis.*

---

## 5. Objectives

### 5.1 Goals (Must achieve)

- Ingest OneDrive/SharePoint and Teams content via Microsoft Graph API with incremental delta sync (FR-002, FR-003).
- Extract business entities and relationships via LLM-based NLP with confidence scoring, stored as a deduplicated Neo4j graph (FR-005, FR-006).
- Answer natural-language questions via an 8-stage hybrid (graph + semantic) retrieval pipeline, with source citations, permission-filtered *before* generation (FR-008, FR-009, FR-015).
- Provide an entity browser and interactive graph visualization (FR-013, FR-014).
- Collect user feedback and periodically re-evaluate low-confidence knowledge (FR-010, FR-011).
- Give admins connection configuration, sync status, and manual sync controls with real-time progress (FR-012, FR-016).

### 5.2 Non-goals (Explicitly out of scope)

- Detailed infrastructure/CI/CD rollout strategy (`spec.md` §2 "Out of scope").
- Multi-department scaling and any resulting permission-model complexity beyond the single-department (~50 user) POC (`spec.md` §2; prior IPA draft, Assumptions).
- Resolving the Teams 1:1 chat consent/redaction policy question — treated as an accepted risk for the POC pending a decision (`spec.md` §18 item 2).
- A generic username/password auth system — explicitly dropped during spec consolidation in favor of Entra ID SSO + local JWT fallback only (`spec.md` §0 provenance note 2).

---

## 6. Scope

### 6.1 In Scope

- M365 connection to OneDrive/SharePoint + Teams via MS Graph API; incremental sync via delta query + change-token persistence.
- Parsing docx/xlsx/pptx/pdf/txt + chat messages into text chunks.
- NLP entity/relationship extraction via a custom LLM API with confidence scoring.
- Neo4j graph construction (upsert/dedup) + query/traversal.
- Hybrid retrieval: semantic search + graph expansion + rerank + context packing + cited answer generation; permission filter as Stage 0.
- Feedback loop: like/dislike/flag; analytics; re-evaluation of low-confidence edges; fine-tuning-pair export.
- Frontend dashboard: Q&A, entity browser, graph visualization, feedback review, data sources, login, overview dashboard.
- **Data entities impacted**: M365 File, Chunk, Business Entity (Person/Project/Document/Technology/Customer/Department), Relationship, M365 Connection, Feedback Event, Query Log (see [§12.1 Domain Model](#121-domain-model)).
- **APIs/events impacted**: All endpoints in [§11.1](#111-restgrpc-apis) and the `/ws` WebSocket channel in [§11.2](#112-events--messaging-contracts) (all net-new — no existing API surface is modified).

### 6.2 Out of Scope

- Multi-department / multi-tenant scaling.
- Infra/CI/CD provisioning for PostgreSQL and Neo4j (assumed already provisioned and reachable).
- A resolved consent/retention/redaction policy for private Teams 1:1 chat content.
- Any deferred items are tracked as [Open Questions](#23-open-questions), not silently dropped.

---

## 7. Requirements

### 7.1 Functional Requirements

- **FR-001**: System MUST authenticate users via Microsoft Entra ID SSO (OIDC/OAuth2), with a local JWT fallback for demo/test environments only.
  - Acceptance notes: Entra ID is primary; JWT fallback is demo/test-only, not a production auth path.
  - Priority: P0
- **FR-002**: System MUST connect to Microsoft 365 OneDrive/SharePoint and Teams via the Microsoft Graph API to ingest documents and chat/channel messages.
  - Priority: P0
- **FR-003**: System MUST perform incremental sync using Microsoft Graph delta queries, persisting a change token per source so subsequent syncs process only items changed since the last successful sync.
  - Edge case: an expired/invalid delta token requires a full re-sync — behavior currently unresolved, see [§18](#18-risk-analysis).
  - Priority: P0
- **FR-004**: System MUST parse ingested content into text chunks for docx, xlsx, pptx, pdf, plain text, and chat message formats.
  - Edge case: corrupted/unsupported document variants — skip-and-continue vs. halt-batch behavior is unresolved, see [§18](#18-risk-analysis).
  - Priority: P0
- **FR-005**: System MUST extract business entities (Person, Project, Document, Technology, Customer, Department) and relationships between them from text chunks using an LLM-based extractor, assigning a confidence score (0.0–1.0) to each extraction.
  - Edge case: extractions below a usable confidence threshold — stored-but-hidden vs. discarded is unresolved, see [§18](#18-risk-analysis).
  - Priority: P0
- **FR-006**: System MUST store extracted entities and relationships as a graph in Neo4j, deduplicating on upsert rather than creating duplicate nodes/edges for the same real-world entity.
  - Priority: P0
- **FR-007**: System MUST generate vector embeddings for text chunks and store them so semantic search can retrieve similar content at query time.
  - Priority: P0
- **FR-008**: System MUST answer natural-language questions using a hybrid retrieval pipeline combining graph traversal and semantic search, returning an answer with source citations rather than an unattributed answer.
  - Priority: P0
- **FR-009**: System MUST filter all retrieval results by the requesting user's Microsoft 365 access permissions *before* that content is used to generate an answer — permission enforcement happens at the retrieval stage, not only at display time.
  - Priority: P0 (safety-critical — see [§13 Security Considerations](#13-security-considerations))
- **FR-010**: System MUST allow users to submit feedback (like/dislike/flag) on any answer they receive.
  - Priority: P1
- **FR-011**: System MUST analyze feedback trends and periodically re-evaluate and re-extract entities/relationships whose confidence falls below a usable threshold.
  - Priority: P1
- **FR-012**: System MUST allow admins to configure M365 connections, view sync status, and trigger a manual sync on demand.
  - Priority: P1
- **FR-013**: System MUST allow users to browse extracted entities filtered by type and view an entity's relationships.
  - Priority: P2
- **FR-014**: System MUST provide an interactive visualization of the business knowledge graph, filterable by entity type.
  - Priority: P2
- **FR-015**: System MUST NOT expose data or entities from documents/messages outside a user's M365 permission scope, including indirectly through graph expansion, reranking, or citations.
  - Priority: P0 (safety-critical — restates/strengthens FR-009 for indirect exposure paths)
- **FR-016**: System MUST emit real-time progress updates (e.g., over WebSocket) while a data sync is running, so an admin can observe sync status without polling.
  - Priority: P1
- **FR-017**: System MUST cache the user-to-file M365 permission mapping used for retrieval-time filtering.
  - **[NEEDS CLARIFICATION]**: no refresh/expiry trigger is currently defined for this cache — see `spec.md` §18 Open Question 5.
  - Priority: P0

### 7.2 Non-Functional Requirements

> `spec.md` states no formal NFR/SLO table for this feature (unlike, e.g., REQ-022's SLO table). The items below are derived from stated design constraints where available; items with no stated target are marked `[NEEDS CLARIFICATION]` rather than assigned an invented number.

- **NFR-Performance**: Context packing targets a default 12K-token budget per answer (`spec.md` §7, Stage 6). No end-to-end query latency target is stated. **[NEEDS CLARIFICATION]**: proposed placeholder — "p95 query latency ≤ N seconds" — needs a stakeholder-set target.
- **NFR-Availability**: No SLO/SLA is stated for this feature (contrast with REQ-022's 9-metric SLO table in `CLAUDE.md` §8b). **[NEEDS CLARIFICATION]**.
- **NFR-Scalability**: Must handle the POC corpus (~10K docs, ~500K messages, ~50 users) via batched processing (`spec.md` §1). Multi-department scaling is explicitly out of scope (non-goal, [§5.2](#52-non-goals-explicitly-out-of-scope)).
- **NFR-Security**: Entra ID SSO (OIDC/OAuth2) as primary auth (FR-001); least-privilege Microsoft Graph app permissions ([§11.2](#112-events--messaging-contracts) scopes table); permission filtering enforced at retrieval time, not display time (FR-009, FR-015).
- **NFR-Compliance/Privacy**: Teams 1:1 chat ingestion under a tenant-wide `Chat.Read.All` app permission has no stated consent/redaction policy — flagged as an open compliance question (`spec.md` §18 item 2), assumed an accepted risk for the single-department POC per this spec's Assumptions. Person entities carry PII (email, display name, department) with no stated retention/deletion policy — **[NEEDS CLARIFICATION]**.
- **NFR-Observability**: FR-016 requires real-time sync progress via WebSocket. Beyond that, `spec.md` states no metrics/logging/tracing plan specific to this feature (contrast with REQ-022's `MetricsTracker.Record()` pattern) — **[NEEDS CLARIFICATION]**, see [§16](#16-observability--operations).
- **NFR-Operability**: Admins can configure connections, view sync status, and trigger manual syncs (FR-012). No runbook is referenced for this feature in `spec.md` — **[NEEDS CLARIFICATION]**.

---

## 8. Proposed Solution (To-Be Overview)

- **Proposed end-to-end workflow summary** (`spec.md` §3.2):
  1. Admin configures an M365 connection (`POST /api/m365/connect`) → persisted to `m365_connections`.
  2. Delta sync (scheduled or manual via `POST /api/m365/sync`) → Graph API delta query → updates `delta_state`, upserts `m365_files`, refreshes `permission_cache`.
  3. Content download/parse → chunker → insert/update `chunks`.
  4. NLP extraction over chunks → entities/relationships + confidence → graph builder dedup/upsert into Neo4j; embeddings generated in batch and stored in `chunk_embeddings`.
  5. User query (`POST /api/knowledge/query`) → 8-stage retrieval pipeline (permission-aware) → answer + sources + entities.
  6. User feedback (`POST /api/feedback`) → stored in `feedback_events`; analytics via `GET /api/feedback/stats`; reevaluator periodically rescans low-confidence edges.
- **Key design principles**: Correctness/permission-safety over speed (permission filter is Stage 0, not a post-filter); deduplicated graph upserts, not append-only; incremental (delta) sync over full re-scan; confidence-scored extraction with a feedback-driven re-evaluation loop rather than a static one-shot extraction.
- **What changes where** (component list — all net-new, no existing production component is modified): Auth layer, M365 connectors, parsing pipeline, PostgreSQL metadata store, NLP/embedding layer, Neo4j knowledge graph, 8-stage hybrid retrieval pipeline, scheduler + WebSocket hub, React frontend. Full breakdown in [§10](#10-component-detail-design).
- **What stays unchanged**: Nothing in this system's own history (greenfield); the RAD Knowledge Gateway pattern source (`/workspace`) is unaffected — patterns are copied/adapted, not shared at runtime.

**Representative user workflows** *(carried forward from the prior User-Story companion draft — restated here as illustrative flows rather than a separate template section)*:

1. **Ask a question, get a cited, permission-scoped answer** (P1): An employee asks e.g. "who's working on the Contoso migration?" and receives an answer grounded in OneDrive/Teams content, with citations, drawing only on content they're permitted to see.
2. **Connect M365 and keep the knowledge base in sync** (P2): An admin configures a connection, triggers an initial sync, and the system incrementally ingests changes thereafter without a full re-scan.
3. **Browse extracted entities and the business knowledge graph** (P3): A user browses extracted entities (people, projects, documents, etc.) and visually explores their connections, independent of asking a specific question.
4. **Give feedback that improves future answers** (P4): A user marks an answer helpful/unhelpful/wrong; the system uses this to re-evaluate low-confidence knowledge over time.
5. **Admin reviews flagged answers and confidence trends** (P5): An admin reviews flagged answers and confidence-score trends and can act on low-confidence hotspots.

Full Given-When-Then acceptance scenarios for each workflow are retained in [§19.6 UAT plan](#19-testing-strategy).

---

## 9. Architecture Design

### 9.1 Logical Architecture

High-level components (`spec.md` §3.1):

1. **Auth Layer**: Entra ID SSO (OIDC/OAuth2) + Local JWT fallback (demo).
2. **M365 Connectors**: MS Graph client + token management + OneDrive ingestor + Teams ingestor + delta coordinator + permissions extraction/cache.
3. **Parsing Pipeline**: docx/xlsx/pptx/pdf/txt parsers + chunking.
4. **Metadata Store (PostgreSQL)**: sync state, file metadata, chunks, connection config, permission cache, embeddings; plus feedback/query-log/confidence tables (Phase 4).
5. **NLP/Embedding**: LLM-based extractor (custom API) + embedding runtime + batch embedding.
6. **Knowledge Graph (Neo4j)**: build→validate→publish cycle; query patterns; traversal/stats.
7. **Hybrid Retrieval (8-stage)**: permission filter → intent → query NER → concurrent graph query + semantic search → merge/dedup → rerank → context pack → answer generation (LLM, citations).
8. **Scheduler + WebSocket**: periodic delta sync; reevaluator; real-time progress updates.
9. **Frontend (React/TS)**: TanStack Query + Zustand + Shadcn/ui.

### 9.2 Physical / Deployment Architecture

`spec.md` does not define environment tiers (dev/stage/prod), region/AZ strategy, or network boundaries specific to this feature — it is a standalone backend (`m365-knowledge-graph/`) + frontend, with PostgreSQL and Neo4j "provisioned and reachable" (assumed, not designed here). **[NEEDS CLARIFICATION]** — no deployment topology stated in source design doc.

### 9.3 Data Flow

- **Main flow (happy path)**: see [§8](#8-proposed-solution-to-be-overview) end-to-end workflow summary, steps 1–6.
- **Failure flows**: Graph API rate-limit/transient errors during sync → retried per the client's backoff strategy, not a full sync failure (User Story 2, Acceptance Scenario 4). Delta-token expiry/invalidity → requires full re-sync (behavior unresolved, [§18](#18-risk-analysis)). Document parse failure (corrupted/unsupported format) → skip-vs-halt behavior unresolved ([§18](#18-risk-analysis)). Retrieval candidate set exceeding the 12K-token context budget → truncation/selection strategy unresolved ([§18](#18-risk-analysis)). Query with zero permission-overlapping content after Stage 0 → should surface as "no relevant information found," not a fabricated answer (Acceptance Scenario, User Story 1 #3), but the empty-result-set path specifically is not detailed further.
- **Event-driven vs. request/response**: Sync triggers and Q&A queries are request/response (`POST /api/m365/sync`, `POST /api/knowledge/query`); sync progress is pushed event-style over WebSocket (FR-016).

### 9.4 State Machine (If applicable)

**Delta Sync State Machine** (per source in `delta_state`; `spec.md` §15.1):
- States: `IDLE`, `SYNC_RUNNING`, `SYNC_PARTIAL_HAS_MORE`, `SYNC_COMPLETED`, `SYNC_FAILED`.
- Transitions: `IDLE → SYNC_RUNNING` (manual trigger or scheduler tick) · `SYNC_RUNNING → SYNC_PARTIAL_HAS_MORE` (more pages remain) · `SYNC_PARTIAL_HAS_MORE → SYNC_RUNNING` (next page fetched) · `SYNC_RUNNING → SYNC_COMPLETED` (new `change_token` saved) · `(SYNC_RUNNING | SYNC_PARTIAL_HAS_MORE) → SYNC_FAILED` on error, returning to `IDLE` or retrying per client policy.

**Retrieval (Q&A) Pipeline State Machine** (per query; `spec.md` §15.2):
```
STAGE0_PERMISSION_FILTER → STAGE1_INTENT → STAGE2_QUERY_NER
  → parallel: (STAGE3_GRAPH_QUERY, STAGE4_SEMANTIC_SEARCH)
  → MERGE_DEDUP → STAGE5_RERANK → STAGE6_CONTEXT_PACK (default 12K tokens)
  → STAGE7_ANSWER_GEN → DONE
```

**Feedback Improvement Loop State Machine** (`spec.md` §15.3):
```
FEEDBACK_COLLECTED (insert feedback_events)
  → ANALYZED (analyzer finds trends/low-confidence hotspots)
  → REEVALUATION_SCHEDULED (scheduler)
  → REEXTRACTED (improver re-scans low-confidence edges, re-extracts with LLM)
  → GRAPH_UPDATED (confidence/edges updated)
  → back to steady-state
```

---

## 10. Component Detail Design

### 10.1 Component: M365 Connectors (`internal/connectors/`)

- **Purpose**: Connect to and incrementally ingest content from OneDrive/SharePoint and Teams.
- **Responsibilities**: MS Graph HTTP client with retry/pagination/rate-limiting (`client.go`); OAuth2 token management for service-principal + delegated tokens (`auth.go`); enumerate sites→drives→files, download content, extract permissions (`onedrive.go`); enumerate groups→channels→messages (`teams.go`); delta query coordination with change-token persistence (`delta.go`); permission extraction/caching (`permissions.go`).
- **Public Interfaces**: Consumed internally by the sync scheduler and `POST /api/m365/sync`; no external API of its own.
- **Key Algorithms / Rules**: Delta-query pagination; change-token persisted per source (`onedrive:/site/drive` or `teams:/group/channel`) so re-syncs are incremental, not full re-scans.
- **Failure Handling**: Retries per client backoff strategy on Graph API rate-limit/transient errors (User Story 2, Scenario 4). Delta-token expiry handling is unresolved ([§18](#18-risk-analysis)).
- **Config / Feature Flags**: `M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, `M365_AUTH_MODE`, `DELTA_SYNC_INTERVAL`.
- **Limits**: Not explicitly stated beyond Graph API's own rate limits; POC volume is ~10K docs / ~500K messages.

### 10.2 Component: Document Parsers (`internal/parsers/`)

- **Purpose**: Convert ingested M365 content into text chunks for downstream NLP/embedding.
- **Responsibilities**: `docx.go` (zip→XML→text+structure), `xlsx.go` (cell data + sheet structure), `pptx.go` (slide text + speaker notes), `pdf.go` (text extraction), `text.go` (fixed-size chunking with overlap for plain text/chat).
- **Failure Handling**: Corrupted/unsupported format handling (skip-vs-halt) is unresolved ([§18](#18-risk-analysis)).

### 10.3 Component: NLP Extraction (`internal/nlp/`)

- **Purpose**: Extract business entities and relationships from text chunks.
- **Responsibilities**: `types.go` (Entity/relationship types — Person, Project, Document, Technology, Customer, Department, Date, Amount); `extractor.go` (LLM call: chunk → structured entities + relationships); `prompt.go` (extraction prompts for the custom LLM); `confidence.go` (0.0–1.0 confidence scoring per extraction).
- **Key Algorithms / Rules**: `TextChunk → LLM (custom API) → { entities: [...], relationships: [...] }` (`spec.md` §6, NLP extraction flow).
- **Failure Handling**: Below-threshold-confidence handling (store-hidden vs. discard) is unresolved ([§18](#18-risk-analysis)).

### 10.4 Component: Knowledge Graph (`internal/graph/`)

- **Purpose**: Build and query the Neo4j business knowledge graph.
- **Responsibilities**: `types.go` (GraphNode/GraphEdge for the business domain); `builder.go` (batch ingest → dedupe → upsert, build→validate→publish cycle); `neo4j_store.go` (client, Cypher upserts, connection pool); `neo4j_query.go` (find entity/paths/neighbors); `traversal.go` (BFS/DFS with depth limit); `stats.go` (node/edge counts, degree distribution).
- **Key Algorithms / Rules**: Upsert-based dedup (not append-only) so the same real-world entity is not duplicated. See [§12.2](#122-database-schema-changes) for the Neo4j node/relationship/index schema.
- **Concurrency Model**: Batch builder cycle; not explicitly threaded/async beyond the standard build→validate→publish pattern borrowed from the RAD graph builder.

### 10.5 Component: Embedding (`internal/embedding/`)

- **Purpose**: Generate and store vector embeddings for semantic search.
- **Responsibilities**: `runtime.go` (embedding interface); `custom_api.go` (OpenAI-compatible private endpoint); `batch.go` (worker pool, up to 100 texts/batch); `store.go` (PostgreSQL persistence keyed by chunk + embedding model version, enabling re-embedding on model change).
- **Limits**: Batch size up to 100 texts.

### 10.6 Component: Hybrid Retrieval (`internal/retrieval/`)

- **Purpose**: Answer natural-language questions via the 8-stage pipeline.
- **Responsibilities**: `retriever.go` (orchestrator); `intent_detector.go` (find_expert / find_document / find_project_info / find_technology_usage / general_question); `permission_filter.go` (Stage 0 M365 permission filter); `semantic_search.go` (embed query → similar chunks); `graph_expander.go` (BFS expansion, depth 1–2); `reranker.go` (relevance + graph proximity + confidence scoring); `context_packer.go` (token-budget-aware assembly, default 12K); `answer_generator.go` (LLM answer generation with citations).
- **Key Algorithms / Rules**: See [§9.4](#94-state-machine-if-applicable) pipeline state machine. Permission filtering happens *before* Stage 5 rerank/Stage 7 generation — never as a post-hoc display filter (FR-009, FR-015).
- **Failure Handling**: Candidate-set-exceeds-context-budget and zero-permission-overlap behaviors are unresolved ([§18](#18-risk-analysis)).

### 10.7 Component: Feedback Loop (`internal/feedback/`)

- **Purpose**: Collect feedback and drive periodic re-evaluation of low-confidence knowledge.
- **Responsibilities**: `store.go` (PostgreSQL-backed feedback storage); `analyzer.go` (trend analytics, low-confidence hotspots); `improver.go` (periodic re-scan of low-confidence edges → LLM re-extraction); `exporter.go` (fine-tuning pair export).

### 10.8 Component: Scheduler + WebSocket (`internal/scheduler/`, `internal/websocket/`)

- **Purpose**: Run periodic background jobs and push real-time updates.
- **Responsibilities**: `delta_sync.go` (periodic delta sync per `DELTA_SYNC_INTERVAL`); `reevaluator.go` (periodic confidence re-evaluation); `hub.go` (WebSocket hub for sync progress and query updates).

### 10.9 Component: Frontend (React/TypeScript)

- **Purpose**: Enterprise knowledge dashboard.
- **Responsibilities**: `KnowledgeSearch.tsx` (Q&A chat + citations + feedback buttons); `EntityBrowser.tsx` (filterable entity list + relationship detail); `BusinessGraph.tsx` (interactive graph viz, React Flow/D3.js); `FeedbackReview.tsx` (admin review of flagged answers + confidence adjustment); `DataSourcesPage.tsx` (M365 connection config, sync status, manual trigger); `LoginPage.tsx` (Entra ID + local JWT fallback); `DashboardPage.tsx` (overview — recent queries, sync status, graph stats, feedback trends; depends on Phase 4's `/api/feedback/stats`, a cross-phase dependency not listed in the Phases Summary table — see `spec.md` §17 note).
- **State rules**: Server state via TanStack Query only; UI state via Zustand only (per this project's global frontend standards, `CLAUDE.md` §6).

---

## 11. API Design (or Interface Contracts)

### 11.1 REST/gRPC APIs

`spec.md` §13 lists endpoints and purpose only — it does **not** define per-endpoint request/response JSON schemas, error models, idempotency strategy, or pagination — flagged here as gaps rather than invented:

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Entra ID / JWT login |
| POST | `/api/auth/token/refresh` | Refresh auth token |
| POST | `/api/m365/connect` | Configure M365 connection |
| GET | `/api/m365/sources` | List connected data sources |
| POST | `/api/m365/sync` | Trigger data sync |
| GET | `/api/m365/sync/status` | Get sync status |
| POST | `/api/knowledge/query` | Natural language Q&A |
| POST | `/api/feedback` | Submit like/dislike/flag |
| GET | `/api/feedback/stats` | Feedback analytics |
| GET | `/api/entities` | List/browse entities |
| GET | `/api/entities/:id` | Entity detail |
| GET | `/api/graph/nodes` | Graph nodes |
| GET | `/api/graph/edges` | Graph edges |
| GET | `/api/graph/path` | Find path between entities |
| GET | `/api/stats/overview` | Dashboard statistics |

- **Auth**: Entra ID SSO (OIDC/OAuth2) primary; local JWT fallback for demo/test (FR-001). All endpoints other than `/api/auth/*` presumably require a valid session — not explicitly stated per-endpoint in `spec.md`.
- **Request/response schema, error model, idempotency, pagination/filtering, backward compatibility**: **[NEEDS CLARIFICATION]** — none of these are defined in `spec.md`; this is a greenfield API with no prior version to be compatible with.

### 11.2 Events / Messaging Contracts

- **Channel**: `WS /ws?token=<JWT>` — real-time updates (sync progress, query updates) per FR-016 and `spec.md` §13.
- **Producer/consumer**: Backend `internal/websocket/hub.go` (producer) → admin dashboard / frontend clients (consumers).
- **Event schema & versioning, ordering guarantees, deduplication, retry/DLQ behavior**: **[NEEDS CLARIFICATION]** — not defined in `spec.md`; only the transport (WebSocket, JWT-authenticated) and purpose (sync progress, no polling needed) are specified.

**Microsoft Graph API scopes** (external dependency, not an API this system exposes — `spec.md` §11):

| Scope | Purpose | Type |
|---|---|---|
| `Sites.Read.All` | Read SharePoint sites | App permission |
| `Files.Read.All` | Read OneDrive/SharePoint files | App permission |
| `Chat.Read.All` | Read Teams 1:1 chats | App permission |
| `ChannelMessage.Read.All` | Read Teams channel messages | App permission |
| `Group.Read.All` | Read Teams/group membership | App permission |
| `People.Read` | Read user profiles | Delegated (for SSO) |
| `User.Read` | Read own profile | Delegated |

---

## 12. Data Design

### 12.1 Domain Model

- **M365 File**: An ingested OneDrive/SharePoint document or Teams message. Attributes: source type (onedrive/teams), file name/type, size, content hash, last-modified time, associated ACL/permissions.
- **Chunk**: A parsed segment of a File's text content. Attributes: chunk index within its file, text, heading/outline path (for structured formats). Owned by `internal/parsers/` at creation, referenced by embedding and NLP layers.
- **Business Entity** (Person / Project / Document / Technology / Customer / Department): A graph node extracted via NLP. Attributes: type-specific fields (e.g., a Person has email/display name/department), plus provenance back to the source Chunk(s). Owned by `internal/graph/`.
- **Relationship**: A typed, directed edge between two Business Entities (e.g., Person `WORKS_ON` Project), carrying a confidence score and provenance. Owned by `internal/graph/`.
- **M365 Connection**: An admin-configured data source (specific OneDrive site/drive or Teams group/channel), including sync status and tenant/config details. Owned by `internal/connectors/` / `internal/metadata/`.
- **Feedback Event**: A user's like/dislike/flag reaction to a specific answer, optionally with a comment. Owned by `internal/feedback/`.
- **Query Log**: A record of a user's question, detected intent, result count, and latency — basis for analytics and confidence re-evaluation. Owned by `internal/feedback/` / `internal/retrieval/`.

### 12.2 Database Schema Changes

**PostgreSQL — Phase 1 (sync/file/chunk metadata)** (`spec.md` §5):

```sql
CREATE TABLE delta_state (
    source TEXT PRIMARY KEY,  -- 'onedrive:/site/drive' or 'teams:/group/channel'
    change_token TEXT NOT NULL,
    has_more BOOLEAN NOT NULL DEFAULT FALSE,
    last_sync_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE m365_files (
    id SERIAL PRIMARY KEY,
    source_type TEXT NOT NULL,  -- 'onedrive' or 'teams'
    source_id TEXT NOT NULL,    -- OneDrive item ID or Teams message ID
    file_name TEXT NOT NULL,
    file_type TEXT,             -- 'docx', 'xlsx', 'pptx', 'pdf', 'txt', 'chat_message'
    file_size INTEGER,
    content_hash TEXT,
    last_modified TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    permissions_json JSONB      -- ACL entries
);

CREATE TABLE chunks (
    id SERIAL PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES m365_files(id),
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    heading_path TEXT,          -- for docx/pptx: outline hierarchy
    UNIQUE(file_id, chunk_index)
);

CREATE TABLE m365_connections (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,         -- 'onedrive' or 'teams'
    tenant_id TEXT NOT NULL,
    config_json JSONB NOT NULL, -- site_id, group_id, etc.
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permission_cache (
    user_id TEXT NOT NULL,
    file_id INTEGER NOT NULL REFERENCES m365_files(id),
    permission TEXT NOT NULL,   -- 'read', 'write', 'owner'
    PRIMARY KEY (user_id, file_id)
);
```

**PostgreSQL — Phase 2 (embeddings)** (`spec.md` §6):

```sql
CREATE TABLE embedding_models (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT,
    dims INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, COALESCE(version, ''))
);

CREATE TABLE chunk_embeddings (
    id SERIAL PRIMARY KEY,
    chunk_id INTEGER NOT NULL REFERENCES chunks(id),
    model_id INTEGER NOT NULL REFERENCES embedding_models(id),
    embedding BYTEA NOT NULL,       -- serialized float32 array; consider pgvector's `vector` type if ANN search is needed
    embedding_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chunk_id, model_id)
);
CREATE INDEX idx_chunk_embeddings_chunk ON chunk_embeddings(chunk_id);
CREATE INDEX idx_chunk_embeddings_model ON chunk_embeddings(model_id);

CREATE TABLE embedding_jobs (
    id SERIAL PRIMARY KEY,
    status TEXT NOT NULL,            -- 'queued' | 'running' | 'succeeded' | 'failed'
    model_id INTEGER NOT NULL REFERENCES embedding_models(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT
);
```

**PostgreSQL — Phase 4 (feedback/query log/confidence)** (`spec.md` §8):

```sql
CREATE TABLE query_logs (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    query_text TEXT NOT NULL,
    intent TEXT,
    results_count INTEGER,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feedback_events (
    id SERIAL PRIMARY KEY,
    query_id INTEGER NOT NULL REFERENCES query_logs(id),
    user_id TEXT NOT NULL,
    feedback_type TEXT NOT NULL,  -- 'like', 'dislike', 'flag'
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE extraction_confidence (
    id SERIAL PRIMARY KEY,
    entity_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    confidence REAL NOT NULL,
    feedback_score REAL,
    last_reevaluated TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
*`feedback_events.query_id` is `INTEGER REFERENCES query_logs(id)` — a type-mismatch fix vs. earlier draft revisions, per `spec.md` §8 note.*

**Neo4j graph schema** (`spec.md` §6):

```cypher
(:Person {email, displayName, department})
(:Project {name, status, description})
(:Document {fileName, sourceType, sourceId})
(:Technology {name})
(:Customer {name})
(:Department {name})
(:Chunk {chunkId, fileHash})

(:Person)-[:MANAGES]->(:Project)
(:Person)-[:WORKS_ON]->(:Project)
(:Person)-[:BELONGS_TO]->(:Department)
(:Document)-[:MENTIONS]->(:Person|Project|Technology|Customer)
(:Document)-[:CREATED_BY]->(:Person)
(:Project)-[:USES]->(:Technology)
(:Project)-[:SERVING]->(:Customer)
(:Chunk)-[:PART_OF]->(:Document)
(:Chunk)-[:MENTIONS]->(:Person|Project|Technology|Customer)

CREATE INDEX FOR (n:Person) ON (n.email)
CREATE INDEX FOR (n:Person) ON (n.displayName)
CREATE INDEX FOR (n:Project) ON (n.name)
CREATE INDEX FOR (n:Document) ON (n.fileName)
CREATE INDEX FOR (n:Technology) ON (n.name)
CREATE INDEX FOR (n:Customer) ON (n.name)
CREATE INDEX FOR (n:Department) ON (n.name)
```

### 12.3 Migration Strategy (Data)

Not applicable in the backfill/dual-write sense — there is no predecessor schema to migrate from (greenfield). The one migration-shaped concern raised in the source design is **re-embedding on model change**: `chunk_embeddings` is keyed by `(chunk_id, model_id)` specifically so a new embedding model/version can be backfilled via `embedding_jobs` without discarding prior vectors (`spec.md` §6). No rollback or data-validation plan beyond this is stated. **[NEEDS CLARIFICATION]**.

### 12.4 Data Retention & Privacy

- **PII classification**: Person entities carry email, display name, department (`spec.md` §6, Neo4j schema). M365 File ACLs and permission cache also carry user identifiers.
- **Retention period / deletion strategy / audit requirements**: Not defined in `spec.md`. The one explicitly flagged privacy gap is Teams 1:1 chat ingestion under `Chat.Read.All` with no stated consent/redaction step (`spec.md` §18 item 2). **[NEEDS CLARIFICATION]** for all of retention, deletion, and audit logging.

---

## 13. Security Considerations

- **Threat model summary**: Primary asset is permission-scoped organizational knowledge (documents, chats, derived entities); primary risk is a user seeing content or citations from M365 sources they are not authorized to access, either directly or indirectly through graph expansion/reranking (FR-015).
- **Authn/Authz model**: Microsoft Entra ID SSO (OIDC/OAuth2) as the primary path; local JWT restricted to demo/test environments (FR-001). Authorization for content access is delegated to each user's actual M365 permission scope, enforced at retrieval time via `permission_cache` (FR-009).
- **Least privilege/IAM**: Microsoft Graph app permissions requested are scoped to what ingestion needs — `Sites.Read.All`, `Files.Read.All`, `Chat.Read.All`, `ChannelMessage.Read.All`, `Group.Read.All` (app) plus `People.Read`/`User.Read` (delegated for SSO) — see [§11.2](#112-events--messaging-contracts). `Chat.Read.All` is tenant-wide and app-level, a broader grant than per-user delegated access, flagged as a compliance concern (`spec.md` §18 item 2).
- **Input validation**: Not detailed in `spec.md` beyond the general parsing pipeline; no explicit statement on sanitizing user query input before LLM prompt construction. **[NEEDS CLARIFICATION]**.
- **Secrets management**: `M365_CLIENT_SECRET`, `NEO4J_PASSWORD`, `LLM_API_KEY`, `JWT_SECRET` are environment-variable-configured (`spec.md` §12); `JWT_SECRET` defaults to auto-generated if unset. No secrets-manager/vault integration is specified.
- **Encryption in transit/at rest**: Not explicitly addressed in `spec.md` for this feature. **[NEEDS CLARIFICATION]**.
- **Audit logging requirements**: Not explicitly addressed beyond `query_logs` (which records query text/intent/latency for analytics, not a security audit trail per se). **[NEEDS CLARIFICATION]**.

---

## 14. Performance & Scalability

- **Expected load assumptions**: POC scope — single department, ~50 users, ~10K documents, ~500K messages (`spec.md` §1).
- **Bottleneck analysis**: Not formally modeled in `spec.md`. Likely candidates given the design: LLM extraction throughput over ~10K docs (batch processing assumed adequate per this spec's Assumptions), and the 8-stage retrieval pipeline's graph+semantic merge when candidate volume exceeds the 12K-token context budget (edge case, unresolved — [§18](#18-risk-analysis)).
- **Caching strategy**: `permission_cache` (user↔file permission mapping) avoids a live M365 permission check on every retrieval; no TTL/refresh strategy defined (FR-017 gap). `embedding_models`/`chunk_embeddings` avoid re-embedding unchanged chunks.
- **Capacity plan (rough sizing)**: Not stated beyond the POC volume figures above; no rough sizing for PostgreSQL/Neo4j storage or throughput is given in `spec.md`. **[NEEDS CLARIFICATION]**.
- **Rate limiting & load shedding**: Handled only for the outbound Graph API dependency (client retry/backoff on rate-limit errors, User Story 2 Scenario 4); no inbound rate limiting for this system's own APIs is specified.

---

## 15. Reliability & Resilience

- **SLOs and error budgets**: None stated for this feature (see [§7.2](#72-non-functional-requirements)).
- **Timeout budgets**: Not stated.
- **Retry/backoff policy**: Applies to the M365 Graph API client on rate-limit/transient errors (User Story 2 Scenario 4); not stated for internal service-to-service calls (e.g., LLM extraction calls, Neo4j writes).
- **Idempotency keys**: Not explicitly specified for any endpoint; graph upserts are dedup-on-upsert by design (FR-006), which is the closest analog to idempotent writes.
- **Circuit breakers/bulkheads**: Not specified.
- **Graceful degradation behavior**: The one explicit degradation requirement is that a query with no matching content must return an "I don't know" style response rather than a fabricated answer (User Story 1, Acceptance Scenario 3) — this is a correctness requirement more than a resilience pattern, but functions as the system's degradation contract for retrieval misses.

---

## 16. Observability & Operations

- **Metrics (RED/USE)**: Not defined for this feature in `spec.md`. `query_logs` captures per-query latency and result count, which could feed request-rate/duration metrics, but no formal metrics pipeline (contrast with REQ-022's `MetricsTracker`) is specified. **[NEEDS CLARIFICATION]**.
- **Logs (structured fields, correlation IDs)**: Not specified for this feature; the project's global Go standard (structured `slog` logging, `CLAUDE.md` §5) presumably applies, but no feature-specific fields are defined.
- **Traces (spans, propagation)**: Not specified.
- **Dashboards**: `DashboardPage.tsx` gives an overview (recent queries, sync status, graph stats, feedback trends) but this is a product UI, not an ops/monitoring dashboard.
- **Alerts (thresholds, paging policy)**: Not specified.
- **Runbook links & operational procedures**: Not specified for this feature (contrast with the top-level `docs/GIT-OPERATIONS.md` / `docs/SECURITY-MODEL.md` pattern used elsewhere in this repo). **[NEEDS CLARIFICATION]**.

---

## 17. Compatibility Impact

- **API backward compatibility**: Not applicable — this is a net-new API surface with no prior version.
- **Schema compatibility (expand/contract)**: The one explicit forward-compatibility design decision is `chunk_embeddings` being keyed by `(chunk_id, model_id)` so a new embedding model can be introduced without breaking existing vectors (`spec.md` §6).
- **Client impact and rollout plan**: Not applicable at this stage — no existing clients to migrate.
- **Versioning strategy**: Not specified for the REST API surface.

---

## 18. Risk Analysis

| Risk | Likelihood / Impact | Mitigation | Fallback / Contingency | Owner |
|---|---|---|---|---|
| Teams 1:1 chat ingestion (`Chat.Read.All`) has no stated consent/redaction policy | Medium / High (compliance exposure) | Treated as an accepted risk for the single-department POC per this spec's Assumptions | Escalate to a compliance decision before any multi-department rollout | Unassigned — see [§23](#23-open-questions) item 2 |
| `permission_cache` has no staleness/refresh trigger; a user could retain access after an M365 ACL change | Medium / High (permission leak) | None currently designed | Define an invalidation trigger (webhook, TTL, or periodic re-check) before production use | Unassigned — see [§23](#23-open-questions) item 5 |
| Delta token expiry/invalidity forces a full re-sync with no defined handling | Low / Medium (sync outage) | None currently designed | Detect token-invalid response from Graph API and fall back to full re-sync | Unassigned |
| Extraction confidence below usable threshold — store-hidden vs. discard undecided | Medium / Low-Medium (graph noise or knowledge loss) | None currently designed | Decide and document a threshold policy in `internal/nlp/confidence.go` | Unassigned |
| Document parse failure (corrupted/unsupported format) — skip vs. halt undecided | Medium / Low (partial ingestion) | None currently designed | Default to skip-and-log unless stakeholders require halt-on-error | Unassigned |
| Retrieval candidate set exceeds 12K-token context budget | Medium / Medium (truncated/lower-quality answers) | Context packer is token-budget-aware (`context_packer.go`) but selection strategy under overflow is unspecified | Define priority order (e.g., rerank score cutoff) for what gets dropped | Unassigned |
| Architecture reuse-vs-new table (`spec.md` §3) was never filled in | Low / Low (documentation gap, not a functional risk) | None | Fill in before broader team onboarding | Unassigned — see [§23](#23-open-questions) item 1 |

---

## 19. Testing Strategy

- **Unit tests**: Per-package Go unit tests — `internal/connectors/...`, `internal/nlp/...`, `internal/graph/...`, `internal/retrieval/...`, `internal/feedback/...`, and `./...` overall (`spec.md` §16).
- **Integration tests**: `go test -tags=integration ./tests/integration/...` against a mocked MS Graph API (`m365_mock.go`) and test Neo4j instance; `retrieval_test.go` for end-to-end retrieval.
- **Contract tests (API/event schema)**: Not defined — no formal API/event contract exists yet to test against ([§11](#11-api-design-or-interface-contracts) gap).
- **Load/performance tests**: Not defined — no NFR targets exist yet to test against ([§7.2](#72-non-functional-requirements) gap).
- **Security tests (SAST/DAST, dependency scanning)**: Not specified for this feature.
- **Migration tests (backfill validation)**: Not applicable (greenfield); the closest analog is validating `embedding_jobs` re-embedding backfills, not explicitly covered by a stated test.
- **Frontend tests**: `npm run test` (unit) and `npm run test:e2e` (Playwright E2E) under `Frontend/`.
- **UAT plan** — E2E acceptance flow (`spec.md` §16, retained in full as the closest thing to a UAT script):
  1. **Auth**: User logs in via Entra ID → receives JWT → subsequent requests authorized.
  2. **Connect**: Admin configures M365 connection → `/api/m365/connect` returns 200.
  3. **Sync**: Trigger delta sync → `/api/m365/sync` starts, WebSocket emits progress events.
  4. **Ingest**: Verify documents imported → `/api/entities?type=document` returns entities.
  5. **Extract**: Verify NER ran → `/api/entities?type=person` and `/api/entities?type=project` return entities.
  6. **Graph**: Verify graph built → `/api/graph/nodes` returns nodes, `/api/graph/edges` returns edges.
  7. **Query**: Ask Q&A → `/api/knowledge/query` returns contextual answer with citations.
  8. **Feedback**: Submit like/dislike → `/api/feedback` records reaction.
  9. **Analytics**: Check trends → `/api/feedback/stats` shows feedback distribution.
  10. **Permissions**: Verify user only sees entities within their M365 access scope.
  11. **Delta sync**: Update a document on OneDrive → next delta sync picks up the change.

  Plus the per-story Given-When-Then acceptance scenarios (independent tests) from the prior IPA draft:
  - **US1** (`/api/knowledge/query` against a seeded Neo4j + PostgreSQL store): correct cited answer within permission scope; zero content/citations from out-of-scope documents; "no relevant information" response instead of fabrication when nothing matches.
  - **US2** (`/api/m365/sync` against a mocked Graph API): full delta-paginated initial sync persists `change_token`; a second sync after a document edit re-ingests only that document (verified via `chunks.content_hash`); admin dashboard receives real-time WebSocket progress; a Graph API rate-limit/transient error retries rather than failing the whole sync.
  - **US3** (`/api/entities`, `/api/graph/nodes`, `/api/graph/edges` against a pre-extracted Neo4j graph): entity browser filter by type returns matching extracted entities; graph visualization renders related nodes/edges interactively.
  - **US4** (`/api/feedback`, `/api/feedback/stats`): reaction recorded and reflected in analytics; an entity/relationship with accumulated negative feedback below threshold gets re-extracted and re-scored on the next re-evaluation cycle.
  - **US5** (`FeedbackReview.tsx` against existing `feedback_events`/`extraction_confidence` data): admin page surfaces flagged answers alongside confidence trends without needing new feedback generated live.

---

## 20. Acceptance Criteria

> Success criteria below are **proposed placeholders**, not settled SLOs — `spec.md` states no target-metrics table for this feature (`spec.md` §16/17 have no SLO section; contrast with REQ-022's SLO table in `CLAUDE.md` §8b). Treat as a starting point for stakeholder sign-off.

- **SC-001** (→ FR-009, FR-015): 100% of test queries run against permission-restricted documents return answers that contain zero content or citations from documents outside the querying user's M365 access scope.
- **SC-002** (→ FR-002, FR-003): The POC corpus (~10K documents, ~500K messages) completes an initial full sync without requiring manual intervention beyond the sync trigger itself.
- **SC-003** (→ FR-003): **[NEEDS CLARIFICATION]** — no target latency stated for incremental/delta syncs; proposed placeholder: "a routine incremental sync for a single department's typical daily change volume completes within N minutes."
- **SC-004** (→ FR-008): At least 90% of test questions against the POC corpus return an answer with at least one valid (non-fabricated) source citation.
- **SC-005** (→ FR-010, FR-011): Every answer a user flags is visible in the feedback-review admin page, and every entity/relationship whose confidence drops below the re-evaluation threshold is re-scanned within one scheduled re-evaluation cycle, without requiring a manual trigger.
- **Observability evidence (dashboards/alerts exist)**: Not yet deliverable — see [§16](#16-observability--operations) gaps; no dashboards/alerts are currently designed for this feature beyond the product-facing `DashboardPage.tsx`.
- **Rollout & rollback proven**: Not applicable in the traditional sense (greenfield, no predecessor to roll back to); no rollout/rollback plan is stated in `spec.md`. **[NEEDS CLARIFICATION]**.
- **Documentation/runbooks delivered**: Not yet produced — see [§16](#16-observability--operations) gap.

---

## 21. Implementation Plan

- **Milestones & timeline** — six phases in dependency order (`spec.md` §17):

| Phase | Scope | Key Deliverable | Dependencies |
|---|---|---|---|
| 1 | Foundation | M365 connected, files ingested, chunks parsed | None |
| 2 | Knowledge Graph | Entities + relationships in Neo4j | Phase 1 |
| 3 | Q&A Pipeline | Natural language answers with citations | Phase 1, 2 |
| 4 | Feedback Loop | Like/dislike → re-evaluation | Phase 3 |
| 5 | Frontend | Full dashboard UI | Phase 1–3 (also needs Phase 4 for `FeedbackReview.tsx` / dashboard feedback-trends panel — cross-phase dependency not reflected in this table per `spec.md` §17 note) |
| 6 | Permissions | Full permission-aware retrieval | Phase 1, 3 (substantially overlaps Phase 3's `permission_filter.go`; `review_1.2.md` recommends folding Phase 6 into Phase 3 — unresolved, see [§23](#23-open-questions) item 3) |

- **Feature flags / staged rollout**: Not specified — no feature-flag strategy is defined for this feature.
- **Deployment plan / Rollback plan**: Not specified (greenfield; see [§20](#20-acceptance-criteria) gap).
- **Operational readiness checklist**: Not specified — see [§16](#16-observability--operations) gaps (no runbook, alerting, or dashboard plan currently exists for this feature).

---

## 22. Task Breakdown (Traceable)

Task groups below mirror the six implementation phases in [§21](#21-implementation-plan); fine-grained task numbering (`TASK-NNN`) does not yet exist as a separate `tasks.md` for this feature — this table is the current best traceability mapping from `spec.md`'s phase/package structure.

- **TASK-001**: Foundation — Entra ID/JWT auth, MS Graph connectors (OneDrive + Teams), delta sync coordinator, document parsers (docx/xlsx/pptx/pdf/txt), PostgreSQL schema (Phase 1). — Owner: TBD — Estimate: TBD — Depends on: None — Links to: FR-001, FR-002, FR-003, FR-004
- **TASK-002**: Knowledge Graph — LLM-based entity/relationship extraction with confidence scoring, Neo4j graph builder (dedup/upsert), embedding generation + PostgreSQL embedding schema (Phase 2). — Depends on: TASK-001 — Links to: FR-005, FR-006, FR-007
- **TASK-003**: Q&A Pipeline — 8-stage hybrid retrieval pipeline (permission filter → intent → NER → graph query + semantic search → merge → rerank → context pack → answer generation) (Phase 3). — Depends on: TASK-001, TASK-002 — Links to: FR-008, FR-009, FR-015, FR-017
- **TASK-004**: Feedback Loop — feedback storage, analytics, periodic re-evaluation/re-extraction, fine-tuning export (Phase 4). — Depends on: TASK-003 — Links to: FR-010, FR-011
- **TASK-005**: Frontend Dashboard — Q&A UI, entity browser, graph visualization, feedback review, data sources page, login, overview dashboard (Phase 5). — Depends on: TASK-001, TASK-002, TASK-003, TASK-004 (dashboard feedback-trends panel) — Links to: FR-012, FR-013, FR-014, FR-016
- **TASK-006**: Permission-Aware Retrieval hardening — ACL tagging at ingestion, permission cache refresh, full audit of indirect exposure paths (graph expansion, reranking, citations) (Phase 6 — candidate for folding into TASK-003 per `review_1.2.md`). — Depends on: TASK-001, TASK-003 — Links to: FR-009, FR-015, FR-017
- **TASK-007 (QA)**: Backend unit + integration test suites per package, mocked-Graph-API integration tests, frontend unit + Playwright E2E tests (per [§19](#19-testing-strategy)). — Depends on: TASK-001 through TASK-006 (incrementally, per phase) — Links to: all FRs
- **TASK-008 (Infra)**: Provision/verify reachable PostgreSQL and Neo4j instances; configure environment variables (`spec.md` §12) for `DATABASE_URL`, `M365_*`, `NEO4J_*`, `LLM_*`, `JWT_SECRET`, `ALLOWED_ORIGINS`, `DELTA_SYNC_INTERVAL`. — Depends on: None — Links to: all phases
- **TASK-009 (Docs)**: Resolve and document the open questions in [§23](#23-open-questions) (architecture reuse table, Teams chat consent policy, Phase 3/6 folding decision, `pgvector` decision, `permission_cache` invalidation trigger) before Phase 6 sign-off. — Depends on: None — Links to: FR-009, FR-015, FR-017

---

## 23. Open Questions

*(carried over unchanged from `spec.md` §18 — this document does not resolve them, only restates them for traceability)*

1. The Architecture Decisions Summary table (`spec.md` §3) has never been filled in — what's the intended reuse-vs-new breakdown per architectural dimension? *Best guess*: fully populate it against the RAD reuse table already in `spec.md` §14. *Decider*: TBD. *Due*: before broader team onboarding.
2. No requirement currently addresses consent/retention/redaction for ingesting `Chat.Read.All` / `ChannelMessage.Read.All` content (tenant-wide private chat access) — is this an accepted risk for the POC, or does it need a stated policy before Phase 1? *Best guess*: accepted risk for the single-department POC (per this spec's Assumptions), revisit before any multi-department rollout. *Decider*: compliance/legal + product owner. *Due*: before Phase 1 sign-off if a stricter stance is required.
3. Should Phase 6 remain a separate phase, or be folded into Phase 3 given its stated deliverables are already covered there? *Best guess*: fold into Phase 3, per `review_1.2.md`'s recommendation. *Decider*: TBD. *Due*: before Phase 3 implementation starts.
4. Should `chunk_embeddings.embedding` use `pgvector`'s `vector` type for ANN search, or is exact/brute-force search sufficient at this POC's data volume (~10K docs)? *Best guess*: brute-force is likely sufficient at POC scale; revisit if latency targets (once set, see SC-003) aren't met. *Decider*: TBD. *Due*: before Phase 2 embedding-store implementation.
5. `permission_cache` still has no staleness/expiry field, even though Phase 6 describes "cache refresh" as a `permissions.go` responsibility — what's the invalidation trigger when a user's M365 ACL changes? *Best guess*: none proposed yet — this is the highest-severity open gap (see [§18 Risk Analysis](#18-risk-analysis)). *Decider*: TBD. *Due*: before production use, ideally before Phase 6.

---

## 24. Appendix

### Glossary

See [§12.1 Domain Model](#121-domain-model) for full definitions of: M365 File, Chunk, Business Entity, Relationship, M365 Connection, Feedback Event, Query Log.

### ADR references

None exist yet for this feature; the closest analogs are the three consolidated draft specs (`spec_1.1.md`, `spec_1.2.md`, `spec_1.3.md`) and `review_1.2.md`, whose conflict-resolution decisions are recorded in `spec.md` §0.

### Schemas/examples

Full PostgreSQL DDL and Neo4j Cypher schema: [§12.2](#122-database-schema-changes). NLP extraction I/O shape:
```
TextChunk → LLM (custom API) → {
  entities: [{ type: "Person", name: "...", confidence: 0.92 }],
  relationships: [{ from: "Person:...", to: "Project:...", type: "works_on", confidence: 0.87 }]
}
```

### Sequence diagrams (textual steps)

See [§8](#8-proposed-solution-to-be-overview) end-to-end workflow (steps 1–6) and [§9.4](#94-state-machine-if-applicable) state machines for delta sync, retrieval pipeline, and feedback loop.

### Rollout checklists

None exist yet — tracked as a gap in [§16](#16-observability--operations) and [§21](#21-implementation-plan).

### Assumptions

*(retained verbatim from the prior IPA draft)*

- An Entra ID tenant and app registration already exist (or can be provisioned), and the required Microsoft Graph app permissions (`Sites.Read.All`, `Files.Read.All`, `Chat.Read.All`, `ChannelMessage.Read.All`, `Group.Read.All`) can be granted by IT/security ahead of Phase 1.
- The internal, OpenAI-compatible custom LLM endpoint (used for both NER/extraction and embeddings) can handle the extraction and embedding workload for ~10K docs + ~500K messages within the POC's timeframe.
- PostgreSQL and Neo4j instances are provisioned and reachable by the backend service; this spec does not cover their own infra provisioning.
- Consent/retention/redaction policy for ingesting private Teams 1:1 chat content is being handled outside this spec (an open compliance question per `spec.md` §18 item 2) — this spec assumes it is an accepted risk for the single-department POC unless told otherwise.
- Scope is a single department (~50 users); multi-department scaling and any resulting permission-model complexity is explicitly out of scope for this spec.
- "Given-When-Then" acceptance scenarios in [§19](#19-testing-strategy) assume a mocked/seeded MS Graph API and pre-populated Neo4j/PostgreSQL are acceptable substitutes for a live M365 tenant during testing (per `spec.md` §16's mock-based integration test approach).
