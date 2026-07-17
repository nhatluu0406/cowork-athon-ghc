# Investigation Report — BUG-001: Alleged "permission filtering logic bug" in handlers_graph.go (nil → []int{} conversion)

Generated: 2026-07-17
ID: BUG-001
Status: CLOSED — NOT A BUG

## Bug Report (as submitted)
Location: `app/backend/internal/api/handlers_graph.go`

Claim: A "recent change" at lines 35-40 (`HandleGraphNodes`) and 80-85 (`HandleGraphEdges`)
converts a `nil` result from `PermissionFilter.Filter()` into an explicit `[]int{}`. The report
claims this is wrong because "`nil` means don't filter by permissions," and that the conversion
causes `ListNodes`/`ListEdges` to treat the user as having zero permissions, producing empty
results even when the user has valid permissions. Proposed fix: delete the two `if allowedFileIDs
== nil { allowedFileIDs = []int{} }` blocks. Cited symptom: a test failing with "expected the real
graph to return at least one node."

## Expected Behavior (per report)
`nil` from `PermissionFilter.Filter()` should disable permission scoping entirely, so
`ListNodes`/`ListEdges` return unscoped results for a user with no permission_cache entries.

## Actual Behavior (per report)
The nil-to-`[]int{}` conversion causes `ListNodes`/`ListEdges` to return zero results because
`[]int{}` is interpreted by the query layer as "user has zero permissions."

## Reproduction Conditions
- A user with zero rows in `permission_cache` for a given file.
- Call `GET /api/graph/nodes` or `GET /api/graph/edges`.
- Cited failure: a system/integration test asserting `"expected the real graph to return at
  least one node"` in `service/tests/knowledge/m365kg-integration.test.ts`.

## Constitutional Context
`.specify/memory/constitution.md` exists (INVARIANT-1: "正確性 > パフォーマンス" — correctness over
performance; fail-closed/deterministic behavior is required, exceptions require an explicit,
approved exception process). No constitution-creation prompt was needed.

---

## Evidence Collection

Evidence:
- File: `app/backend/internal/api/handlers_graph.go`
- Function: `HandleGraphNodes`, `HandleGraphEdges`
- Lines: 30-42 (Nodes), 73-89 (Edges) at `HEAD` (commit `18b2377`)
- Observation: `git show HEAD:app/backend/internal/api/handlers_graph.go` confirms **both**
  handlers currently contain the `if allowedFileIDs == nil { allowedFileIDs = []int{} }` block at
  the committed `HEAD`.
- Observation (critical): the **working tree on disk right now is not what `HEAD` contains**.
  `git diff` / `cat -n` show that **both** blocks have already been removed, uncommitted
  (`git status --short` reports `M app/backend/internal/api/handlers_graph.go`). In other words,
  someone has already applied the exact fix the bug report proposes, but has not committed it.
  md5 of `HEAD` blob vs. working-tree file differ, confirming a real, live, uncommitted edit.
- Impact: The bug report's "current state" claim is only true of `HEAD`; the live file already
  has the change applied. Any conclusion must account for both states.

Evidence:
- File: `app/backend/internal/api/handlers_graph.go` — git history
- Lines: n/a (whole-function diffs)
- Observation: `git log -p` across `6243547` → `aa74a0c` → `e3bd02f` → `18b2377` shows the nil-check
  block being added and removed repeatedly across commits (introduced at file creation for
  `HandleGraphNodes` only, removed, re-added, then also added to `HandleGraphEdges` in the most
  recent commit "add miss file after rebase main"). This is a flapping pattern consistent with a
  rebase reintroducing previously-fixed/previously-reverted code, not a deliberate one-way defect
  injection.
- Impact: Explains why the bug report and the current working tree disagree — the "bug" the
  report describes was briefly reintroduced by a rebase, then someone (uncommitted) removed it
  again locally, apparently without realizing why it existed in the first place.

