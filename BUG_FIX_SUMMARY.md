# Bug Fix: T3.2 Integration Test - Empty Citations Array

## Issue
Test `T3.2: real query -> real Neo4j-seeded citation appears` fails with:
```
error: 'expected a real citation for systest-1784216477857-ProjectX, got []'
```

The `outcome.citations` array is empty when it should contain the Neo4j-seeded Project entity.

## Root Cause
In `app/backend/internal/retrieval/retriever.go`, lines 76-78 had an **early return** that contradicted the design intent documented in the code comment (lines 69-74):

```go
// NOTE: comment says "we do NOT early-exit on empty allowedFiles here"
if len(allowedFiles) == 0 {
    return &QueryResponse{Answer: "No access to documents", Intent: "permission_denied"}, nil
}
```

**The problem:** When a user has no document permissions (empty `allowedFiles`), the entire retrieval pipeline returns early with a "No access" message, never running **Stage 2 (Entity Recognition)** which finds Neo4j entities.

**Why the test fails:**
- Test user "system-test" logs in successfully
- No M365 documents are synced (permission_cache is empty for this user)
- Query comes in: "Who leads systest-1784216477857-ProjectX?"
- Early return executes → Stage 2 entity recognition never runs
- `recognizedEntities` stays empty
- Response has `citations: []` instead of `[{type: "Project", name: "...ProjectX"}]`

## Solution
**Removed the early return** (lines 76-78). The code now matches its own design:
- Stage 0 (permission filter) runs and returns empty `allowedFiles`
- **Does NOT early-exit**
- Stage 1 (intent detection) runs
- **Stage 2 (entity recognition) runs** and finds the Neo4j entities
- Stage 3+4 (graph expansion & semantic search) run in parallel
  - Semantic search returns empty (no documents to search)
  - Graph expansion finds related entities
- Results are merged, reranked, packed, and answer is generated
- **Entities are returned** in the response

## Files Changed

### 1. `/app/backend/internal/retrieval/retriever.go`
**Lines 69-75**: Removed the early return when `allowedFiles` is empty.

**Before:**
```go
// Note: we do NOT early-exit on empty allowedFiles here...
if len(allowedFiles) == 0 {
    return &QueryResponse{...}, nil
}
```

**After:**
```go
// Note: we do NOT early-exit on empty allowedFiles here...
// (allowedFiles may be nil or empty; proceed to entity recognition and graph expansion.)
```

**Lines 81-88**: Added error logging comment for entity recognition failures (improves debuggability).

### 2. `/app/backend/tests/unit/retrieval/retriever_entity_recognition_test.go` (NEW)
Added unit test `TestRetrieverReturnsEntitiesWithoutDocumentAccess` to verify that entity recognition runs and returns results even when a user has zero document permissions.

## Impact
✅ T3.2 integration test now passes  
✅ Entity recognition works for graph-only queries (no documents)  
✅ Permission scoping is still enforced at semantic search stage  
✅ Follows the design intent documented in the code  

## Testing
- Run full integration test: `M365KG_INTEGRATION_TESTS=1 npm test`
- Run specific test: `npm test -- --grep "T3.2"`
- Unit test regression: `npm test app/backend/tests/unit/retrieval/`
