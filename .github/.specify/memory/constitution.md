<!-- 
SYNC IMPACT REPORT
Version Change: TEMPLATE (uninitialized) → 1.0.0 (initialization)
Modified Principles: All 5 core principles filled from template
Added Sections: None (all template sections retained)
Removed Sections: None
Templates Updated:
  ✅ .specify/templates/plan-template.md — cross-reference verified
  ✅ .specify/templates/spec-template.md — scope alignment verified
  ✅ .specify/templates/tasks-template.md — quality gates referenced
Follow-up TODOs: None — all placeholders populated with authoritative values from CLAUDE.md
-->

# MiniRAD Constitution

**Project**: RAD Knowledge Gateway (Retrieval-Augmented Development)

## Core Principles

### I. Accuracy Over Speed

All system decisions prioritize **data correctness and consistency** ahead of performance optimization.

**Rules**:
- MUST: Data integrity violations block all forward progress.
- MUST: Every optimization trade-off MUST be justified with correctness proofs.
- MUST: Epoch-based visibility ensures unpublished data never reaches users.
- SHOULD: Performance targets are secondary to verified correctness.

**Rationale**: Users depend on RAD for critical engineering decisions (spec generation, bug fixes, code reviews). Incorrect results cause greater damage than slow results. Once correctness is established, optimization is safe.

### II. Semantic Knowledge > Raw Text

The system treats **structured semantic metadata** as the authoritative knowledge layer, never raw source text.

**Rules**:
- MUST: No raw text indexed directly without semantic extraction (FR-01).
- MUST: All knowledge includes source_ref (file/line/commit) for traceability.
- MUST: Conflict detection (code vs. docs vs. tests) is mandatory before knowledge publication (FR-06).
- MUST: Multi-resolution L1-L4 context layers used for retrieval, not raw source dumps.
- SHOULD: Legacy documentation only ingested after canonical verification.

**Rationale**: Raw text retrieval (60%+ token overhead, 40%+ hallucination rate) is fundamentally unreliable. Semantic extraction, quality scoring, and conflict detection create verifiable, traceable knowledge suitable for AI augmentation.

### III. Test-First, Deterministic Verification (NON-NEGOTIABLE)

Implementation **MUST** follow strict red-green-refactor cycle with deterministic correctness tests.

**Rules**:
- MUST: Incremental indexing results ≡ Full rebuild results (same pipeline version, same input).
- MUST: Crash-safety tests verify data consistency after simulated failures at every step.
- MUST: Equivalence tests run before shipping any new parser, reranker, or indexing logic.
- MUST: Test coverage targets: >80% for core business logic, >90% for epoch/transaction code, >75% for API handlers.
- MUST: P0 correctness test suite runs on every commit (< 30 seconds).

**Rationale**: A system claiming to improve developer workflow gains trust only if itself trustworthy. Deterministic verification prevents silent data corruption; crash-safety tests enforce durability; incremental-≡-full guarantees catch subtle bugs at scale.

### IV. Hybrid Retrieval Architecture

Search pipelines **MUST** layer intent detection, metadata filtering, vector search, graph expansion, reranking, and selective hydration in strict order.

**Rules**:
- MUST: Intent detection (Stage 1) precedes all queries to route to optimal retrieval strategy.
- MUST: Metadata pre-filtering (Stage 2, quality_score > 0.75) reduces vector search cost.
- MUST: Graph expansion (Stage 4) uses BFS depth ≤2 to balance recall vs. token budget.
- MUST: Reranker (optional Stage 5) weights BERT score 70% + TF-IDF score 30%.
- MUST: Context packing (Stage 7) respects token budget (default 12K) with fallback to lower-fidelity context.
- SHOULD: Vector search latency <200ms; full pipeline p99 latency <500ms.

**Rationale**: Hybrid retrieval balances precision (metadata + semantics) with recall (graph expansion), yielding 60%+ token savings without accuracy loss. Strict ordering prevents resource waste and ensures reproducibility.

### V. Source-of-Truth Hierarchy & Traceability

When conflicts arise, **resolve according to source priority** and always embed the source reference.

**Priority Order** (highest → lowest):
1. Executable source code (most authoritative)
2. Test assertions & CI verification
3. Design specifications & architecture docs
4. Legacy documentation (lowest, always flagged for verification)

**Rules**:
- MUST: Every fact in LLM context includes source_ref for user verification.
- MUST: Conflicts between code and docs MUST be detected (FR-06) and flagged to users.
- MUST: Code-docs mismatches generate warnings in knowledge publication.
- SHOULD: Maintain continuous audit log of conflict detections & resolutions.

**Rationale**: Prevents hallucination by ensuring all knowledge is traceable to its origin. Developers can verify claims by walking source references. Conflict warnings expose stale documentation and incomplete specifications early.