Evidence:
- File: `app/backend/internal/retrieval/permission_filter.go`
- Function: `PermissionFilter.Filter`
- Lines: 20-23 (doc comment), 41-70 (implementation)
- Observation: Doc comment states, quoting spec.md §10 and contract.md/api.md §103: *"Every read
  endpoint is implicitly scoped by the caller's permission_cache entries. An empty permission set
  means the user has no access to any documents, which is returned as an empty result set (not an
  error)."* The implementation declares `var fileIDs []int` and only appends when
  `rows.Next()` yields a row. **If the user has zero `permission_cache` rows, the function returns
  `nil, nil`** — not an explicit empty slice — purely as an artifact of Go's zero-value slice
  semantics, not a deliberate signal that scoping should be disabled.
- Impact: `nil` from `Filter()` is the specific, spec-mandated representation of "user has **zero**
  permissions," not "don't apply permission filtering" as the bug report assumes.

Evidence:
- File: `app/backend/internal/graph/neo4j_query.go`
- Function: `ListNodes` (line ~201), `ListEdges` (line ~272)
- Lines: doc comments above each function; `if allowedFileIDs != nil && len(allowedFileIDs) == 0`
  checks; `if allowedFileIDs != nil { ...WHERE clause... }` blocks.
- Observation: Both functions treat a **non-nil, empty** slice as "deny all" (short-circuit to
  `[]map[string]interface{}{}, nil`) and treat **`nil`** as "disable the WHERE clause; return all
  nodes/edges unscoped." This is the low-level, documented contract of the query layer itself.
- Impact: Because `Filter()` naturally returns bare `nil` for a zero-permission user (see above),
  calling `ListNodes`/`ListEdges` directly with that raw `nil` — i.e., removing the handler-level
  conversion — causes a user with **zero** permissions to see **all** nodes/edges, unscoped. This
  is the opposite of "fail closed" and directly contradicts spec.md §10 / api.md §103 / INVARIANT-1.

Evidence:
- File: `app/backend/internal/api/handlers_knowledge.go`
- Function: `HandleGraphEntities` (the `/api/entities` handler — a sibling of the disputed
  `/api/graph/nodes` and `/api/graph/edges` handlers)
