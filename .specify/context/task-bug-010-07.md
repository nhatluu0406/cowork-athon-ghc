<!-- task=TASK-BUG-010-07 tokens~12090 -->


---
## TASK

# Task: TASK-BUG-010-07
**✅ COMPLETE**


---
## ACCEPTANCE CRITERIA

- [ ] API documentation includes `POST /api/products` endpoint

---
## CODE SCOPE

<!-- 3 files -->

### docs/api/products-api.md
```
# Products API

**Base path:** `/api/products`  
**Auth:** Bearer JWT required on all endpoints

---

## Product Endpoints

### GET /api/products

List all products.

**Query params:** `status` (filter), `limit` (default 50), `offset` (default 0)

**Response 200:**
```json
[
  {
    "id": 1,
    "name": "My Product",
    "slug": "my-product",
    "description": "...",
    "status": "active",
    "tags": [],
    "repo_count": 2,
    "created_at": "2026-06-16T00:00:00Z",
    "updated_at": "2026-06-16T00:00:00Z"
  }
]
```

---

### POST /api/products

Create a product.

**Request body:**
```json
{
  "name": "My Product",
  "slug": "my-product",
  "description": "optional",
  "tags": ["optional"]
}
```

**Response 201:** Product object  
**Response 409:** `SLUG_EXISTS` — slug already taken

---

### GET /api/products/{id}

Get product by ID.

**Response 200:** Product object  
**Response 404:** `NOT_FOUND`

---

### PUT /api/products/{id}

Update product fields (all fields optional).

**Request body:**
```json
{
  "name": "New Name",
  "slug": "new-slug",
  "description": "...",
  "status": "active|archived|maintenance",
  "tags": ["tag1"]
}
```

**Response 200:** Updated product object

---

### DELETE /api/products/{id}

Archive a product (soft delete, sets status to `archived`).

**Response 204:** No content

---

## Repository Association Endpoints

### GET /api/products/{id}/repos

List repositories in a product.

**Response 200:**
```json
[
  {
    "repo_id": 1,
    "product_id": 1,
    "path": "/path/to/repo",
    "display_name": "My Repo",
    "role": "service",
    "search_weight": 1.0,
    "active_epoch": 5,
    "last_indexed_at": "2026-06-16T00:00:00Z",
    "index_status": "current"
  }
]
```

---

### POST /api/products/{id}/repos

Add a repository to a product.

**Request body:**
```json
{
  "path": "/path/to/repo",
  "display_name": "optional",
  "role": "optional — defaults to \"service\"",
  "search_weight": 0
}
```

**Field defaults (applied server-side when omitted or zero):**

| Field | Default | Notes |
|-------|---------|-------|
| `role` | `"service"` | Applied when field is omitted or `""` |
| `search_weight` | `1.0` | Applied when field is omitted or `0` |

**Valid role values:** `backend`, `frontend`, `infra`, `library`, `docs`, `other`, `service` (legacy), `integration` (legacy)

**Example — minimal request (only `path` required):**
```bash
curl -X POST http://localhost:8080/api/products/1/repos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"path": "/home/user/myrepo"}'
# Response: role="service", search_weight=1.0
```

**Example — explicit values:**
```bash
curl -X POST http://localhost:8080/api/products/1/repos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"path": "/home/user/myrepo", "role": "backend", "search_weight": 2.5}'
# Response: role="backend", search_weight=2.5
```

**Response 201:** RepoAssociation object  
**Response 400:** `INVALID_REQUEST` — invalid role or negative search_weight  
**Response 400:** `CONSTRAINT_VIOLATION` — database constraint violation (invalid field value bypassed validation)  
**Response 409:** `REPO_EXISTS` — repository already in another product

---

### PUT /api/products/{id}/repos/{repo_id}

Update repository association fields.

**Request body (all optional):**
```json
{
  "display_name": "New Name",
  "role": "library",
  "search_weight": 2.0
}
```

**Response 200:** Updated RepoAssociation object  
**Response 400:** `INVALID_REQUEST` — invalid role or non-positive search_weight  
**Response 404:** `REPO_NOT_FOUND` — repository not in this product

---

### DELETE /api/products/{id}/repos/{repo_id}

Remove a repository from a product (sets `product_id` to NULL, does not delete the repo record).

**Response 204:** No content  
**Response 404:** `REPO_NOT_FOUND`

---

## Error Response Format

All errors follow this structure:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

| HTTP Status | Code | Meaning |
|-------------|------|---------|
| 400 | `INVALID_REQUEST` | Validation failure (bad role, negative weight, etc.) |
| 400 | `CONSTRAINT_VIOLATION` | DB constraint violated despite passing validation |
| 404 | `NOT_FOUND` | Product not found |
| 404 | `REPO_NOT_FOUND` | Repository not in this product |
| 409 | `SLUG_EXISTS` | Product slug already taken |
| 409 | `REPO_EXISTS` | Repository already belongs to another product |
| 500 | `ADD_ERROR` | Unexpected server error adding repository |

---

## Change History

| Date | Change |
|------|--------|
| 2026-06-16 | **BUG-008 fix** — `role` and `search_weight` now correctly default server-side; invalid values return 400 not 500 |
```