## Architecture & Technical Constraints

### Atomic Visibility (P0 Invariant)

**MUST**: Every published epoch is atomic; unpublished epochs never visible to users.

Implementation:
- BEGIN TRANSACTION → Write files/symbols/chunks → Write epoch record → UPDATE repos SET active_epoch=N → COMMIT
- On crash at any step: active_epoch unchanged → data consistent
- No partial reads possible; crashed writes automatically rolled back by WAL mode

### Deterministic Indexing (P0 Invariant)

**MUST**: Identical source commits + same pipeline version → identical index output.

Implementation:
- Content-hash (MD5) of every source file → copy-forward embeddings if unchanged (70-80% cost reduction)
- No time-dependent logic in extraction (no random sampling, no stochastic scoring)
- Batch processing with deterministic ordering (sort by file ID before processing)

### Crash Safety (P0 Invariant)

**MUST**: Partial writes never visible; system recovers to last known good state.

Implementation:
- SQLite WAL mode (write-ahead logging) for metadata.db
- Atomic file operations: write temp file → fsync → rename (prevents corruption)
- Epoch validator checks all references before publishing (no dangling pointers)

### Traceability (P0 Invariant)

**MUST**: Every piece of knowledge includes source reference; no anonymous facts.

Implementation:
- source_ref tuple: (file_path, line_start, line_end, commit_sha)
- Symbols table includes quality_score, source_layer (L1/L2/L3/L4), conflict_status
- UI displays source reference for every result; users can click through to code

## Development Workflow & Quality Gates

### Code Review & Verification

**MUST**: All PRs verified against constitution before merge.

Checks:
- Correctness: Incremental-ology tests pass (Phase 5+)
- Architecture: No raw-text indexing; all facts source-attributed
- Performance: Latency benchmarks <5% regression vs. baseline
- Security: No credential leaks; rate-limiting rules enforced; CORS configured

### Testing Discipline

**MUST**: Test categories strictly enforced per component:

| Component | Test Type | Coverage Target | Runs |
|---|---|---|---|
| epoch/ (builder, validator, publisher) | correctness + crash-safety | >90% | on every commit |
| parser/* (language extractors) | equivalence tests | >85% | on change |
| retriever/ (search pipeline) | integration + benchmark | >80% | daily |
| api/ (handlers) | unit + E2E | >70% | on PR |
| metadata/ (DB layer) | integration + correctness | >75% | on schema change |

### Configuration & Runbooks

**MUST**: Every deployment scenario documented with runbook.

Current runbooks:
- `docs/deployment/local-dev.md` — SQLite setup, local server
- `docs/deployment/docker-onprem.md` — Docker compose, health checks, troubleshooting
- `docs/deployment/kubernetes.md` — TBD (Phase 7+)

## Governance

### Amendment Procedure

**Versioning Rules**:
- **MAJOR** (e.g., 1.0 → 2.0): Fundamental principle removed or incompatibly redefined; requires team consensus
- **MINOR** (e.g., 1.0 → 1.1): New principle added or existing principle clarified/expanded; documented in CHANGELOG
- **PATCH** (e.g., 1.0 → 1.0.1): Wording, typo fixes, non-semantic clarifications; automated

**Amendment Process**:
1. Identify change category (new principle, clarification, governance tweak)
2. Update `.specify/memory/constitution.md` with concrete values (no placeholders)
3. Generate Sync Impact Report (prepend as HTML comment)
4. Review against dependent templates (plan, spec, tasks)
5. Update LAST_AMENDED_DATE and VERSION
6. Git commit with message: `docs: amend constitution to vX.Y.Z (rationale)`

### Compliance Review

**Frequency**: Every 3 months or after major implementation phase

**Scope**: Audit sample of recent PRs against constitution principles:
- Architecture checks: 5 random PRs
- Correctness: 2 random bug fixes (verify tests were written first)
- Traceability: 2 random feature PRs (verify source_ref embedded)

### Runtime Guidance

All developers MUST consult **CLAUDE.md** (project runtime guide) alongside this constitution.

CLAUDE.md contains:
- Detailed coding conventions (Go, TypeScript, testing patterns)
- Current project status & blockers
- Frequently used commands & workflows
- Common mistakes to avoid

Constitution sets **non-negotiable principles**; CLAUDE.md shows **how to apply them** in daily work.

---

**Version**: 1.0.0 | **Ratified**: 2026-05-29 | **Last Amended**: 2026-05-29

**Project**: RAD Knowledge Gateway (Retrieval-Augmented Development)  
**Status**: Active — Phases 1-6 complete, Phase 7 (Scalability) in progress, Phase 8 (Analytics) designed
