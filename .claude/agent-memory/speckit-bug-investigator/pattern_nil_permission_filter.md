---
name: pattern-nil-permission-filter
description: Recurring misdiagnosis pattern — nil vs []int{} from PermissionFilter.Filter() in m365-knowledge-graph
metadata:
  type: pattern
---

`PermissionFilter.Filter()` (`app/backend/internal/retrieval/permission_filter.go`) returns bare
Go `nil` (not `[]int{}`) whenever a user has **zero** `permission_cache` rows, purely because of
`var fileIDs []int` zero-value semantics — not because "don't filter" was intended. Per spec.md
§10 / api.md §103 / INVARIANT-1, zero permissions must mean **zero access** (fail-closed).

Separately, `ListNodes`/`ListEdges`/`ListEntities` in `app/backend/internal/graph/neo4j_query.go`
have a **low-level** contract where bare `nil` disables the permission WHERE clause (unscoped,
"see everything") and a non-nil empty slice means "deny all." This is a dangerous default if
called directly with `Filter()`'s raw output.

Every handler that calls `Filter()` (`HandleGraphNodes`, `HandleGraphEdges` in
`handlers_graph.go`, `HandleGraphEntities` in `handlers_knowledge.go`) is expected to bridge this
gap with:
```go
if allowedFileIDs == nil {
    allowedFileIDs = []int{}
}
```
This is the intentional, spec-mandated fail-closed translation — not a bug. A regression test
(`TestPermissionEnforcement_NoOutOfScopeContent` / "Retriever denies users with zero
permission_cache rows" in `app/backend/tests/integration/retrieval/permissions_test.go`) already
guards this.

**Why this recurs:** the phrase "nil disables scoping" in `neo4j_query.go`'s doc comments
describes the query layer's raw behavior, and reads (out of context) like it should be the
intended top-level behavior too. Someone reading only the query layer comment, without checking
`PermissionFilter.Filter()`'s doc comment or the sibling handler, will conclude the opposite of
the correct fix (BUG-001, 2026-07-17).

**How to apply:** Any future bug report claiming "the nil→[]int{} conversion in a graph/entities
handler breaks permission filtering" should be checked against this pattern before trusting the
report's framing — check `permission_filter.go`'s doc comment, api.md §103, and whether the
sibling handlers (`handlers_knowledge.go`) use the same conversion, before concluding it's a
defect. See [[project-bug-001-graph-permission-investigation]].