### docs/history/change-log.md
```
# Change Log

## Unreleased

| Date | ID | Type | Summary | Impact |
|---|---:|---|---|---|
|2026-06-19|REQ-008|Architecture|Reranker architecture update — local rerank mandatory (model switchable via reranker-settings.json), Remote LLM optional enhancement added (REMOTE_LLM_RERANK_ENABLED, REMOTE_LLM_CANONICAL_ENABLED); new FR-11 spec created (✅ DONE)|Spec: +FR-11, updated basic-design, CLAUDE.md, FR-03|
|2026-06-19|REQ-008|Refactor|ONNX runtime refactoring — replaced `yalue/onnxruntime_go` with custom CGO package reused from translate-tool; fixed SmartRouter dead code (removed OLLAMA_ONLY, fixed resource leak in Close); updated build tags to `cgo,onnxruntime` (✅ DONE)|Backend: -1 external dep, +4 files, ~0 API surface change|
|2026-06-19|BUG-011|Bug Fix|Multi-repo indexing fails after product registration — orchestrator uses startup-fixed gitClient (REPO_PATH) instead of per-repo path; NULL scan error on retry; double job creation. Spec + plan + tasks ready. (🔍 Fix Ready — pending implementation)|High|
|2026-06-16|BUG-009|Investigation|500 error - UNIQUE constraint on products.slug — Auto-create logic attempts to create existing product (📋 Open)| High |
|2026-06-16|BUG-008|Bug Fix|500 error when adding repository — Pass-by-value bug prevents default values from being applied (✅ FIXED)| High |
|2026-06-16|BUG-007|Security Fix|WebSocket connections lack authentication — Implemented JWT auth for all WebSocket endpoints (✅ FIXED)| High |
|2026-06-16|BUG-006|Bug Fix|401 error does not trigger login redirect — Axios interceptor missing second 401 handler (✅ FIXED: globalLogout utility + App event listener)| High |
|2026-06-16|BUG-005|Bug Fix|Missing API Routes for Remote Build and Tools Query — REST endpoints not registered in backend (✅ FIXED: Routes registered, handlers implemented)| Medium |
|2026-06-15|BUG-004|Bug Fix|Repository Registration Data Lost After Page Refresh — Frontend state management anti-pattern (✅ FIXED: TanStack Query migration)| Medium |
|2026-06-15|BUG-003-v2|Bug Fix|WebSocket Connection Failure in Development Environment — Missing VITE_USE_PROXY configuration (✅ FIXED)| Medium |
|2026-06-14|BUG-003-v1|Bug Fix|Fix /auth/profile endpoint returning incomplete user data (HTTP 502) (✅ FIXED)| High — all authenticated users affected |
|2026-06-04|REQ-007|ENH|UI/UX Improvements - Knowledge page, Indexing status display, Button control| Frontend: +1 component, +5 files modified |
|2026-06-04|INFRA|BUG|API path fixes and polling optimization for jobs endpoint| Frontend: +3 files modified |
|2026-06-01|REQ-007|CR|Manual Index Trigger - Add button + API for on-demand indexing (v1.1)| Spec update: +3 APIs, +1 table, +4-6h work |
|2026-06-01|REQ-009A|FR|Frontend authentication UI - Login, Register, Profile pages with JWT auth| Frontend: +12 files |
|2026-06-01|REQ-010|FR|Internationalization (i18n) - ja/en/vi support with language switcher| Frontend/Backend: +33 files |
|2026-05-27|REQ-001|RQ|Bootstrap repository structure for Engineering Knowledge System| none |
|2026-05-27|REQ-002|RQ|Add initial IPA spec skeleton for Document Search (index/chunk/query)| none |
|2026-05-27|REQ-003|RQ|Add initial IPA spec skeleton for Engineering Knowledge System core (semantic graph, canonical knowledge, retrieval pipeline, incremental rebuild)| none |

## 2026-06-16 - BUG-008: 500 Internal Server Error when adding repository to product

### Bug Fix

**Root Cause:** Pass-by-value bug in `ValidateAddRepoRequest` function. The validation function receives `AddRepoRequest` by value instead of pointer, causing default value assignments (`role="service"`, `search_weight=1.0`) to modify a local copy that gets discarded. When optional fields are omitted, the original request struct retains zero values (empty string for role, 0.0 for search_weight), violating database CHECK constraint and causing 500 errors.

**Impact:** High severity for API clients. Frontend UI unaffected (always sends role field), but direct API calls via curl/Postman/scripts fail with 500 error when role field is omitted. Database records created with explicit role but omitted search_weight have incorrect value (0.0 instead of 1.0), degrading search relevance.

**Fix Summary:**
1. **Core Validation Fix (Phase 1):**
   - Changed `ValidateAddRepoRequest` signature from `func(req AddRepoRequest)` to `func(req *AddRepoRequest)`
   - Fixed boolean logic bug in search_weight validation (`<= 0 && != 0` → `< 0`)
   - Updated call site in `AddRepo` to pass `&req` instead of `req`

2. **Testing (Phase 2):**
   - Added 15 unit tests covering all validation scenarios
   - Added 4 integration tests with real database
   - Tests verify defaults are applied and explicit values are preserved
   - 100% coverage of ValidateAddRepoRequest logic

3. **Error Handling Enhancement (Phase 3):**
   - Added CHECK constraint violation detection in HTTP handler
   - Returns 400 Bad Request instead of 500 for constraint violations
   - Provides descriptive error code "CONSTRAINT_VIOLATION"

4. **Data Migration (Phase 4):**
   - Created `fix-search-weights` migration script
   - Finds and fixes repos with `search_weight = 0.0`
   - Supports dry-run mode, idempotent execution

5. **Manual Verification (Phase 5):**
   - Comprehensive verification guide with UI and API test scenarios
   - Database verification queries
   - Regression check procedures

6. **Documentation (Phase 6):**
   - Updated change-log.md (this file)
   - Created MANUAL_VERIFICATION.md guide

**Files Changed:**
- `src/Backend/internal/product/manager.go` — Fixed validation function signature
- `src/Backend/internal/product/impl.go` — Updated call site
- `src/Backend/internal/product/manager_test.go` — Added 15 unit tests
- `src/Backend/internal/product/backward_compat_test.go` — Added 4 integration tests
- `src/Backend/internal/product/handlers.go` — Enhanced error handling
- `src/Backend/cmd/fix-search-weights/main.go` — NEW: Migration script
- `specs/BUG-008/MANUAL_VERIFICATION.md` — NEW: Manual test guide

**Test Results:**
- Unit tests: ✅ 15 tests passing (all validation scenarios covered)
- Integration tests: ✅ 4 tests passing (database verification)
- Build: ✅ No compilation errors
- Vet: ✅ No static analysis warnings
- Total: 19 automated tests, 0 failures

**Acceptance Criteria:**
- ✅ ValidateAddRepoRequest uses pointer parameter
- ✅ Default role="service" applied when field is omitted or empty
- ✅ Default search_weight=1.0 applied when field is omitted or zero
- ✅ Explicit values preserved (not overwritten by defaults)
- ✅ Invalid role values return 400 Bad Request (not 500)
- ✅ Negative search_weight values return 400 Bad Request
- ✅ All unit and integration tests pass
- ✅ Build and vet succeed

**Migration Notes:**
- Run migration script to fix existing data:
  ```bash
  ./bin/fix-search-weights -db data/metadata.db -dry-run  # Check affected repos
  ./bin/fix-search-weights -db data/metadata.db           # Apply fix
  ```
- Migration is optional (only affects search relevance scoring)

**Constitutional Compliance:**
- ✅ INVARIANT-1: Correctness > Performance (fix prioritizes correct defaults)
- ✅ Go Coding Standard 5.3: Use pointers when function modifies caller's data
- ✅ Test Strategy (Section 8): 80% coverage target exceeded

**Backward Compatibility:**
- ✅ No API contract changes
- ✅ Frontend unaffected (already sends all fields)
- ✅ Fix makes backend honor documented defaults
- ✅ Easy to roll back (single commit revert)

**Risk Assessment:**
- Regression risk: Low (localized change, comprehensive tests)
- Migration risk: Low (idempotent script, search_weight fix is optional)
- Testing risk: Low (19 automated tests provide safety net)

---

## 2026-06-16 - BUG-007: WebSocket Connections Lack Authentication

### Security Fix

**Root Cause:** WebSocket authentication was not implemented during initial development despite all necessary authentication infrastructure existing for HTTP endpoints. Frontend hooks (`useWebSocket`, `useRemoteSocket`) connect immediately without checking `isAuthenticated` state, and backend handler (`WSHub.ServeWS`) accepts connections without validating JWT tokens.

**Impact:** High severity security vulnerability allowing unauthorized access to real-time system events (indexing progress, build output, system notifications). All users in all deployment environments affected.

**Fix Summary:**
1. **Backend (Phase 1):**
   - Created `ParseJWTFromRequest()` function to validate JWT from Authorization header or query parameter
   - Modified `WSHub.ServeWS` to require authentication before connection upgrade
   - Applied same authentication pattern to REQ-003 remote build WebSocket
   - Added feature flag `WEBSOCKET_AUTH_REQUIRED` (default: `true`) for phased deployment
   - Implemented 34 unit tests covering all authentication scenarios

2. **Frontend (Phase 2):**
   - Modified `useWebSocket` and `useRemoteSocket` to only connect when `isAuthenticated === true`
   - Added JWT token to WebSocket URL: `ws://host/ws?token=<JWT>`
   - Implemented 401 error handling (close code 1008/4401) without auto-reconnect
   - Added connection cleanup on logout
   - Implemented 19 unit tests

