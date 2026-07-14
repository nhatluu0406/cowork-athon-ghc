# Phase 8: Hardening & Testing Checklist

**Status**: Ready for implementation  
**Estimated Completion**: 2-3 weeks  
**Phases Complete**: 1-7 (MVP functional)

## T103: Security Audit

**Permission Scope Validation** ✓ Need to verify:
- [ ] No user can access documents outside their permission scope in retrieval pipeline
- [ ] Graph expansion (Stage 3) respects permission boundaries
- [ ] Reranking (Stage 5) does not leak metadata from out-of-scope entities
- [ ] Citations in answers (Stage 7) reference only accessible sources
- [ ] Feedback endpoints validate user can access query_id they're rating

**Tools**:
```bash
# Automated test to verify permission isolation
go test -tags=integration ./tests/integration/retrieval/permissions_test.go -v
```

**Verification**: Query as User A with scope [Doc1, Doc2], attempt to access User B's doc (Doc3). Must receive "no results" not error.

---

## T104: Unit Test Coverage (Target ≥80%)

**Current Status**: ~30% (core structs exist, tests pending)

**Priority areas**:
- [ ] `internal/retrieval/` (7 stages × 3 tests = 21 tests)
- [ ] `internal/feedback/` (4 modules × 2 tests = 8 tests)
- [ ] `internal/connectors/` (OAuth2, delta sync state machine)
- [ ] `internal/nlp/` (extraction, confidence scoring)
- [ ] `internal/graph/` (builder, traversal, dedup)

**Commands**:
```bash
go test ./... -cover
go tool cover -html=coverage.out
```

**Target**: 80%+ coverage, no panics, all errors propagated correctly.

---

## T105: Integration Tests

**End-to-end flows**:
- [ ] M365 ingest → chunks → NLP → graph → query
- [ ] Permission filtering → semantic search → reranking → answer
- [ ] Feedback submission → re-evaluation trigger
- [ ] Delta sync state machine (IDLE→RUNNING→COMPLETED or FAILED)

**Test database**: PostgreSQL 15 (docker-compose up, tests use separate schema)

**Commands**:
```bash
go test -tags=integration ./tests/integration/... -v
```

---

## T106: CI/CD Pipeline

**GitHub Actions** (`.github/workflows/`):
- [ ] Go build & test on push
- [ ] Lint with `golangci-lint`
- [ ] Security scan with `gosec`
- [ ] Docker build & push on tag
- [ ] Frontend TypeScript check & Prettier
- [ ] Playwright E2E on staging

**Commit requirements**:
```bash
# Before push:
make lint  # no errors
make test  # all pass
go vet ./...  # no warnings
```

---

## T107: Database Migration Rollback

**Verify downtime = 0**:
- [ ] Migration 001 applies cleanly, creates 11 tables
- [ ] Migration 001 rollback succeeds, drops tables without error
- [ ] No foreign key constraint violations on rollback
- [ ] Test with docker-compose: `docker-compose down && docker-compose up`

**Commands**:
```bash
# Apply
psql -f migrations/001_initial_schema.sql

# Rollback
psql -f migrations/001_initial_schema_rollback.sql

# Verify state
psql -d ragmini -c "\dt"  # Should show 0 tables
```

---

## T108: CLAUDE.md Update

**Add to CLAUDE.md §8b (after REQ-022 section)**:

```markdown
### REQ-204 Enterprise Knowledge Graph — Architecture Summary

**Status**: ✅ Complete (MVP Phases 1-7, Hardening Phase 8 in progress)

**Tech Stack**: Go 1.21 + PostgreSQL 15 + Neo4j 5.x + React 18 + TypeScript 5 + Vite

**Key Components**:
- M365 Connector: OAuth2, delta sync, multi-format parsing (docx/xlsx/pptx/pdf)
- NLP Pipeline: LLM-based entity extraction, confidence scoring (0.0-1.0)
- Knowledge Graph: Neo4j with 7 entity types, dedup, build→validate→publish
- Retrieval: 8-stage pipeline (permission → intent → search ∥ expand → rank → pack → answer)
- Feedback Loop: User feedback collection, low-confidence hotspot detection, re-evaluation engine
- Frontend: 7 dashboard pages, TanStack Query + Zustand, real-time WebSocket

**Files**:
- Backend: `src/m365-knowledge-graph/` (main module)
- Frontend: `src/Frontend/src/pages/` (React components)
- DB: `migrations/001_initial_schema.sql` (11 tables)
- Specs: `specs/001-m365-knowledge-graph/` (design docs)

**Constraints** (LOCKED):
1. PostgreSQL only (not SQLite, not LanceDB)
2. MergeAssistant independence: zero cross-imports

**SLOs** (Phase 8 validation):
- Q&A latency: ≤30s (p95)
- Retrieval precision: ≥85% (top-5 accuracy)
- Permission isolation: 100% (no scope leaks)
- System uptime: ≥99% (graceful shutdown, connection pooling)
```

