# Audit Report Template

**Copy this file for each completed task and fill in the details.**

---

# Audit Report: Task T###

**Task ID**: T###  
**Task Description**: [Copy from tasks.md]  
**Implementation Path**: backend/internal/module/feature.go (or applicable path)  
**Phase**: [Phase 1/2/3/etc. from tasks.md]

---

## Audit 1: Implementation Review

**Reviewer Name**: ________________  
**Date**: YYYY-MM-DD  
**Status**: ⬜ PASS / ⬜ FAIL

### Checklist

#### Path Validation
- [ ] File exists at the path specified in task description
- [ ] File is in the correct directory structure (backend/internal/module/ or backend/pkg/)
- [ ] No other implementation stub files in unexpected locations

**Path verified**: `git ls-files | grep -E "<path>"` shows:
```
[PASTE COMMAND OUTPUT]
```

#### Non-Stub Code Validation

Search the implementation file for stub patterns. **All of the following must be FALSE**:

- [ ] Contains `panic("TODO")` or `panic("not implemented")`
- [ ] Contains `return nil // TODO` or `return nil, nil`
- [ ] Contains `// stub implementation` or `// placeholder`
- [ ] Function body is empty `{ }`
- [ ] Contains only `log.Println` or similar debug stubs
- [ ] Contains `skip` or `return` at the start of a function

**Verification command**:
```bash
grep -nE "panic\(.*TODO|return nil.*TODO|stub implementation|// placeholder" backend/internal/module/feature.go
```

**Output** (paste result; if empty, no stubs found ✅):
```
[PASTE GREP OUTPUT — should be empty]
```

#### Style & Linting

- [ ] `go fmt` produces no changes (file is canonical)
- [ ] `go vet ./...` passes with no warnings
- [ ] No unused imports
- [ ] No unused variables

**Verification commands**:
```bash
cd backend
go fmt ./internal/module/
go vet ./internal/module/...
go mod tidy
```

**Output** (paste results; should show no errors):
```
[PASTE VET/FMT OUTPUT]
```

#### Code Review (Manual)

- [ ] Code follows project naming conventions (functions are CamelCase, exported; unexported are camelCase)
- [ ] Error handling is explicit (not silent drops)
- [ ] Logging is consistent with `internal/common/logger.go` usage
- [ ] No hardcoded values (magic numbers, credentials, URLs)
- [ ] Database queries use parameterized statements (`$1, $2, ...` — never string interpolation)

**Review notes**:
```
[OPTIONAL: Note any style observations, commendations, or concerns]
```

---

## Audit 2: Integration & Test Verification

**Reviewer Name**: ________________  
**Date**: YYYY-MM-DD  
**Status**: ⬜ PASS / ⬜ FAIL

### Checklist

#### Reachability from Entry Point

The code must be reachable from the app's entry point. Trace the call path:

- **For API Handlers**: Code is called by a registered HTTP route
  - [ ] Route registered in `backend/internal/api/router.go`
  - [ ] Handler function signature is `func(w http.ResponseWriter, r *http.Request) error`
  - [ ] Router call path: `main()` → `router.Setup()` → handler
  
  **Verification**: Search router.go for the route:
  ```bash
  grep -n "POST /api/module\|GET /api/module" backend/internal/api/router.go
  ```
  
  **Output** (paste matching line):
  ```
  [PASTE GREP OUTPUT]
  ```

- **For Database/Core Logic**: Code is called by at least one API handler or background job
  - [ ] Function is imported and called by at least one handler
  - [ ] Call stack documented: `handler()` → `feature.Do()` → implementation
  
  **Verification**: Search for function name in handlers:
  ```bash
  grep -r "feature.Do\|feature.Create" backend/internal/api/
  ```
  
  **Output** (paste matching lines):
  ```
  [PASTE GREP OUTPUT]
  ```

