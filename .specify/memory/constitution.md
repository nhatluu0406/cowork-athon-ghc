# RAD Knowledge Gateway — Project Constitution

> **Version**: 1.0  
> **Date**: 2026-06-06  
> **Scope**: RAD Knowledge Gateway (all REQs)  
> **Authority**: Project Leadership + Architecture Council

---

## 核心原則 (MUST — Inviolable)

### INVARIANT-1: 正確性 > パフォーマンス

**The Rule**: Test determinism before optimizing. Prefer verified-correct over fast.

**Why**: The system's value is in reliability. A 10% faster indexer that silently produces wrong results is worthless. A slower but deterministic builder is the foundation.

**How to Apply**:
- Every optimization must be preceded by a correctness test (e.g., Determinism TC-F38-31~33)
- If performance target conflicts with correctness, default to correctness
- Example: FR-38 Builder optimization → Run determinism tests first
- Counter-example (bad): Add caching without verifying it produces identical results

### INVARIANT-2: Atomic Visibility

**The Rule**: Unpublished epochs must never be visible to the user or API. All writes to an epoch's data occur within a single DB transaction.

**Why**: Partial writes corrupt the graph. A crash mid-flight must leave the system in a consistent state.

**How to Apply**:
- All writes to `code_graph_nodes`, `code_graph_edges`, `circular_dependencies`, `graph_build_stats` for the same epoch must occur in a single transaction
- Use SQLite WAL mode + explicit `BEGIN TRANSACTION; ...; COMMIT;`
- If TX fails, rollback atomically (no partial state visible)
- Example (FR-38): `epoch_publisher.Publish(ctx, repoID, epoch)` → single TX
- Counter-example (bad): Save nodes, then edges, then stats in separate queries

### INVARIANT-3: 決定論的インデックス化

**The Rule**: Same input + same pipeline version → Always identical output.

**Why**: Correctness verification depends on reproducibility. Nondeterminism breaks confidence in the system.

**How to Apply**:
- Node IDs = qualified_name (deterministic)
- Edge IDs = SHA256(from_node_id + to_node_id + edge_type + file_path + line_number) (deterministic)
- No randomization in graph construction
- Processing order must not affect output
- Example (FR-38): BuildGraph(repoPath, commit) called 3 times → identical node IDs, edge IDs
- Test this with TC-F38-31, TC-F38-32, TC-F38-33

### INVARIANT-4: クラッシュセーフティ

**The Rule**: No partial writes visible, ever. If the system crashes mid-operation, the DB remains consistent.

