# Change Log

## Unreleased

| Date | ID | Type | Summary | Impact |
|---|---:|---|---|---|
| 2026-07-17 | BUG-001 | Investigation | Permission filtering nil→[]int{} report in handlers_graph.go — Closed: Not a Bug. Fail-closed conversion is spec-mandated (spec.md §10, api.md §103, INVARIANT-1) and matches sibling HandleGraphEntities handler; actual test failure traced to a missing permission_cache test fixture, already fixed in the TS integration test. Flagged: uncommitted working-tree edit removes the conversion and would reintroduce a permission bypass if committed as-is. | Low |