- Lines: 92-104
- Observation: This currently-committed, undisputed handler applies the **exact same**
  `if allowedFileIDs == nil { allowedFileIDs = []int{} }` conversion, with **verbatim-identical**
  comment text ("nil slice from Filter means 'zero rows' (not 'scoping disabled') — treat as an
  explicit empty allow-list so ListEntities returns [] rather than unscoped results").
- Impact: This proves the conversion is a deliberate, established, codebase-wide idiom for
  INVARIANT-1 enforcement across all `/api/*` read endpoints — not a one-off "recent change" or
  mistake isolated to `handlers_graph.go`.

Evidence:
- File: `app/backend/tests/integration/retrieval/permissions_test.go`
- Function: `TestPermissionEnforcement_NoOutOfScopeContent`, subtest `"Retriever denies users with
  zero permission_cache rows"`
- Lines: 109-133
- Observation: This existing, committed regression test explicitly asserts that a user with
  **zero** `permission_cache` rows must receive `intent == "permission_denied"` and **zero**
  sources — i.e., fail-closed, deny-by-default. The test's own doc comment (lines 15-21) states it
  was written specifically because of a prior bug where "permission filtering was gating on 'any
  access' instead of restricting each result" — i.e., a prior *fail-open* bug.
- Impact: A committed test already guards against exactly the failure mode that removing the
  nil-conversion in `handlers_graph.go` would reintroduce (fail-open for zero-permission users).

Evidence:
- File: `specs/REQ-204-M365-001-m365-knowledge-graph/contracts/api.md`
- Lines: 52-53, 103
- Observation: "Every read endpoint (`/api/knowledge/query`, `/api/entities*`, `/api/graph/*`) is
  implicitly scoped by the caller's `permission_cache` entries. This is enforced at the
  retrieval/query layer (Stage 0), never as an HTTP-layer post-filter — per INVARIANT-1
  (correctness > performance) and spec.md §10." `/api/graph/*` is explicitly named.
- Impact: The API contract explicitly requires fail-closed permission scoping for the exact two
  endpoints (`/api/graph/nodes`, `/api/graph/edges`) the bug report targets.

Evidence:
- File: `service/tests/knowledge/m365kg-integration.test.ts`
- Lines: 118-165 (uncommitted diff)
- Observation: This is the test whose failure ("expected the real graph to return at least one
  node") is cited as the symptom. The **uncommitted** diff on this file shows it was already fixed
  — not by touching the Go handlers, but by seeding a real `m365_files` row and a real
  `permission_cache` grant for `DEV_USERNAME` before creating the Neo4j fixture nodes, and
  stamping `source_file_id` onto those fixture nodes. The test's own new comment states: *"Permission
  scoping is fail-closed (INVARIANT-1, handlers_graph.go): a node is only visible to a user if its
  source_file_id is in that user's permission_cache... otherwise the (correct) deny-all-by-default
  behavior hides this test's own fixture, independent of whether Neo4j has the data."*
- Impact: The person who diagnosed and fixed the actual test failure explicitly concluded the
  deny-by-default behavior is **correct**, and fixed the test's fixture setup instead of the
  handler. This directly contradicts the bug report's root-cause claim and independently confirms
  this investigation's finding.

---

## Root Cause Analysis

### Hypothesis 1: The nil→[]int{} conversion is a defect that breaks permission filtering (as claimed in the report)

**Description:** A recent change misinterprets `nil` and incorrectly zeroes out valid permissions.

**Supporting Evidence:**
- None found that withstands cross-checking. The report's narrative ("nil means don't filter" is
  correct) is contradicted by every other source examined.

**Contradicting Evidence:**
- `PermissionFilter.Filter()` doc comment + spec.md §10 + api.md §103: `nil` is the natural
  representation of "zero permission_cache rows," which per spec **must** mean "no access,"
  not "unscoped."
- `HandleGraphEntities` (sibling handler, currently committed, undisputed) uses the identical
  conversion with identical comment text — an established codebase pattern, not a one-off change.
- `TestPermissionEnforcement_NoOutOfScopeContent` regression test explicitly requires deny-all
  for zero-permission users.
- The actual test failure cited was already fixed by seeding real permissions in the TS test
  fixture (not by touching the Go handler), and that fix's own comments affirm deny-by-default is
  the correct, intended behavior.

**Confidence:** Low (eliminated)

### Hypothesis 2: The reported test failure was caused by a missing test fixture (no permission_cache grant for the test user), and the nil→[]int{} conversion in the handlers is correct, spec-mandated, fail-closed behavior

**Description:** `ListNodes`/`ListEdges`/`ListEntities` in `neo4j_query.go` have a low-level
contract where bare `nil` disables the permission WHERE clause entirely (a dangerous default if
called directly). The handler layer is responsible for translating `Filter()`'s `nil` (which means
"zero permissions" per spec) into the query layer's "deny all" signal (`[]int{}`). This is exactly
what `HandleGraphNodes`/`HandleGraphEdges`/`HandleGraphEntities` do. The integration test failed
not because of this conversion, but because its test user had no `permission_cache` row for the
newly created fixture data — under correct fail-closed behavior, that legitimately produces zero
visible nodes.

**Supporting Evidence:**
- All six evidence items above.

**Contradicting Evidence:**
- None found.

**Confidence:** High

### Selected Root Cause
Hypothesis 2. The reported "bug" describes intended, spec-mandated, and already-tested fail-closed
permission behavior. The actual defect that produced the cited test failure was a missing
`permission_cache` fixture row in the integration test, which has already been fixed (uncommitted)
in `service/tests/knowledge/m365kg-integration.test.ts` by seeding a real grant — a fix that does
not touch `handlers_graph.go` and is consistent with keeping the nil-conversion in place.

---

## Classification
NOT A BUG — EXPECTED BEHAVIOR + USER MISUNDERSTANDING (dual)

- **EXPECTED BEHAVIOR**: `handlers_graph.go`'s nil→`[]int{}` conversion is the documented,
  spec-mandated (spec.md §10, api.md §103, INVARIANT-1), codebase-consistent (matches
  `handlers_knowledge.go`) fail-closed permission enforcement. It is working as designed.
- **USER MISUNDERSTANDING**: The report's mental model — "`nil` means don't filter, and the
  conversion breaks that" — inverts the actual, documented semantics of `PermissionFilter.Filter()`
  and the query layer's contract.