3. **Integration & Deployment (Phase 3):**
   - Created comprehensive integration test suite
   - Automated security verification script (`websocket-security-test.sh`)
   - Phased deployment guide with feature flag strategy
   - Rollback procedures (2-5 minute recovery time)

4. **Documentation (Phase 4):**
   - API documentation (`docs/api/websocket-api.md`)
   - Deployment guide (`specs/BUG-007/deployment.md`)
   - Monitoring guide with 6 key metrics (`specs/BUG-007/monitoring.md`)
   - Updated CLAUDE.md with WebSocket auth section

**Files Changed:**
- `src/Backend/internal/api/middleware.go` — ParseJWTFromRequest function
- `src/Backend/internal/api/middleware_test.go` — 10+ test cases
- `src/Backend/internal/api/websocket.go` — Auth enforcement in ServeWS
- `src/Backend/internal/api/websocket_test.go` — WebSocket auth tests
- `src/Backend/internal/common/config.go` — WEBSOCKET_AUTH_REQUIRED flag
- `src/Backend/internal/req3/websocket/*.go` — REQ-003 auth
- `src/Backend/tests/integration/websocket_auth_test.go` — Integration tests (NEW)
- `src/Frontend/src/hooks/useWebSocket.ts` — Auth state check, token passing
- `src/Frontend/src/hooks/useRemoteSocket.ts` — Auth state check, token passing
- `src/Frontend/src/hooks/__tests__/useWebSocket.test.ts` — Frontend tests
- `src/Frontend/src/hooks/__tests__/useRemoteSocket.test.ts` — Frontend tests
- `docs/api/websocket-api.md` — NEW: WebSocket API documentation
- `specs/BUG-007/security-verification.md` — NEW: Security test guide
- `specs/BUG-007/websocket-security-test.sh` — NEW: Automated test script
- `specs/BUG-007/deployment.md` — NEW: Deployment guide
- `specs/BUG-007/monitoring.md` — NEW: Monitoring guide
- `CLAUDE.md` — Added §3.5 WebSocket Authentication

**Test Results:**
- Backend unit tests: ✅ 34 tests passing
- Frontend unit tests: ✅ 19 tests passing
- Integration tests: ✅ Created (compilation passing, requires actual server)
- Security verification script: ✅ Automated 6 test scenarios
- Manual testing: ✅ Ready (documented in security-verification.md)

**Deployment Strategy:**
- **Phase 1:** Deploy backend with `WEBSOCKET_AUTH_REQUIRED=false` (legacy mode)
- **Phase 2:** Deploy frontend (sends tokens but not required yet)
- **Phase 3:** Enable flag in staging → monitor 24 hours
- **Phase 4:** Enable flag in production → monitor 1 week
- **Phase 5:** Remove feature flag (authentication always enforced)

**Monitoring:**
- Connection success rate target: >99%
- 401 error rate target: <1% (bots/attackers only)
- Token validation latency target: <5ms P95
- Alert on: >10% auth failure rate (critical), >5% (warning)

**Constitutional Compliance:**
- ✅ INVARIANT-1: Correctness > Performance (security prioritized, <5ms latency acceptable)
- ✅ INVARIANT-2: Atomic Visibility (auth is all-or-nothing: valid token + upgrade OR 401)
- ✅ INVARIANT-4: Crash-Safety (auth failure does not leave dangling connections)
- ✅ INVARIANT-5: Source Traceability (all events traceable to authenticated users via JWT claims)

**Technical Details:**
- **Token Passing:** Query parameter format `?token=<JWT>` for browser compatibility
- **Error Handling:** Generic error messages to prevent information leakage
- **Token Expiration:** Connection remains open after token expires (checked only at connect time)
- **Close Codes:** 1008 (policy violation) or 4401 (custom auth error) for auth failures
- **Reconnection:** Frontend does NOT auto-reconnect on auth failure (redirects to login)

**Security Notes:**
- Use WSS (WebSocket Secure) in production for encrypted transport
- Tokens in query params logged → configure log filters to redact `?token=***`
- Future enhancement: Move token to `Sec-WebSocket-Protocol` header (more secure)

---

## 2026-06-16 - BUG-006: 401 Error Does Not Trigger Login Redirect

### Bug Fix

**Root Cause:** Axios response interceptor only handled the **first** 401 error. When a second 401 occurred after token refresh (due to `originalRequest._retry === true` guard), the interceptor fell through to `return Promise.reject(error)` without triggering logout or navigation to the login page.

**Impact:** Users experienced session expiry but remained on the current page with broken functionality. No automatic redirect to login page occurred.

**Fix Summary:**
1. Created centralized `globalLogout()` utility in `src/Frontend/src/utils/logout.ts`
2. Modified Axios interceptor to handle second 401 by calling `globalLogout('retry-401')`
3. Added App-level event listener for `session-expired` custom event
4. Refactored `useAuth.logout()` to use `globalLogout('user-initiated')`
5. Removed `window.location.href = '/login'` (replaced with React Router navigation)

**Files Changed:**
- `src/Frontend/src/utils/logout.ts` — NEW: Centralized logout utility with event emission
- `src/Frontend/src/utils/logout.test.ts` — NEW: Unit tests (11 tests, all passing)
- `src/Frontend/src/api/client.ts` — MODIFIED: Handle second 401, use globalLogout
- `src/Frontend/src/api/client.test.ts` — NEW: Unit tests (test structure created)
- `src/Frontend/src/App.tsx` — MODIFIED: Session-expired event listener + navigation
- `src/Frontend/src/hooks/useAuth.ts` — MODIFIED: Use globalLogout instead of manual cleanup
- `src/Frontend/vitest.config.ts` — FIXED: Path alias configuration for tests

**Verification:**
- Unit tests for `globalLogout()`: ✅ PASS (11/11)
- Frontend build: ✅ PASS
- TypeScript compilation: ✅ NO ERRORS
- Manual testing: See `specs/BUG-006/` for test scenarios

**Constitutional Compliance:**
- ✅ INVARIANT-1: Correctness > Performance (security and UX correctness prioritized)
- ✅ INVARIANT-4: Crash-Safety (all error paths wrapped in try-catch)
- ✅ P0 Test Quality: Unit tests for critical logout flow

**Technical Details:**
- **Before:** Second 401 → no handler → user stuck on page
- **After:** Second 401 → `globalLogout('retry-401')` → event emitted → App navigates to `/login` → toast notification
- **Event-driven design:** Interceptor emits event, App handles navigation (clean separation of concerns)

## 2026-06-16 - BUG-005: Missing API Routes for Remote Build and Tools Query

### Bug Fix

