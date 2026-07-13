# Task Completion & Verification Framework

**Purpose**: Define what "task complete" means, ensure 100% accuracy via dual audit, and gate all task closures on unit test success.

**Version**: 1.0  
**Last Updated**: 2026-07-12  
**Owner**: DungPham (DungPD4@fpt.com)

---

## Table of Contents

1. [Task Completion Criteria](#task-completion-criteria)
2. [Unit Test Requirements](#unit-test-requirements)
3. [Dual Audit Process](#dual-audit-process)
4. [Marking Tasks Complete](#marking-tasks-complete)
5. [Tracking & Metrics](#tracking--metrics)

---

## Task Completion Criteria

A task is **complete and verified** only when **ALL** of the following are true:

### Criterion 1: Code Implementation (Non-Mock)

- [ ] **Code exists at the specified path** — file created at the location described in the task
- [ ] **Code is production-ready, not stub/mock** — function bodies are fully implemented, not `TODO()`, `panic()`, or placeholder code
- [ ] **Code follows project conventions** — naming, error handling, logging per CLAUDE.md and code style
- [ ] **No dead code or unreachable logic** — linters pass (`gofmt`, `golangci-lint`, `vet`)

**Audit checkpoint**: Run `go vet ./...` and `go fmt` locally; flag any non-canonical formatting as incomplete.

### Criterion 2: Wiring into Runtime

- [ ] **Code is reachable from the entry point** — for backend: wired into `cmd/main.go`, router, or middleware; for frontend: imported and rendered in the component tree
- [ ] **No configuration missing** — required env vars are loaded and passed to the component; missing config does not cause panics at startup
- [ ] **Integration is tested end-to-end** — at minimum, an integration test exercises the wired code path from entry to execution

**Audit checkpoint**: Trace the call stack from `main()` → feature. If broken at any point, mark as incomplete.

### Criterion 3: Unit Test Coverage

- [ ] **Unit tests exist** — test file(s) created for the feature (e.g., `_test.go` companion files)
- [ ] **Tests pass locally** — `go test ./... -v` returns **zero failures, zero skips**
- [ ] **Tests cover the happy path** — at minimum one successful invocation with valid inputs
- [ ] **Tests cover error cases** — boundary conditions, invalid inputs, missing dependencies

**Audit checkpoint**: Run `go test ./... -v --count=1` (disable cache, run once) and capture output.

### Criterion 4: No Breaking Changes

- [ ] **Existing tests still pass** — no regression in other tests (run full test suite)
- [ ] **Existing code still builds** — `go build ./...` succeeds with no errors
- [ ] **No unresolved TODOs** — code comments don't reference missing implementation elsewhere

**Audit checkpoint**: Full test suite must pass before marking any task complete.

---

## Unit Test Requirements

### Test File Naming

- Backend unit tests: `app/backend/tests/unit/<module>/<feature>_test.go`
- Backend integration tests: `app/backend/tests/integration/<module>/<feature>_test.go`
- Internal-scope tests: `app/backend/internal/<module>/<feature>_test.go` (for non-exported types)

### Test Structure

Each test must follow this structure:

```go
func TestFeatureName(t *testing.T) {
    // Arrange: set up inputs, mocks, fixtures
    input := setupInput()
    expected := expectedResult()
    
    // Act: invoke the feature
    result, err := Feature(input)
    
    // Assert: verify result and error handling
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if result != expected {
        t.Errorf("got %v, want %v", result, expected)
    }
}

func TestFeatureErrorCase(t *testing.T) {
    // Similar structure for error paths
    input := badInput()
    _, err := Feature(input)
    if err == nil {
        t.Error("expected error, got nil")
    }
}
```

### Minimum Test Coverage per Task Type

| Task Type | Minimum Tests | Coverage |
|-----------|---|---|
| **API Handler** | 3+ | Happy path, 400 bad input, 401/403 auth error, 500 server error |
| **Database Operation** | 4+ | CRUD success, constraint violation, transaction rollback, missing record |
| **Connector/Client** | 4+ | Successful call, retry on timeout, invalid response, rate-limit handling |
| **Parser** | 3+ | Valid input, malformed input, unsupported format |
| **Middleware** | 2+ | Pass-through (allowed), rejection (denied) |
| **Utility/Helper** | 2+ | Normal case, edge case (empty, nil, boundary) |

### Test Execution Command

```bash
# Run all tests with verbose output and no cache
go test ./... -v --count=1 -race

# Run with coverage report
go test ./... -v --count=1 -race -coverprofile=coverage.out
go tool cover -html=coverage.out
```

**Completion criteria**: `go test ./... -v --count=1 -race` must return:
- ✅ **All tests PASS** (0 failures, 0 skips)
- ✅ **No race conditions detected** (`-race` flag passes)
- ❌ Tests must NOT be skipped (t.Skip() indicates incomplete implementation)

---

## Dual Audit Process

To ensure 100% accuracy and catch issues like stub code marked complete, every task completion requires **two independent audits**.

### Audit 1: Implementation Review (Author or First Reviewer)

**Purpose**: Verify the code exists and implements the spec, not just file existence.

**Checklist** (must pass all):

- [ ] **Path validation**: Code file exists at the path specified in the task description
- [ ] **Non-stub validation**: Search the file for stub patterns — flag if contains:
  - `panic("TODO")`
  - `return nil // TODO`
  - `// stub implementation`
  - Empty function body (only `{}`)
  - Any incomplete code comments
- [ ] **Style & linting**: Run `go fmt` and `go vet` on the file — must pass with no changes
- [ ] **Dependency check**: All imports are real packages (not stubbed); no circular imports

**Output**: Audit checklist document signed with reviewer name and date. If any item fails, mark task incomplete and file as blocker.

### Audit 2: Integration & Test Verification (Second Reviewer or QA)

**Purpose**: Verify the code is wired and tested, not isolated or untested.

**Checklist** (must pass all):

- [ ] **Reachability**: Trace the call path from entry point (`main.go` or top-level component) to the task's code
  - For API handlers: verify the route is registered in the router and reachable via HTTP
  - For database operations: verify the function is called by at least one handler or connector
  - For parsers: verify called by the ingestion pipeline
  - Document the call path in the audit
- [ ] **Test existence**: Find the `_test.go` file(s) for this task
  - Verify at least one test imports and exercises the feature
  - Verify test file is in the correct directory (app/backend/tests/unit/ or app/backend/tests/integration/)
- [ ] **Test pass**: Run the isolated test suite for this feature:
  ```bash
  go test ./<module>/... -v --count=1 -race
  ```
  Capture the output and verify:
  - ✅ All tests PASS (exit code 0)
  - ✅ No skipped tests
  - ✅ No race conditions
- [ ] **Regression check**: Run the full test suite to ensure no breaks:
  ```bash
  go test ./... -v --count=1 -race
  ```
  Verify all existing tests still pass (not just the new ones)

**Output**: Audit checklist document + test run output (captured via `tee` to a log file). File name pattern: `AUDIT_<TASK_ID>_<REVIEWER>_<DATE>.md`

---

## Marking Tasks Complete

### Before Marking Complete

1. **Verify both audits pass** — obtain sign-off from both Audit 1 and Audit 2 reviewers
2. **Attach audit documents** — link or embed the two audit checklists in the task record
3. **Capture test output** — save `go test ./... -v` output to `AUDIT_T###_tests.log` for traceability
4. **Update tasks.md** — change `- [ ]` to `- [X]` only when all 4 criteria + dual audit are done

### Mark Complete in tasks.md

```markdown
- [X] T042 Implement feature in app/backend/internal/feature/feature.go
  **Audits**:
  - ✅ Audit 1 (Implementation): Reviewer name, 2026-07-12, AUDIT_T042_reviewer1_20260712.md
  - ✅ Audit 2 (Integration): Reviewer name, 2026-07-12, AUDIT_T042_reviewer2_20260712.md
  - ✅ Tests: `go test ./app/backend/tests/unit/feature/... -v` PASS (3/3)
```

### Task Is Incomplete If

- [ ] Either audit fails (and must be re-audited after fixes)
- [ ] Unit tests do not pass
- [ ] Full test suite has regressions
- [ ] Code still has TODO/panic/stub patterns
- [ ] Code is not wired into the call graph

**Action**: If incomplete, file as a blocker and create a follow-up task to fix the issue.

---

## Tracking & Metrics

### Audit Document Template

Create a file for each audit: `AUDIT_<TASK_ID>_<PHASE>_<REVIEWER>_<DATE>.md`

```markdown
# Audit Report: Task T042

**Task**: T042 — Implement feature in app/backend/internal/feature/feature.go  
**Phase**: Audit 1 (Implementation Review)  
**Reviewer**: DungPham (or delegation name)  
**Date**: 2026-07-12  
**Status**: ✅ PASS / ❌ FAIL

## Checklist

- [X] Path validation: app/backend/internal/feature/feature.go exists
- [X] Non-stub validation: No panic/TODO/stub patterns found
- [X] Style & linting: go fmt & go vet pass
- [X] Dependency check: All imports real, no circular deps

## Findings

(Optional: note any observations, style issues, or commendations)

## Signature

Reviewer: ___________  
Date: 2026-07-12
```

### Metrics Dashboard (Track Weekly)

Maintain a summary in `AUDITS.md`:

```markdown
## Task Completion Metrics — Week of 2026-07-08

| Phase | Total Tasks | Completed (Audit 1) | Completed (Audit 2) | Test Pass Rate | Blockers |
|-------|---|---|---|---|---|
| Phase 1 | 9 | 9 (100%) | 9 (100%) | 9/9 (100%) | 0 |
| Phase 2 | 14 | 12 (86%) | 10 (71%) | 10/10 (100%) | 2 (T015, T018) |
| Phase 3 | 18 | 15 (83%) | 12 (67%) | 12/12 (100%) | 3 (T031, T034, T037) |
| **Total** | **41** | **36 (88%)** | **31 (76%)** | **31/31 (100%)** | **5** |

### Blockers (Fix in progress)
- **T015**: Database abstraction layer — connection pool not wired to cmd/main.go
- **T018**: Auth middleware — JWT validation logic incomplete (TODO in line 42)
```

### How to Use This Framework

1. **Before implementation**: Link this document in the task description
2. **During implementation**: Developer runs unit tests locally before pushing (`go test ./... -v`)
3. **After implementation**: 
   - Audit 1 reviewer validates implementation within 1 day
   - Audit 2 reviewer validates tests & integration within 1 day
   - If both pass: mark `[X]` and update AUDITS.md metrics
   - If either fails: create follow-up task
4. **Weekly**: Review AUDITS.md to spot patterns (e.g., "Tests always pass but Integration audits fail" → catch wiring issues early)

---

## FAQ

**Q: What if a task is "90% done" but tests fail?**  
A: Mark incomplete. The 10% is the unit test; shipping untested code is the root cause of prior issues.

**Q: Can one person do both audits?**  
A: Not ideal. If necessary, do Audit 1 on day 1, step away, then do Audit 2 on day 2 to reduce bias. Rationale: catching stub code requires different focus than wiring; fresh eyes catch both.

**Q: How do we handle tasks that are hard to test?**  
A: No task is untestable. At minimum: mock the external dependency, test the decision logic, and document why full integration test isn't needed. Audit 2 must still pass.

**Q: What if the test suite is slow?**  
A: Use `go test ./... -short` for quick unit tests, `go test -run "Integration"` for integration tests separately. Slow tests are still valid; just make the distinction clear.

---

## Related Documents

- [`tasks.md`](./tasks.md) — Task breakdown and assignments
- [`plan.md`](./plan.md) — Implementation phases and dependencies
- [`AUDITS.md`](./AUDITS.md) — Weekly completion metrics (to be created)