- **For Middleware/Utilities**: Code is imported and executed
  - [ ] Middleware registered in router setup
  - [ ] Utility function called from at least one other function
  
  **Verification**:
  ```bash
  grep -r "module.Middleware\|package.Function" backend/
  ```
  
  **Output** (paste matching lines):
  ```
  [PASTE GREP OUTPUT]
  ```

#### Test Existence

- [ ] Test file(s) exist: `backend/tests/unit/module/feature_test.go` or `backend/internal/module/feature_test.go`
- [ ] Test file is committed and trackable: `git log --oneline backend/tests/unit/module/feature_test.go | head -1`
- [ ] Tests import the package under test
- [ ] At least 2 test functions exist (happy path + error case)

**Verification**:
```bash
ls -la backend/tests/unit/module/feature_test.go
grep -c "^func Test" backend/tests/unit/module/feature_test.go
```

**Output** (paste results):
```
[PASTE LS AND GREP OUTPUT]
```

#### Unit Test Execution

Run the test suite for this feature and capture output:

**Command**:
```bash
cd backend
go test ./tests/unit/module/... -v --count=1 -race -run Feature
```

**Paste full output** (including test names, pass/fail, elapsed time):
```
[PASTE TEST OUTPUT — MUST SHOW "ok" AND "PASS"]
```

**Parse results**:
- [ ] Exit code is 0 (success)
- [ ] All test functions PASS (not FAIL, not SKIP)
- [ ] No race conditions detected
- [ ] Count matches expected test count (e.g., 3 tests, 3 passing)

**Example passing output**:
```
=== RUN   TestFeatureCreate
=== RUN   TestFeatureCreate/ValidInput
--- PASS: TestFeatureCreate (0.00s)
=== RUN   TestFeatureCreateError
--- PASS: TestFeatureCreateError (0.01s)
=== RUN   TestFeatureDelete
--- PASS: TestFeatureDelete (0.00s)
ok      github.com/rad-system/m365-knowledge-graph/backend/tests/unit/module  0.456s
```

#### Regression Check

Run the full test suite to ensure no existing tests broke:

**Command**:
```bash
cd backend
go test ./... -v --count=1 -race --timeout=10m
```

**Paste output** (summary line):
```
[PASTE FINAL LINE LIKE "ok  	github.com/...	12.345s"]
```

**Verify**:
- [ ] Exit code is 0
- [ ] Total pass count = previous baseline (or increase if new tests added)
- [ ] Zero FAIL results
- [ ] Zero race condition reports

**If regression detected**, list failing test(s):
```
[PASTE FAILING TEST NAMES — should be empty]
```

---

## Summary

### Audit 1 Result: ⬜ PASS / ⬜ FAIL

**Issues found** (if any):
```
[LIST BLOCKERS: e.g., "T042_01: function CreateUser() is empty stub"]
```

**Signature**:
```
Reviewer: ___________________
Date: _______________
Time: _______________ (estimated hours spent)
```

---

### Audit 2 Result: ⬜ PASS / ⬜ FAIL

**Issues found** (if any):
```
[LIST BLOCKERS: e.g., "T042_02: CreateUser handler not registered in router.go"]
```

**Test Results Summary**:
- Feature unit tests: X passed, 0 failed
- Full regression suite: Y passed, 0 failed
- Race conditions: 0 detected
- Skipped tests: 0 (all tests run)

**Signature**:
```
Reviewer: ___________________
Date: _______________
Time: _______________ (estimated hours spent)
```

---

## Disposition

**Both Audits Pass?** ⬜ YES → Mark `[X]` in tasks.md / ⬜ NO → File blocker, create follow-up task

**Follow-up Task (if failed)**:
- [ ] Create task: "T042_FIX — [Audit 1 blocker] [description]"
- [ ] Create task: "T042_FIX — [Audit 2 blocker] [description]"
- [ ] Link back to parent task T042
- [ ] Set as blocker in task dependencies

**Completion Timestamp**: ________________