**Root Cause:** REQ-003 Remote Build feature was implemented with WebSocket-based real-time interface but REST API endpoints (`/api/build/status`, `/api/tools/query`) were never registered in backend router.

**Impact:** Frontend received 404 errors when polling build status or querying tool results, blocking users from monitoring remote build jobs via REST API.

**Fix Summary:**
1. Registered 3 routes in `server.go`: `/api/build/status`, `/api/build/status/{job_id}`, `/api/tools/query`
2. Implemented handlers in `handlers_build_status.go` (2 handlers) and `handlers_tools.go` (1 handler)
3. Created type definitions in `types_build.go` matching frontend expectations
4. Added unit tests (test code written; package compilation blocked by pre-existing test infrastructure issues)

**Files Changed:**
- `src/Backend/internal/api/server.go` — Registered 3 new routes
- `src/Backend/internal/api/handlers_build_status.go` — NEW: Build status handlers
- `src/Backend/internal/api/handlers_tools.go` — NEW: Tool query handler
- `src/Backend/internal/api/types_build.go` — NEW: Type definitions for REST API responses
- `src/Backend/internal/api/handlers_build_status_test.go` — NEW: Unit tests
- `src/Backend/internal/api/handlers_tools_test.go` — NEW: Unit tests

**Verification:**
- Code-level verification: PASS (8/8 criteria)
- Routes registered correctly: PASS
- Server builds successfully: PASS
- Type definitions match frontend: PASS
- Runtime testing: Skipped (requires full infrastructure initialization, out of scope)

**Known Limitations (TODO for Future Work):**
- BuildIntegration not wired to Server struct → returns empty job arrays
- Tool result persistence not implemented → returns empty results with TODO message
- Full functionality requires follow-up issues to wire data sources

**Constitutional Compliance:**
- ✅ Correctness > Performance (prioritized fixing 404 errors)
- ✅ Source traceability (handlers include TODO notes for future work)
- ✅ Crash-safe (handlers include proper error handling)

## 2026-06-15 - BUG-004: Repository Registration Data Lost After Page Refresh

### Bug Fix

**Root Cause:** Frontend state management anti-pattern — `MultiRepoSettings` component used local React state (`useState`) instead of TanStack Query for repository list data.

**Impact:** Users lost newly registered repository data after page refresh (F5), making the multi-repository feature unreliable.

**Fix Summary:**
1. Created centralized TanStack Query hooks: `useProductRepos`, `useAddRepoToProduct`, `useUpdateRepoAssociation`, `useRemoveRepoFromProduct`
2. Refactored `MultiRepoSettings` component to use the new hooks
3. Implemented proper cache invalidation on all mutations
4. Repository data now persists correctly after page refresh

**Files Changed:**
- `src/Frontend/src/hooks/useProducts.ts` — NEW: TanStack Query hooks for product repository management
- `src/Frontend/src/components/settings/MultiRepoSettings.tsx` — Refactored to use TanStack Query hooks

**Verification:**
- TypeScript compilation: PASS
- Build: PASS
- Manual testing: see `specs/BUG-004/MANUAL_TEST_RESULTS.md`

**Constitutional Compliance:**
- ✅ Server state managed by TanStack Query (not local useState)
- ✅ Source code (backend) is source of truth
- ✅ Correctness prioritized over performance

## 2026-06-01 - REQ-007 v1.1: Manual Index Trigger

### Change Request: REQ-007-CR-001

**Type:** Feature Addition (Change Request)

**Summary:** ユーザー要望により、手動インデックストリガー機能を追加

**Requirements:**
- FR-01.8: 手動インデックストリガー（Manual Index Trigger）
- UI: リポジトリ選択後に「Index Now」ボタンを配置
- WebSocket統合: リアルタイム進行状況表示
- 履歴管理: 過去のインデックスジョブ一覧表示

**Specification Changes (v1.0 → v1.1):**

**Added APIs:**
- `POST /api/v1/repos/{id}/index` — インデックスジョブ作成（force/incremental/commit_hash オプション）
- `GET /api/v1/repos/{id}/index/status?job_id=<id>` — 進行状況取得（progress/current_file/estimated_remaining）
- `GET /api/v1/repos/{id}/index/history?limit=<n>` — 履歴取得（成功/失敗/所要時間）

**Database Schema:**
- New table: `index_jobs` (job履歴管理)
  - Columns: id, repo_id, status, progress, files_processed, files_total, symbols_found, epoch_created, triggered_by, user_email, error_message, config_json
  - Indexes: repo_id + started_at DESC, status

**Non-Functional Requirements:**
- NFR-05: API応答 < 200ms（ジョブキュー登録まで）
- NFR-06: 進行状況更新間隔 1秒（WebSocket）
- NFR-07: 履歴取得 < 300ms
- NFR-08: 同時ジョブ制限（1リポジトリあたり1ジョブ）

**Use Cases:**
1. ソースコード変更後の即座なインデックス更新
2. Git push後の手動同期トリガー
3. トラブルシューティング時の再インデックス
4. デモ・プレゼンテーション時のデータ更新

**Implementation Plan:**

Backend (2-3 hours):
- [ ] `internal/api/handlers_index.go` — 3 API ハンドラー実装
- [ ] `internal/metadata/schema.go` — index_jobs テーブル追加
- [ ] `internal/indexer/job_manager.go` — ジョブキューイング + 進行状況更新
- [ ] WebSocket統合 — index.progress イベント配信

Frontend (2-3 hours):
- [ ] `components/indexing/ManualIndexButton.tsx` — トリガーボタン
- [ ] `components/indexing/IndexProgressModal.tsx` — 進行状況モーダル（WebSocket購読）
- [ ] `components/indexing/IndexHistoryTable.tsx` — 履歴一覧表示
- [ ] `api/indexing.ts` — API クライアント

**Testing:**
- [ ] Unit tests: handlers_index_test.go
- [ ] E2E tests: manual-index.spec.ts（Playwright）
- [ ] 同時実行制限テスト
- [ ] WebSocket購読テスト

**Completion Estimate:** 85% → 100% (added 4-6 hours)

**Status:** 🟡 Spec Updated, Implementation Pending

---

## 2026-06-01 - Authentication & Internationalization

### REQ-009A: Frontend Authentication UI

**Added:**
- User authentication pages (Login, Register, Profile)
- JWT token management with automatic refresh
- Password strength validation with indicator
- Protected route component
- User menu dropdown with logout
- Zustand auth store for state management
- Axios interceptors for JWT injection and 401 handling

**Files Created:**
- `src/Frontend/src/pages/{Login,Register,Profile}.tsx`
- `src/Frontend/src/components/auth/{ProtectedRoute,UserMenu,PasswordStrengthIndicator}.tsx`
- `src/Frontend/src/store/useAuthStore.ts`
- `src/Frontend/src/hooks/useAuth.ts`
- `src/Frontend/src/api/auth.ts`
- `src/Frontend/src/utils/{tokenManager,dateFormatter}.ts`
- `src/Frontend/e2e/auth.spec.ts` (10+ test scenarios)

**Implementation Details:**
- JWT self-refresh with race condition prevention
- Token expiry checking (30-second buffer)
- localStorage token persistence
- React Hook Form + Zod validation
- TanStack Query integration
- E2E tests: TC-AUTH-01 through TC-AUTH-10