---

## T109: Runbook Documentation

**Create** `docs/m365-knowledge-graph/RUNBOOK.md`:

```markdown
# M365 Knowledge Graph — Operations Runbook

## Deployment

### Local Development
```bash
docker-compose up
cd src/m365-knowledge-graph && go run ./cmd/main.go
# API: http://localhost:8080
```

### Production
```bash
export DATABASE_URL=postgres://user:pass@db.example.com/ragmini
export NEO4J_URI=bolt://neo4j.example.com:7687
export M365_TENANT_ID=...
make docker-build && docker push registry/image:v1.0.0
```

## Troubleshooting

### "permission denied" on query
→ Check user_id extraction from JWT, verify permission_cache populated

### "low confidence hotspot" alerts
→ Check `extraction_confidence` table, run re-evaluation manually

### "WebSocket 4401" errors
→ JWT token expired, user must re-login

### Sync failure
→ Check delta_state sync_progress, validate M365 auth tokens
```

---

## T110: API Documentation (OpenAPI/Swagger)

**Generate** from `contracts/api.md`:

```yaml
openapi: 3.0.0
info:
  title: M365 Knowledge Graph API
  version: 1.0.0

paths:
  /api/knowledge/query:
    post:
      summary: Q&A endpoint (main entry point)
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/QueryRequest'
      responses:
        '200':
          description: Answer with sources and citations
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/QueryResponse'

  /api/feedback:
    post:
      summary: Submit user feedback
      parameters:
        - name: Authorization
          in: header
          required: true
          schema:
            type: string
            example: "Bearer <JWT>"
```

---

## T111: Performance Validation

**P95 Latency ≤ 30s Test**:
```bash
# Use Apache JMeter or custom script
for i in {1..100}; do
  time curl -X POST http://localhost:8080/api/knowledge/query \
    -H "Content-Type: application/json" \
    -d '{"query":"who is the expert on machine learning?"}'
done | grep real | awk '{print $2}' | sort -nr | head -5
```

**Success Criteria**:
- 95th percentile response time ≤ 30 seconds
- Throughput ≥ 5 req/s (single instance)
- Memory stable at <500MB baseline

---

## T112: Load Testing & Independence Verification

**POC Volume**: 10K docs, 500K messages, 50 concurrent users

**Load Test**:
```bash
k6 run tests/load/basic_scenario.js --vus 50 --duration 5m
```

**Independence Verification**:
```bash
# Must return empty (zero dependencies)
grep -r "MergeAssistant" src/m365-knowledge-graph/
grep -r "src/Backend\|src/Frontend" src/m365-knowledge-graph/ | grep -v "spec\|doc"
```

**Pass Criteria**:
- Zero grep results (true independence)
- P95 latency still ≤ 30s under load
- No "connection pool exhausted" errors
- Database CPU < 80% sustained

---

## Sign-Off Criteria (Phase 8 Complete)

- [ ] All 12 hardening tests pass
- [ ] Unit test coverage ≥80%
- [ ] Permission audit: zero leaks
- [ ] CI/CD green on all checks
- [ ] Performance SLO met (p95 latency ≤30s)
- [ ] Load test passed (POC scale)
- [ ] Independence verified (zero cross-imports)
- [ ] CLAUDE.md updated with REQ-204 status
- [ ] Runbook + API docs complete
- [ ] Migration rollback tested

**Timeline**: 2-3 weeks (parallel where possible)

**Owner**: DevOps + QA + Security review