**How to Apply**:
- SQLite WAL + transactions (automatic with Go's database/sql)
- File writes: write-to-temp, then atomic rename (not in-place modify)
- Never trust partial writes; validate with `active_epoch` check
- Example: If `python main.py` crashes during embedding, old embeddings remain; new ones never partially visible

### INVARIANT-5: ソーストレーサビリティ

**The Rule**: Every knowledge unit has a source reference (file, line, commit).

**Why**: Users need to verify where a claim comes from. "Code says X" without source is useless.

**How to Apply**:
- Every symbol in code_graph_nodes: file_path, start_line, end_line, commit hash
- Every edge in code_graph_edges: file_path, line_number (where the edge is defined)
- Never accept anonymous knowledge
- Example (FR-38): Edge `calls` from AuthService.Validate → AuthService.CheckExpiry must record which file + line the call appears

---

## テスト品質要件

### P0 (Must-Have) — Feature is Unusable Without These

| Requirement | Metric | How to Verify |
|---|---|---|
| **Unit Tests** | ≥ 60 tests per major module | `go test -v ./internal/graph/...` |
| **Integration Tests** | ≥ 6 tests (E2E flows) | `go test -v ./tests/integration/graph/...` |
| **Determinism Tests** | ≥ 3 (correctness proof) | TC-F38-31, TC-F38-32, TC-F38-33 pass |
| **DB Schema Tests** | ≥ 5 (persistence validation) | Verify nodes/edges/cycles recorded correctly |
| **API Handler Tests** | ≥ 4 (endpoint coverage) | `/api/graph/nodes`, `/api/graph/edges` respond correctly |
| **Code Coverage** | ≥ 80% | `go test -cover ./internal/graph/...` |
| **All 39 Spec Test Cases** | 100% pass rate | TC-F38-01 through TC-F38-39 all pass |

### P1 (Should-Have) — Feature is Better With These

| Requirement | Metric | Target |
|---|---|---|
| **Performance** | Build time per 1万 symbols | < 120 seconds |
| **Accuracy** | Call graph correctness | ≥ 85% (manual validation) |
| **Accuracy** | Inheritance graph correctness | ≥ 95% |
| **Cycle Detection** | Detection rate | 100% (all cycles found) |

### P2 (Nice-to-Have) — Completeness

- Frontend E2E tests (graph visualization)
- Accuracy corpus (hand-labeled test set)
- Documentation (README, architecture diagrams)
- Load testing (100K+ symbols)

---

## 品質ゲート (Quality Gates)

### Before Merge to Main

**Mandatory**:
- [ ] All 62 unit tests pass
- [ ] All 9 integration/determinism tests pass
- [ ] All 5 DB tests pass
- [ ] All 4 API tests pass
- [ ] Code coverage ≥ 80%
- [ ] `go vet` passes (no unused variables, shadowing, etc.)
- [ ] `gofmt` applied (consistent formatting)
- [ ] No compiler warnings

**Recommended**:
- [ ] Benchmark results recorded (performance baseline)
- [ ] Test summary document generated
- [ ] README updated with FR-38 status

### Before Release

- [ ] All 39 spec test cases (TC-F38-01~39) verified
- [ ] Performance verified: < 120s / 1万シンボル
- [ ] Accuracy validated: ≥ 85% (call graph), ≥ 95% (inheritance)
- [ ] End-to-end flow tested (code → graph → API → frontend)

---

## スコープ制御

### In-Scope for FR-38

✅ Code Graph Construction:
- Symbol extraction (FR-01 reuse)
- Edge resolution (calls, implements, extends, depends_on, verified_by, configures, overrides, instantiates)
- Cycle detection
- DB persistence (4 tables)
- Test infrastructure (unit + integration)

### Out-of-Scope (Separate FRs)

❌ Graph Traversal (FR-39)
❌ Graph Expansion (FR-34)
❌ Frontend Visualization (FR-43)
❌ API Gateway (separate)
❌ LLM Integration (FR-02)

---

## ガバナンス

### Decision Authority

| Decision Type | Authority | Escalation |
|---|---|---|
| Code review approval | Tech lead (any approved reviewer) | Architecture council |
| Test requirement changes | Project lead | Steering committee |
| Timeline adjustments | Project lead | Program manager |
| Scope creep | Product owner | Program manager |

### Meeting Cadence

- **Daily Standup**: 10 min sync on blockers
- **Weekly Architecture**: Design review + INVARIANT checks
- **Bi-weekly Sprint Planning**: Task breakdown + capacity planning

---

## ドキュメント管理

### Canonical Sources

| Artifact | Location | Owner | Update Cadence |
|---|---|---|---|
| **Specification** | `specs/REQ-003-engineering-knowledge-system/FR-38/spec.md` | Architect | When requirements change |
| **Implementation Plan** | `specs/REQ-003-engineering-knowledge-system/FR-38/plan.md` | Project Lead | Weekly during Phase 1-2 |
| **Tasks** | `specs/REQ-003-engineering-knowledge-system/FR-38/tasks.md` | Project Lead | Daily during execution |
| **Constitution** | `.specify/memory/constitution.md` | Architecture Council | When principles change |
| **Design** | `docs/design/basic-design.md` | Architect | After Phase 1 |
| **Test Results** | `specs/REQ-003-engineering-knowledge-system/FR-38/TEST_RESULTS.md` | QA | After each phase |

### Version Control

- All documents in Git (no external Google Docs)
- Commit message format: `docs: update FR-38 {artifact}` or `feat: FR-38 implementation`
- No force-push to main (use pull requests)
- Require 2 approvals before merge

---

## 例外処理 (Exception Process)

If a situation arises where one of the INVARIANT-1~5 must be violated:

1. **Document the exception**: Why, for how long, impact analysis
2. **Get approval**: Architecture council + Project lead
3. **Set expiration date**: Date by which the exception must be resolved
4. **Track in JIRA/GitHub**: Tag with `technical-debt` label
5. **Plan remediation**: Schedule work to eliminate exception

**Example**: If FR-38 performance requires non-deterministic caching temporarily:
- Doc: "Temporary: LRU cache added without determinism test to meet 120s goal"
- Approval: Architecture council signs off
- Expiration: "Resolved by 2026-06-15"
- Remediation: "Add determinism test to cache layer"

---

## チェックリスト: 新しい要件を追加するたびに

Whenever a new requirement (FR-XX) is added:

- [ ] Does it violate INVARIANT-1~5? If yes, exception process required
- [ ] Is test strategy defined (unit/integration/system)?
- [ ] Are quality gates explicit (coverage %, performance, accuracy)?
- [ ] Are dependencies on other FRs documented?
- [ ] Is scope clearly bounded (in-scope vs. out-of-scope)?
- [ ] Is constitution alignment verified?

---

## References

- CLAUDE.md (Project guidelines)
- INVARIANT-1~5 (Sections 1-5 above)
- Test Strategy (§8 in plan.md)
- Specification (spec.md §12 test cases)

---

> **Constitution v1.0** | RAD Knowledge Gateway | Effective 2026-06-06  
> **Ratified by**: Architecture Council (Claude Code)  
> **Next Review**: 2026-12-06 (6 months)