### REQ-010: Internationalization (i18n)

**Added:**
- Multi-language support (Japanese, English, Vietnamese)
- Language switcher component in header
- Browser language auto-detection
- localStorage language preference persistence
- Backend i18n utilities for emails

**Translation Files (18 total):**
- `public/locales/{ja,en,vi}/{common,auth,search,indexing,settings,errors,dashboard}.json`

**Implementation Details:**
- react-i18next with 7 namespaces
- Language detection priority: localStorage → browser → default (ja)
- Backend: i18next-style message detection and fallback
- Date formatting with Intl API
- E2E tests: TC-I18N-01 through TC-I18N-09

**Files Created:**
- `src/Frontend/src/i18n/config.ts`
- `src/Frontend/src/components/common/LanguageSwitcher.tsx`
- `src/Frontend/e2e/i18n.spec.ts`
- `src/Backend/internal/i18n/{i18n.go,i18n_test.go}`
- 18 translation JSON files

**Package Updates:**
- `package.json`: Added i18next, react-i18next, i18next-browser-languagedetector, i18next-http-backend

### Documentation Updates

**Modified:**
- CLAUDE.md:
  - §6.2: Added auth & i18n state management patterns
  - §6.4: Added authentication patterns section
  - §6.5: Added i18n usage patterns
  - §11.1: Updated completed components
  - §11.3: Added deployment checklist
  
- docs/traceability/requirements-matrix.md:
  - Added REQ-009A & REQ-010 to all sections
  - Added implementation file mappings
  - Added test case mappings

- docs/history/change-log.md: This entry

### Testing

**E2E Tests:** 19 test scenarios
- Authentication: Register, login, logout, password change, rate limiting
- i18n: Language switching, persistence, translation correctness

**Unit Tests:**
- Backend i18n: Language detection, message retrieval, validation

## Previous Releases

Initialized spec-kit (IPA) folder structure
Seeded basic/detail design docs
Added templates and traceability skeleton
```

### docs/traceability/requirements-matrix.md
```
# Requirements Traceability Matrix

> **文書番号**: RAD-TRACE-001 &nbsp;|&nbsp; **最終更新**: 2026-06-19 (BUG-011 revised — root cause corrected)

---

## 📋 目次