## Finding
The code at `HEAD` is correct. The two `if allowedFileIDs == nil { allowedFileIDs = []int{} }`
blocks in `HandleGraphNodes` and `HandleGraphEdges` are required to prevent a user who has zero
`permission_cache` rows from seeing **every** node/edge in the graph unscoped (a fail-open
permission bypass). Removing them — which is both what the bug report proposes and what the
current **uncommitted** working tree has already done — reopens that bypass.

The test failure that motivated the report ("expected the real graph to return at least one
node") was actually caused by the test's own fixture not granting the test user any
`permission_cache` entry for the data it created. That has already been fixed correctly
(uncommitted) in `service/tests/knowledge/m365kg-integration.test.ts` by seeding a real
`m365_files` + `permission_cache` row and stamping `source_file_id` onto the Neo4j fixture nodes.

## Evidence Summary
- `PermissionFilter.Filter()` returns bare `nil` specifically when a user has **zero**
  `permission_cache` rows (Go zero-value slice semantics), which spec.md §10 defines as "no access
  to any documents."
- `ListNodes`/`ListEdges` treat `nil` as "disable scoping" (return everything) and non-nil-empty as
  "deny all" — a low-level query-layer contract that callers must bridge correctly.
- The sibling, currently-committed `HandleGraphEntities` handler in `handlers_knowledge.go` applies
  the identical conversion with identical comment text, proving this is an intentional,
  codebase-wide pattern, not an isolated "recent change."
- A committed regression test (`TestPermissionEnforcement_NoOutOfScopeContent`) explicitly requires
  deny-all for zero-permission users — the exact behavior the bug report's proposed fix would break.
- api.md §103 explicitly names `/api/graph/*` as subject to this fail-closed enforcement.
- The actual root cause of the cited test failure (missing `permission_cache` fixture row) has
  already been fixed, uncommitted, in the TS integration test — and that fix's own comments affirm
  deny-by-default as correct.

## IMPORTANT — Action Required on the Current Working Tree
`git status --short` shows `app/backend/internal/api/handlers_graph.go` as modified but
**uncommitted**. That uncommitted change has **already removed** the nil-conversion in both
`HandleGraphNodes` and `HandleGraphEdges` — i.e., the exact (incorrect) fix this bug report
requested has already been applied to the file on disk, right now, and is one `git commit` away
from shipping a permission bypass.

**Recommendation:** Do not commit `app/backend/internal/api/handlers_graph.go` in its current
state. Restore the two removed blocks (matching the pattern still present and correct in
`handlers_knowledge.go`'s `HandleGraphEntities`) before committing:

```go
if allowedFileIDs == nil {
    allowedFileIDs = []int{}
}
```

placed after the `permFilter.Filter(...)` call and its error check, in both `HandleGraphNodes` and
`HandleGraphEdges`, exactly as it exists at `HEAD` (commit `18b2377`). The uncommitted change to
`service/tests/knowledge/m365kg-integration.test.ts` (seeding a real `permission_cache` grant for
the test fixture) should be kept — it is the correct fix and is independent of the handler code.

This is not filed as a separate BUG-XXX because no code has been committed yet — it is flagged here
as an action item for the developer to resolve before their next commit. If the working-tree change
is committed before this is addressed, request a new investigation immediately, as it would then be
a live, committed security regression (permission bypass on `/api/graph/nodes` and
`/api/graph/edges` for any user with zero `permission_cache` rows).

## Recommendation
1. Do not remove the nil→`[]int{}` conversion in `HandleGraphNodes`/`HandleGraphEdges`. Revert the
   uncommitted removal before committing.
2. Keep the uncommitted fix to `service/tests/knowledge/m365kg-integration.test.ts` (seeds a real
   `permission_cache` grant for the test fixture) — this is the actual, correct fix for the cited
   test failure.
3. No spec or documentation update is needed; existing docs (spec.md §10, api.md §103,
   `permission_filter.go` doc comments) already correctly describe the intended behavior. Consider
   adding a short inline note in `neo4j_query.go` cross-referencing `handlers_graph.go`/
   `handlers_knowledge.go` so future readers do not re-derive the same incorrect hypothesis this
   report did — the "nil disables scoping" phrase invites exactly this misreading, even though
   every caller is expected to translate a spec-`nil` (zero permissions) into an explicit `[]int{}`
   before calling in.
