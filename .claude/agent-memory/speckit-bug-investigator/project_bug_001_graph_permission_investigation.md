---
name: project-bug-001-graph-permission-investigation
description: BUG-001 outcome — permission filter nil report closed Not a Bug; live uncommitted risk flagged
metadata:
  type: project
---

BUG-001 (2026-07-17) investigated a report claiming `handlers_graph.go`'s nil→`[]int{}`
conversion in `HandleGraphNodes`/`HandleGraphEdges` broke permission filtering. Closed as NOT A
BUG (EXPECTED BEHAVIOR + USER MISUNDERSTANDING) — see [[pattern-nil-permission-filter]] for the
underlying semantics, and `specs/BUG-001/investigation.md` for full evidence.

**Why this matters going forward:** at investigation time, `git status` showed
`app/backend/internal/api/handlers_graph.go` as modified-but-uncommitted, and the uncommitted
diff had *already applied* the incorrect fix the report requested (removed the conversion from
both handlers). The uncommitted diff on `service/tests/knowledge/m365kg-integration.test.ts` was,
separately, the *actually correct* fix (seeds a real `permission_cache` grant for the test
fixture) and should be kept.

**How to apply:** If a future session finds `handlers_graph.go` committed without the
nil-conversion blocks (i.e., the working-tree change from 2026-07-17 got committed as-is), treat
that as a live security regression (permission bypass — any zero-permission user sees all
graph nodes/edges), not as "already resolved." Check current `HEAD` state again — do not assume
this memory reflects the present committed state; it only reflects the state as of 2026-07-17.