- [要件 → 設計 マッピング](#要件--設計-マッピング)
- [要件 → 実装 マッピング](#要件--実装-マッピング)
- [要件 → テスト マッピング](#要件--テスト-マッピング)
- [不具合追跡 (BUG)](#不具合追跡-bug)
- [修正サマリー (2026-05-30)](#修正サマリー (2026-05-30))
---

## 要件 → 設計 マッピング

| 要件ID | 要件名 | 基本設計 | 詳細設計 | ステータス |
|---|---|---|---|---|
| REQ-001/FR-01 | ソース知識再構築 | basic-design.md §3.1 | detail-design.md §2.1 | ✅ |
| REQ-001/FR-02 | メタデータ抽出 | basic-design.md §3.2 | detail-design.md §2.2 | ✅ |
| REQ-001/FR-03 | 多解像度コード表現 | basic-design.md §3.3 | detail-design.md §2.3 | ✅ |
| REQ-001/FR-04 | コードグラフ構築 | basic-design.md §3.4 | detail-design.md §2.4 | ✅ |
| REQ-001/FR-05 | 品質スコアリング | basic-design.md §3.5 | detail-design.md §2.5 | ✅ |
| REQ-001/FR-06 | 競合検出 | basic-design.md §3.6 | detail-design.md §2.6 | ✅ |
| REQ-001/FR-07 | 正規知識生成 | basic-design.md §3.7 | detail-design.md §2.7 | ⏳ |
| REQ-001/FR-08 | インクリメンタルリビルド | basic-design.md §4.1 | detail-design.md §3.1 | ✅ |
| REQ-001/FR-09 | 検索パイプライン | basic-design.md §4.2 | detail-design.md §3.2 | ⏳ |
| REQ-001/FR-10 | コンテキストバジェット | basic-design.md §4.3 | detail-design.md §3.3 | ⏳ |
| REQ-001/FR-11 | ドリフト検出 | basic-design.md §4.4 | detail-design.md §3.4 | ⏳ |
| REQ-002/F-REQ-001 | LLM Runtime Interface | basic-design.md §5.1 | detail-design.md §4.1 | ⏳ |
| REQ-002/F-REQ-002 | Vector Store (LanceDB) | basic-design.md §5.2 | detail-design.md §4.2 | ⏳ |
| REQ-002/F-REQ-003 | Hybrid Retrieval | basic-design.md §5.3 | detail-design.md §4.3 | ⏳ |
| REQ-002/F-REQ-004 | MCP Integration | basic-design.md §6.1 | detail-design.md §5.1 | ⏳ |
| REQ-003/FR-3-01 | ビルドジョブ管理 | basic-design.md §7.1 | detail-design.md §6.1 | ✅ |
| REQ-003/FR-3-02 | ファイル同期 | basic-design.md §7.2 | detail-design.md §6.2 | ✅ |
| REQ-003/FR-3-03 | 3段階サンドボックス | basic-design.md §7.3 | detail-design.md §6.3 | ✅ |
| REQ-003/FR-3-04 | 成果物管理 | basic-design.md §7.4 | detail-design.md §6.4 | ✅ |
| REQ-003/FR-3-05 | リモートデバッグ (DAP) | basic-design.md §7.5 | detail-design.md §6.5 | ✅ |
| REQ-009A/FR-09A-01 | フロントエンド認証UI | CLAUDE.md §6.4 | CLAUDE.md §6.4 | ✅ |
| REQ-009A/FR-09A-02 | JWT自動リフレッシュ | CLAUDE.md §6.4 | CLAUDE.md §6.4 | ✅ |
| REQ-009A/FR-09A-03 | パスワード強度検証 | CLAUDE.md §6.4 | CLAUDE.md §6.4 | ✅ |
| REQ-010/FR-10-01 | 多言語対応（UI） | CLAUDE.md §6.5 | CLAUDE.md §6.5 | ✅ |
| REQ-010/FR-10-02 | 言語切り替え | CLAUDE.md §6.5 | CLAUDE.md §6.5 | ✅ |
| REQ-010/FR-10-03 | バックエンドi18n | CLAUDE.md §7.2 | CLAUDE.md §7.2 | ✅ |

---

## 要件 → 実装 マッピング

| 要件ID | 実装ファイル | 状態 |
|---|---|---|
| REQ-001/FR-01 | `internal/req1/ingestion/parser_wrapper.go` | ✅ |
| REQ-001/FR-02 | `internal/req1/ingestion/metadata_builder.go` | ✅ |
| REQ-001/FR-03 | `internal/req1/storage/metadata_store.go` | ✅ |
| REQ-001/FR-04 | `internal/req1/graph/builder.go`, `traversal.go` | ✅ |
| REQ-001/FR-05 | `internal/req1/quality/scorer.go` | ✅ |
| REQ-001/FR-06 | `internal/req1/quality/conflict_detector.go` | ✅ |
| REQ-001/FR-07 | `internal/req1/storage/canonical_store.go` | ⏳ |
| REQ-001/FR-08 | `internal/epoch/copy_forward.go` | ✅ |
| REQ-001/FR-09 | `internal/req1/retrieval/pipeline.go` | ⏳ Phase 4-5 |
| REQ-001/FR-10 | `internal/req1/retrieval/packer.go` | ⏳ Phase 5 |
| REQ-001/FR-11 | `internal/req1/drift/detector.go` | ⏳ Phase 3 |
| REQ-002/F-REQ-001 | `internal/llm/runtime.go`, `openai.go`, `anthropic.go`, `ollama.go` | ⏳ |
| REQ-002/F-REQ-002 | `internal/vectordb/client.go`, `ingest.go`, `search.go` | ⏳ |
| REQ-002/F-REQ-003 | `internal/retriever/retriever.go` | ⏳ |
| REQ-002/F-REQ-004 | `internal/mcp/server.go`, `tools.go` | ⏳ |
| REQ-003/FR-3-01 | `internal/req3/build/service.go`, `queue.go` | ✅ |
| REQ-003/FR-3-02 | `internal/req3/sync/` | ✅ |
| REQ-003/FR-3-03 | `internal/req3/sandbox/` | ✅ |
| REQ-003/FR-3-04 | `internal/req3/artifact/` | ✅ |
| REQ-003/FR-3-05 | `internal/req3/debug/` | ✅ |
| REQ-009A/FR-09A-01 | `src/Frontend/src/pages/{Login,Register,Profile}.tsx`, `components/auth/` | ✅ |
| REQ-009A/FR-09A-02 | `src/Frontend/src/api/client.ts`, `hooks/useAuth.ts` | ✅ |
| REQ-009A/FR-09A-03 | `src/Frontend/src/components/auth/PasswordStrengthIndicator.tsx` | ✅ |
| REQ-010/FR-10-01 | `src/Frontend/src/i18n/config.ts`, `public/locales/{ja,en,vi}/*.json` | ✅ |
| REQ-010/FR-10-02 | `src/Frontend/src/components/common/LanguageSwitcher.tsx` | ✅ |
| REQ-010/FR-10-03 | `src/Backend/internal/i18n/i18n.go` | ✅ |

---

## 要件 → テスト マッピング

| 要件ID | テストファイル | テストID | 状態 |
|---|---|---|---|
| REQ-001/FR-01 | `tests/req1/unit/metadata_builder_test.go` | TC-R001-03 | ✅ |
| REQ-001/FR-02 | `tests/req1/unit/metadata_builder_test.go` | TC-R001-03 | ✅ |
| REQ-001/FR-04 | `tests/req1/unit/graph_test.go` | TC-R001-04 | ✅ |
| REQ-001/FR-05 | `tests/req1/unit/quality_scorer_test.go` | TC-R001-05 | ✅ |
| REQ-001/FR-06 | `tests/req1/unit/conflict_detector_test.go` | TC-R001-06 | ✅ |
| REQ-001/FR-08 | `tests/req1/correctness/incremental_equivalence_test.go` | TC-R001-01 | ✅ |
| REQ-001/FR-09 | `tests/req1/integration/pipeline_test.go` | TC-R001-07 | ⏳ |
| REQ-001 NFR | `tests/req1/performance/retrieval_benchmark_test.go` | TC-R001-08〜11 | ⏳ |
| REQ-009A/FR-09A-01 | `e2e/auth.spec.ts` | TC-AUTH-01〜10 | ✅ |
| REQ-009A/FR-09A-02 | `e2e/auth.spec.ts` | TC-AUTH-05, TC-AUTH-10 | ✅ |
| REQ-009A/FR-09A-03 | `e2e/auth.spec.ts` | TC-AUTH-07 | ✅ |
| REQ-010/FR-10-01 | `e2e/i18n.spec.ts` | TC-I18N-02, TC-I18N-05, TC-I18N-06 | ✅ |
| REQ-010/FR-10-02 | `e2e/i18n.spec.ts` | TC-I18N-02〜09 | ✅ |
| REQ-010/FR-10-03 | `internal/i18n/i18n_test.go` | TestDetectLanguage, TestGetMessage | ✅ |

---

## 不具合追跡 (BUG)

### 2026年5月 検出・修正分

| BUG ID | タイトル | 影響範囲 | ステータス | 修正者 | 修正日 |
|--------|---------|---------|-----------|--------|-------|
| BUG-001 | Files ページのファイルクリック後に空白画面が表示される | REQ-007 | ✅ FIXED | Claude Code | 2026-05-30 |
| BUG-002 | WebSocket 接続失敗エラー | REQ-003 | ✅ FIXED | Claude Code | 2026-05-30 |
| BUG-003-v1 | 502 Bad Gateway on /auth/profile Request | REQ-009A | ✅ FIXED | Claude Sonnet 4.5 | 2026-06-14 |
| BUG-003-v2 | WebSocket Connection Failure in Development Environment | REQ-004, Config | ✅ FIXED | Speckit Bug Investigator | 2026-06-15 |
| BUG-004 | Repository Registration Data Lost After Page Refresh | REQ-004, Frontend | ✅ FIXED | Speckit Implementer | 2026-06-15 |
| BUG-005 | Missing API Routes for Remote Build and Tools Query | REQ-003 | ✅ FIXED | Speckit Implementer | 2026-06-16 |
| BUG-006 | 401 Error Does Not Trigger Login Redirect | REQ-009A | ✅ FIXED | Speckit Implementer | 2026-06-16 |
| BUG-007 | WebSocket Connections Lack Authentication | REQ-004, REQ-003, Security | ✅ FIXED | Speckit Implementer | 2026-06-16 |
| BUG-008 | 500 Internal Server Error when adding repository to product | REQ-004, REQ-011 | ✅ FIXED | Speckit Implementer | 2026-06-16 |
| BUG-009 | 500 Internal Server Error - UNIQUE constraint on products.slug | REQ-004, REQ-011 | 📋 Open | Speckit Bug Investigator | 2026-06-16 |
| BUG-010 | Missing POST /api/products Endpoint | REQ-011 | 📋 Open | Speckit Bug Investigator | 2026-06-17 |
| BUG-011 | Cannot Start Index After Registering Product and Repository | REQ-011, REQ-007 | 🔍 Investigated — Fix Ready | Speckit Bug Investigator | 2026-06-19 |

### BUG-011 Detail

| Item | Content |
|------|---------|
| **Problem** | Triggering index for a product-registered repo always fails — job created (HTTP 201) but async pipeline errors out |
| **Root Cause (B1 — Primary)** | `orchestrator.gitClient` is fixed to startup `REPO_PATH`; `IndexFull` calls `GetHeadCommit` on wrong path → "not a git repository" error → job marked `failed` |
| **Root Cause (B2)** | `IndexIncremental` creates a second internal job; outer job stays `queued` throughout — no progress visible |
| **Root Cause (B3)** | `getRunningJobForRepo` scans nullable `user_email`/`config_json` into `string` → SQL scan error → HTTP 500 on retry |
| **Root Cause (A — latent)** | `TriggerIndexModal.tsx` has double `/api` URL prefix — masked by Vite proxy in dev, 404 in production |
| **Fix Plan** | `specs/BUG-011/plan.md` — 5 phases, 7 tasks |
| **Spec** | `specs/BUG-011/spec.md` |
| **Tasks** | `specs/BUG-011/tasks.md` |
| **Branch** | `fix/bug-011-multi-repo-indexing` |

### BUG-001 詳細

| 項目 | 内容 |
|------|------|
| **問題** | `/files/{id}` ルートが定義されていない → 詳細ページ表示不可 |
| **根本原因** | App.tsx に `FileDetail` ルート・import が未定義 |
| **修正内容** | `App.tsx` に 2行追加、`FileDetail.tsx` を 220行新規作成 |
| **影響範囲** | REQ-007 (Index Data Visualization) の Files ビュー |
| **テスト状態** | ユニット ✅、統合 ✅、E2E ⏳ |
| **仕様書** | `specs/BUG-001-file-detail-blank-page/spec.md` |
| **修正履歴** | `specs/BUG-001-file-detail-blank-page/history.md` |

### BUG-002 詳細

| 項目 | 内容 |
|------|------|
| **問題** | WebSocket が `ws://localhost:3000/ws/remote` に接続 → 失敗 |
| **根本原因** | `useRemoteSocket.ts` が誤ったパスを使用 (`/ws/remote` ⟹ `/ws` が正しい) |
| **修正内容** | `useRemoteSocket.ts` 1行修正、エラーハンドリング詳細化 |
| **影響範囲** | REQ-003 (Remote Build & Secure Tool Integration) の Build/Sync/Debug |
| **テスト状態** | ユニット ✅、コンソール動作確認 ✅、統合 ⏳ |
| **仕様書** | `specs/BUG-002-websocket-connection-failed/spec.md` |
| **修正履歴** | `specs/BUG-002-websocket-connection-failed/history.md` |

### BUG-003-v1 詳細 (Auth Profile 502 Error — Fixed 2026-06-14)

| 項目 | 内容 |
|------|------|
| **問題** | `/auth/profile` endpoint returns HTTP 502 Bad Gateway |
| **根本原因** | Incomplete handler implementation — does not call existing `GetUserByID` database method |
| **重大度** | High (affects all authenticated users accessing profile) |
| **影響範囲** | REQ-009A (Frontend Authentication) — user profile display |
| **ステータス** | ✅ FIXED |
| **修正日** | 2026-06-14 |

### BUG-003-v2 詳細 (WebSocket Connection Failure — Fixed 2026-06-15)

| 項目 | 内容 |
|------|------|
| **問題** | WebSocket connection fails immediately (readyState: 0) in development environment |
| **根本原因** | Missing `VITE_USE_PROXY` environment variable in `.env` file leads to invalid WebSocket URL construction |
| **修正計画** | Add `VITE_USE_PROXY=true` to `.env`, update `.env.example`, improve frontend URL validation, update documentation |
| **影響範囲** | REQ-004 (Web UI Dashboard), Configuration management |
| **重大度** | High (blocks real-time updates for all developers in non-Docker environments) |
| **テスト状態** | Investigation complete ✅, Fix plan ready ✅, Pending implementation ⏳ |
| **調査書** | `specs/BUG-003/investigation.md` |
| **修正計画** | `specs/BUG-003/plan.md` |
| **タスク定義** | `specs/BUG-003/tasks.md` |
| **実装チェックリスト** | `specs/BUG-003/IMPLEMENTATION_CHECKLIST.md` |
| **ステータス** | ✅ FIXED |
| **修正日** | 2026-06-15 |

### BUG-004 詳細

| 項目 | 内容 |
|------|------|
| **問題** | After registering a repository on the "Add Repository" screen and then refreshing, the registered content disappears |
| **根本原因** | Frontend state management anti-pattern — local React state used instead of TanStack Query for repository list data |
| **修正内容** | Created centralized TanStack Query hooks (`useProductRepos`, `useAddRepoToProduct`, `useUpdateRepoAssociation`, `useRemoveRepoFromProduct`), refactored `MultiRepoSettings` component to use the new hooks, implemented cache invalidation on all mutations |
| **影響範囲** | REQ-004 (Web UI Dashboard), Multi-Repository Settings page |
| **重大度** | Medium (data loss after refresh, workaround exists but burdensome) |
| **テスト状態** | Implementation complete ✅, TypeScript compilation ✅, Build ✅, Manual testing pending ⏳ |
| **調査書** | `specs/BUG-004/investigation.md` |
| **修正計画** | `specs/BUG-004/plan.md` |
| **タスク定義** | `specs/BUG-004/tasks.md` |
| **実装チェックリスト** | `specs/BUG-004/IMPLEMENTATION_CHECKLIST.md` |
| **実装結果** | `specs/BUG-004/MANUAL_TEST_RESULTS.md` |
| **修正コミット** | 4920d50 (hooks), 2591839 (component refactor) |

### BUG-005 詳細

| 項目 | 内容 |
|------|------|
| **問題** | Frontend receives 404 errors when calling `/api/build/status` and `/api/tools/query` endpoints |
| **根本原因** | REQ-003 Remote Build feature implemented with WebSocket-based interface but REST API endpoints never registered in backend router |
| **修正計画** | Register missing routes in `server.go`, implement handlers in `handlers_build_status.go` and `handlers_tools.go`, add unit/integration tests |
| **影響範囲** | REQ-003 (Remote Build & Secure Tool Integration), Frontend build status polling, Tools query functionality |
| **重大度** | High (core feature broken, no workaround, significant user impact) |
| **修正内容** | Registered 3 routes in `server.go`, implemented handlers in `handlers_build_status.go` and `handlers_tools.go`, added type definitions in `types_build.go` |
| **テスト状態** | Implementation complete ✅, Unit tests written ✅, Code-level verification ✅ (runtime tests blocked by pre-existing test infrastructure issues) |
| **調査書** | `specs/BUG-005/investigation.md` |
| **修正計画** | `specs/BUG-005/plan.md` |
| **タスク定義** | `specs/BUG-005/tasks.md` |
| **実装チェックリスト** | `specs/BUG-005/IMPLEMENTATION_CHECKLIST.md` |
| **データ調査** | `specs/BUG-005/data-source-findings.md` |
| **検証結果** | `specs/BUG-005/manual-verification.md` |
| **修正コミット** | d99c7bc (investigation), 35907ee (types), 4699467 (build handlers), 5ce3e99 (tools handler), d83ae94 (routes), 1eee938 (tests), 8293bbf (tests), b1ec95a (verification) |

### BUG-006 詳細 (401 Error Does Not Trigger Login Redirect — Fixed 2026-06-16)

| 項目 | 内容 |
|------|------|
| **問題** | When API requests return 401 Unauthorized, automatic redirect to login page does not occur in all scenarios |
| **根本原因** | Axios response interceptor only handles first 401 error; when second 401 occurs after token refresh (due to `originalRequest._retry === true` guard), interceptor falls through without triggering logout/redirect |
| **修正計画** | Create centralized `globalLogout()` utility, fix Axios interceptor to handle all 401 cases, add App-level session-expired event listener, unify logout flows |
| **影響範囲** | REQ-009A (Frontend Authentication), affects all authenticated users |
| **重大度** | High (core authentication flow partially broken, security implication) |
| **修正内容** | Created centralized `globalLogout()` utility, fixed Axios interceptor to handle all 401 cases, added App-level session-expired event listener, unified logout flows |
| **テスト状態** | Implementation complete ✅, Manual testing ✅ |
| **調査書** | `specs/BUG-006/investigation.md` |
| **修正計画** | `specs/BUG-006/plan.md` |
| **タスク定義** | `specs/BUG-006/tasks.md` |
| **実装チェックリスト** | `specs/BUG-006/IMPLEMENTATION_CHECKLIST.md` |
| **ステータス** | ✅ FIXED |
| **修正日** | 2026-06-16 |

### BUG-007 詳細 (WebSocket Authentication — Fixed 2026-06-16)

| 項目 | 内容 |
|------|------|
| **問題** | WebSocket connections are established without authentication checks, allowing unauthorized access to real-time system events |
| **根本原因** | Initial implementation omitted authentication; frontend hooks connect immediately without checking `isAuthenticated`, backend handler accepts connections without validating JWT tokens |
| **修正内容** | Implemented end-to-end authentication: frontend conditional connection based on auth state, backend JWT validation during upgrade handshake, connection lifecycle management, feature flag (`WEBSOCKET_AUTH_REQUIRED`) for safe rollback |
| **影響範囲** | REQ-004 (Web UI Dashboard), REQ-003 (Remote Build WebSocket), affects all users in all deployment environments |
| **重大度** | High (security vulnerability, information disclosure, affects core real-time functionality) |
| **テスト状態** | Implementation complete ✅, Unit tests (34 backend + 19 frontend) ✅, Integration tests ✅, Security verification script ✅, Manual testing ✅ |
| **調査書** | `specs/BUG-007/investigation.md` |
| **修正計画** | `specs/BUG-007/plan.md` |
| **タスク定義** | `specs/BUG-007/tasks.md` |
| **実装チェックリスト** | `specs/BUG-007/IMPLEMENTATION_CHECKLIST.md` |
| **セキュリティ検証** | `specs/BUG-007/security-verification.md`, `specs/BUG-007/websocket-security-test.sh` |
| **デプロイガイド** | `specs/BUG-007/deployment.md` |
| **監視ガイド** | `specs/BUG-007/monitoring.md` |
| **API ドキュメント** | `docs/api/websocket-api.md` |
| **修正コミット** | ad66bed (integration tests), a373caa (security verification), 4c0920f (deployment & monitoring docs), additional commits for implementation |
| **ステータス** | ✅ FIXED |
| **修正日** | 2026-06-16 |

### BUG-008 詳細 (500 Internal Server Error when adding repository to product — Fixed 2026-06-16)

| 項目 | 内容 |
|------|------|
| **問題** | POST /api/products/{id}/repos returns 500 Internal Server Error when role field is omitted or validation defaults fail to apply |
| **根本原因** | Pass-by-value bug in `ValidateAddRepoRequest` — function receives `AddRepoRequest` by value instead of pointer, preventing default values (role="service", search_weight=1.0) from being applied to original request |
| **修正内容** | 1. Changed validation function signature to pointer parameter `*AddRepoRequest`<br>2. Fixed boolean logic bug in search_weight validation<br>3. Updated call sites to pass `&req`<br>4. Enhanced error handling to return 400 for constraint violations<br>5. Added 15 unit tests + 4 integration tests<br>6. Created data migration script for existing records |
| **影響範囲** | REQ-004 (Web UI Dashboard — Multi-Repo Settings), REQ-011 (Multi-Repository Product Management), affects API clients that omit optional fields |
| **重大度** | High (core feature broken for API clients, silent data corruption risk for search_weight, violates Go best practices) |
| **テスト状態** | Unit tests ✅ 15 passed, Integration tests ✅ 4 passed, Build ✅, Vet ✅ |
| **調査書** | `specs/BUG-008/investigation.md` |
| **修正計画** | `specs/BUG-008/plan.md` |
| **タスク定義** | `specs/BUG-008/tasks.md` (8 tasks, ~4.5 hours) |
| **実装チェックリスト** | `specs/BUG-008/IMPLEMENTATION_CHECKLIST.md` |
| **手動検証ガイド** | `specs/BUG-008/MANUAL_VERIFICATION.md` |
| **修正ブランチ** | `fix/bug-008-validation-defaults` |
| **修正コミット** | e1d142e (core fix), 0d7cf9c (unit tests), 2d3463a (integration tests), 121081d (error handling), 1c28313 (migration script), 802a332 (manual verification), [documentation commit] |
| **ステータス** | ✅ FIXED |
| **修正日** | 2026-06-16 |

### BUG-009 詳細 (UNIQUE Constraint on products.slug — Open 2026-06-16)

| 項目 | 内容 |
|------|------|
| **問題** | POST /api/products/{id}/repos returns 500 Internal Server Error with UNIQUE constraint violation when trying to add a repository to an existing product |
| **根本原因** | Incorrect auto-create logic in `handleAddRepoToProduct` — attempts to create product when `GetProduct` fails (even for existing products), causing slug collision |
| **修正計画** | 1. Remove auto-create logic (lines 189-201 in handlers_products.go)<br>2. Add proper error classification (404 for product not found, 500 only for genuine server errors)<br>3. Add integration tests for success and error cases |
| **影響範囲** | REQ-004 (Web UI Dashboard — Multi-Repo Settings), REQ-011 (Multi-Repository Product Management), affects all users trying to add repos to existing products |
| **重大度** | High (business logic defect, blocks core product-repo association workflow, wrong HTTP status code) |
| **根本原因信頼度** | High (source code clearly shows flawed auto-create logic, error message matches code path exactly) |
| **テスト状態** | Investigation complete ✅, Fix plan ready ✅, Tasks defined ✅, Pending human review ⏳ |
| **調査書** | `specs/BUG-009/investigation.md` |
| **修正計画** | `specs/BUG-009/plan.md` |
| **タスク定義** | `specs/BUG-009/tasks.md` (6 tasks, 3-5 hours core fix + optional docs/cleanup) |
| **実装チェックリスト** | `specs/BUG-009/IMPLEMENTATION_CHECKLIST.md` (pending human review) |
| **修正ブランチ** | `fix/bug-009-product-repo-constraint` (recommended) |
| **ステータス** | 📋 Open — Pending human review |
| **調査日** | 2026-06-16 |

---

## 修正サマリー (2026-05-30)

### 統計

| 指標 | 数値 |
|------|------|
| 検出不具合数 | 2個 |
| 修正完了数 | 2個 |
| 修正率 | 100% ✅ |
| ファイル変更数 | 3個 |
| 新規ファイル数 | 1個 |
| 総コード変更 | 227行 |

### 影響を受けた REQ

- ✅ **REQ-007**: Index Data Visualization (BUG-001 修正)
- ✅ **REQ-003**: Remote Build & Secure Tool Integration (BUG-002 修正)

---

> **凡例**: ✅ 完了 / ⏳ 予定 / ❌ 未着手 / ⚠️ 要確認
```