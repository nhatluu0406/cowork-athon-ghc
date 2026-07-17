# Research: Enterprise Knowledge Graph from Microsoft 365

**Phase**: 0 | **Input**: plan.md Technical Context, spec.md §1 Locked Decisions

No `NEEDS CLARIFICATION` markers remain in plan.md's Technical Context — all decisions below were resolved during the planning session (spec.md §1) and are treated as locked, not open research questions. This file documents the rationale and alternatives considered for traceability.

## 1. Metadata store: PostgreSQL

- **Decision**: PostgreSQL for all metadata, embeddings, sync state, feedback, query logs.
- **Rationale**: Client-server DB supports concurrent writers (delta sync + NLP extraction + Q&A pipeline running simultaneously), `JSONB` for ACL/config blobs, `tsvector`/`pg_trgm` for lexical search fallback, mature Go driver (`lib/pq`).
- **Alternatives considered**: SQLite (rejected — single-writer model unsuitable for concurrent ingestion + query workload at 10K docs/500K messages; also explicitly locked out per user directive, see memory `req204-mergeassistant-critical-constraints`); LanceDB for embeddings (rejected — introduces a second storage engine for what PostgreSQL + optional `pgvector` can hold in one place).

## 2. Graph store: Neo4j

- **Decision**: Neo4j for the business knowledge graph (entities + relationships).
- **Rationale**: Purpose-built for multi-hop traversal (BFS/DFS depth 1-2 in retrieval Stage 3/4), Cypher expressiveness for path-finding (`/api/graph/path`), mature clustering/indexing story at the target scale.
- **Alternatives considered**: Modeling the graph in PostgreSQL via adjacency tables (rejected — multi-hop traversal queries become recursive CTEs that don't scale past a few thousand nodes cleanly); embedded graph libraries (rejected — no persistence/query language fit for cross-process access from the API layer).

## 3. Auth: Entra ID SSO + local JWT fallback

- **Decision**: Microsoft Entra ID (OIDC/OAuth2) as primary; local JWT issuance for demo/test only.
- **Rationale**: Native M365 integration reuses the same tenant identity that already gates OneDrive/Teams access — permission cache (`permission_cache` table) can key off the same `user_id`. JWT fallback keeps local dev/demo unblocked without requiring a tenant app registration.
- **Alternatives considered**: Generic username/password with Argon2id (rejected in spec.md §1 provenance note — the `spec_1.3.md` draft proposed this but it does not apply; dropped as a divergent draft resolution, not applicable to an M365-native product).

## 4. Sync strategy: delta queries

- **Decision**: MS Graph delta query + `changeToken` persistence per source (`delta_state` table).
- **Rationale**: Avoids full re-enumeration of 10K+ docs / 500K+ messages on every sync tick; near-real-time incremental updates; native Graph API support for both OneDrive (`/delta`) and Teams message endpoints.
- **Alternatives considered**: Full periodic re-crawl (rejected — does not scale to the stated data volume within a 5-minute sync interval).

## 5. LLM integration: custom OpenAI-compatible endpoint

- **Decision**: Single custom API endpoint (`LLM_API_BASE_URL`) used for both NER/extraction and answer generation; separate model config for embeddings (`LLM_EMBED_MODEL`).
- **Rationale**: Matches RAD Knowledge Gateway's existing LLM runtime interface pattern (`internal/llm/runtime.go`) — reused directly per spec.md §14 reuse table. Internal LLM server avoids sending M365 content to a third-party API.
- **Alternatives considered**: Direct Anthropic/OpenAI SaaS API (rejected for entity extraction over internal M365 content — data residency; not precluded for future cloud-LLM answer generation but out of scope for POC).

## 6. Embedding vector storage format

- **Decision (POC)**: `BYTEA` serialized float32 array in `chunk_embeddings.embedding`, with brute-force cosine similarity computed in the `semantic_search.go` retrieval stage.
- **Rationale**: At ~10K docs (order 50K-200K chunks), a full in-process scan is within the ≤30s p95 latency budget when combined with metadata pre-filtering (permission scope, source type) before the similarity pass.
- **Alternatives considered**: `pgvector` extension with ANN index (deferred, not rejected — flagged as Open Question #4 in spec.md §18; revisit if POC data volume grows past a single department or p95 latency regresses). This is the one item carried forward as a future decision point rather than resolved now, since it does not block Phase 1-3 implementation.

## 7. MergeAssistant independence

- **Decision**: `backend/` (this feature — `src/m365-knowledge-graph/` in the parent MiniRag monorepo, before this repo's 2026-07-11 standalone extraction) and `src/MergeAssistant/` (parent-repo sibling module, not present in this standalone repo) remain fully separate Go modules with zero shared imports.
- **Rationale**: User directive (locked, see memory `req204-mergeassistant-critical-constraints`) — MergeAssistant must run independently of any RAD platform change, including this new feature.
- **Alternatives considered**: Sharing a common `internal/db` or `internal/llm` package across both (rejected — violates the independence constraint even though both use PostgreSQL and an LLM runtime interface; pattern reuse is done by copying/adapting code, never by runtime sharing).

---

All Technical Context items are resolved. No blocking unknowns remain before Phase 1 design.
