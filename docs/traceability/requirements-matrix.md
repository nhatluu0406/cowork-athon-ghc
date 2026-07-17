# Requirements Traceability Matrix

> **Document No.**: RAD-TRACE-001 | **Last Updated**: 2026-07-17

## Requirements → Design Mapping

| ID | Summary | Spec | Plan | Status |
|---|---|---|---|---|

## Requirements → Implementation Mapping

| ID | Summary | Tasks | Branch | Status |
|---|---|---|---|---|

## Requirements → Test Mapping

| ID | Summary | Acceptance Criteria | Test Coverage | Status |
|---|---|---|---|---|
| BUG-001 | Alleged permission filtering nil→[]int{} bug in handlers_graph.go | N/A — closed as not a bug; existing regression test `TestPermissionEnforcement_NoOutOfScopeContent` already covers the correct fail-closed behavior | app/backend/tests/integration/retrieval/permissions_test.go | Closed — Not a Bug |

## Defect Tracking (BUG)

| ID | Summary | Root Cause | Fix Spec | Status |
|---|---|---|---|---|
| BUG-001 | Report claimed nil→[]int{} conversion in HandleGraphNodes/HandleGraphEdges breaks permission filtering | Not a defect: nil from PermissionFilter.Filter() means "zero permission_cache rows" per spec.md §10; the conversion to []int{} is the required fail-closed translation (INVARIANT-1), matching the sibling HandleGraphEntities handler. The actual test failure was caused by a missing permission_cache fixture row, already fixed (uncommitted) in the TS integration test. | specs/BUG-001/investigation.md | Closed — Not a Bug (EXPECTED BEHAVIOR + USER MISUNDERSTANDING) |

## Change Summary

### 2026-07-17
- Added BUG-001: Alleged permission filtering nil→[]int{} bug in handlers_graph.go (Investigation — Closed: Not a Bug). Flagged an uncommitted working-tree change that, if committed as-is, would reintroduce a permission bypass — see investigation.md "Action Required on the Current Working Tree".
