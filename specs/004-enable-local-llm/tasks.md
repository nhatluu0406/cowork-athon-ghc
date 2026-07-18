# Tasks: Enable Local LLM with Cloud Fallback (004)

**Input**: Design documents from `/specs/004-enable-local-llm/`

**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/api.md ✅ | quickstart.md ✅

**Organization**: Tasks grouped by user story — each story is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are included in every task description

## Path Conventions

Go backend root: `app/backend/`
- Source: `app/backend/internal/`, `app/backend/cmd/`, `app/backend/migrations/`
- Tests: `app/backend/tests/unit/`, `app/backend/tests/integration/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Directory structure and migration file — no dependencies, can start immediately

- [ ] T001 Create package directory `app/backend/internal/llmconfig/`
- [ ] T002 Create migration file `app/backend/migrations/004_local_llm.sql` with `CREATE TABLE llm_settings` + seed INSERTs + `CREATE TABLE llm_fallback_events` + index (see data-model.md §1)
- [ ] T003 [P] Create test directories `app/backend/tests/unit/llmconfig/` and `app/backend/tests/integration/llmconfig/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core data layer that all user stories depend on

**⚠️ CRITICAL**: All user story work depends on T004–T007 completing first

- [ ] T004 Implement `LLMSettings` struct + `SettingsStore` (Load, Save, UpdateKey) in `app/backend/internal/llmconfig/settings.go` using `database/sql` against `llm_settings` table (data-model.md §2.1)
- [ ] T005 [P] Implement `FallbackEvent` struct + `FallbackStore` (Record, ListRecent) in `app/backend/internal/llmconfig/fallback.go` using `database/sql` against `llm_fallback_events` table (data-model.md §2.2)
- [ ] T006 Write unit tests for `SettingsStore` in `app/backend/tests/unit/llmconfig/settings_test.go` — test Load/Save/UpdateKey with test DB; verify defaults after migration
- [ ] T007 [P] Write unit tests for `FallbackStore` in `app/backend/tests/unit/llmconfig/fallback_test.go` — test Record inserts correct row; ListRecent returns newest-first; limit is honored

**Checkpoint**: Data layer complete — US1, US2, US3 phases can now proceed

---

## Phase 3: User Story 1 — Enable Local LLM Processing (Priority: P1) 🎯 MVP

**Goal**: Settings API to persist local LLM preference + model listing from llm-svc + knowledge query response extension

**Independent Test**: `GET /api/llm/settings` returns defaults; `PUT /api/llm/settings` with valid model → 200 with updated config; `GET /api/llm/models` returns model list including `is_local: true` entries; `POST /api/knowledge/query` response contains `llm_info.mode`

### Implementation for User Story 1

- [ ] T008 [P] [US1] Implement `LLMHandlerDeps`, `UpdateSettingsRequest`, `ModelInfo` types in `app/backend/internal/llmconfig/handler.go` (data-model.md §2.4)
- [ ] T009 [US1] Implement `GET /api/llm/settings` handler in `app/backend/internal/llmconfig/handler.go` — reads from `SettingsStore`, returns JSON (contracts/api.md §1)
- [ ] T010 [US1] Implement `GET /api/llm/models` handler in `app/backend/internal/llmconfig/handler.go` — proxies `llmsvc.Client.ListModels`, returns `{"models":[...]}`, 503 on llm-svc unreachable (contracts/api.md §3)
- [ ] T011 [US1] Implement `PUT /api/llm/settings` handler in `app/backend/internal/llmconfig/handler.go` — validate model name via `ListModels` check, validate timeout 1–300, partial update via `SettingsStore.UpdateKey`, return updated config; error responses per contracts/api.md §2
- [ ] T012 [US1] Extend knowledge query response with `llm_info` field: add `LLMInfo` struct to `app/backend/internal/api/handlers_knowledge.go`, populate `mode`/`model`/`used_fallback` from context value set by `FallbackRouter` (contracts/api.md §5)
- [ ] T013 [US1] Register `/api/llm/` route group in `app/backend/cmd/main.go`: instantiate `SettingsStore`, `FallbackStore`, wire `LLMHandlerDeps`, register `GET /api/llm/settings`, `PUT /api/llm/settings`, `GET /api/llm/models`
- [ ] T014 [US1] Write integration test in `app/backend/tests/integration/llmconfig/settings_api_test.go` — `GET /api/llm/settings` returns defaults; `PUT` with valid model → 200; `PUT` with invalid model → 400 `invalid_model`; `PUT` with timeout 0 → 400 `invalid_timeout`; `GET /api/llm/models` → proxied list

**Checkpoint**: `GET/PUT /api/llm/settings` and `GET /api/llm/models` work. US1 acceptance scenarios 1 and 3 pass.

---

## Phase 4: User Story 2 — Cloud LLM Fallback (Priority: P2)

**Goal**: `FallbackRouter` wrapping `SvcAdapter` — transparent local→cloud fallback with WebSocket notification

**Independent Test**: With local LLM enabled and a mock SvcAdapter: (1) local success → response returned, `used_fallback: false`; (2) local timeout → cloud called, FallbackStore receives `reason: timeout`, WebSocket event emitted; (3) local `model_error` → cloud called, FallbackStore receives `reason: model_error`

### Implementation for User Story 2

- [ ] T015 [US2] Implement `FallbackRouter` struct in `app/backend/internal/llmconfig/fallback.go` — holds `*embedding.SvcAdapter`, `*SettingsStore`, `*FallbackStore`, `*websocket.Hub`, `cloudModel`, `cloudEmbed` fields; constructor `NewFallbackRouter` (data-model.md §2.3)
- [ ] T016 [US2] Implement `FallbackRouter.Embed(ctx, texts []string) ([][]float32, error)` in `app/backend/internal/llmconfig/fallback.go` — load settings (cached TTL 5s); if local enabled: call adapter with local embed model under `context.WithTimeout`; on error → `classifyError` → `FallbackStore.Record` → `hub.Broadcast` → retry with cloud embed model
- [ ] T017 [US2] Implement `FallbackRouter.Complete(ctx, prompt string) (string, error)` in `app/backend/internal/llmconfig/fallback.go` — same pattern as Embed but for generative model; set `llm_info` context value for handler extraction
- [ ] T018 [P] [US2] Implement `classifyError(err error) string` in `app/backend/internal/llmconfig/fallback.go` — maps context deadline exceeded → `"timeout"`, gRPC `ResourceExhausted` → `"resource_exhaustion"`, gRPC `Unavailable` → `"model_unavailable"`, other → `"model_error"`
- [ ] T019 [P] [US2] Implement settings cache (5s TTL) in `FallbackRouter` — private `cachedSettings`, `cacheExpiry time.Time`; use `sync.Mutex` to protect; no package-level global state
- [ ] T020 [US2] Verify `FallbackRouter` satisfies `retrieval.EmbeddingRuntime` and `retrieval.LLMClient` interfaces in `app/backend/internal/llmconfig/fallback.go` — add compile-time `var _ retrieval.EmbeddingRuntime = (*FallbackRouter)(nil)` assertions
- [ ] T021 [US2] Replace `embedRuntime` and `llmClient` injection points in `app/backend/cmd/main.go` with `FallbackRouter` instance — wrap existing `SvcAdapter`; pass `hub`, `SettingsStore`, `FallbackStore`, cloud model names from `Config`
- [ ] T022 [US2] Write unit tests for `FallbackRouter` in `app/backend/tests/unit/llmconfig/fallback_test.go` — table-driven with mock `SvcAdapter`: (a) local disabled → cloud called directly; (b) local success → cloud NOT called; (c) local context timeout → cloud called, FallbackStore.Record called with `reason: timeout`; (d) local `model_error` → cloud called, reason mapped; (e) cloud also fails → error returned (no infinite loop)
- [ ] T023 [US2] Write unit test for WebSocket notification in `app/backend/tests/unit/llmconfig/fallback_test.go` — mock hub; on fallback, `hub.Broadcast` called with `{"type":"llm_fallback","payload":{...}}` (contracts/api.md §6)

**Checkpoint**: `FallbackRouter` unit-tested. Existing retrieval pipeline unchanged. US2 acceptance scenarios 1, 2, 3 pass via unit tests.

---

## Phase 5: User Story 3 — Model Management (Priority: P3)

**Goal**: Fallback event history API for monitoring + richer model metadata in listing

**Independent Test**: `GET /api/llm/fallback-events` returns recent events in `created_at DESC` order; `limit` param honored; events contain correct `reason`, `local_model`, `cloud_model`, `latency_ms`

### Implementation for User Story 3

- [ ] T024 [P] [US3] Implement `GET /api/llm/fallback-events` handler in `app/backend/internal/llmconfig/handler.go` — parse `limit` param (default 20, max 100), call `FallbackStore.ListRecent`, return `{"events":[...],"total":N}` (contracts/api.md §4)
- [ ] T025 [US3] Register `GET /api/llm/fallback-events` route in `app/backend/cmd/main.go`
- [ ] T026 [P] [US3] Extend `GET /api/llm/models` response to include `size_bytes` if available from `llmsvc.ModelMetadata.Metadata` map — no change to contract shape, only optional field populated (contracts/api.md §3, data-model.md §2.4 `ModelInfo.SizeBytes`)
- [ ] T027 [US3] Write integration test in `app/backend/tests/integration/llmconfig/settings_api_test.go` — insert 3 fallback events, call `GET /api/llm/fallback-events?limit=2`, verify 2 returned newest-first; verify `GET /api/llm/fallback-events` default limit = 20

**Checkpoint**: Full P3 story complete. All three user stories independently testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Hardening, error handling, and secrets hygiene across all stories

- [ ] T028 [P] Audit all log lines in `app/backend/internal/llmconfig/` — confirm no model paths (only names), no API keys, no raw error stack traces exposed to clients
- [ ] T029 [P] Add request-scoped context key `llmInfoKey` for passing `LLMInfo` from `FallbackRouter.Complete` to `handlers_knowledge.go` — ensure no global mutable state; document in `app/backend/internal/llmconfig/handler.go`
- [ ] T030 Verify all error responses from `/api/llm/` endpoints match the error shape `{"error":"<code>","message":"<text>"}` (contracts/api.md §7) — no raw stack traces, no model file paths in messages
- [ ] T031 [P] Run `go vet ./internal/llmconfig/...` and `go test ./internal/llmconfig/...` — confirm 0 errors; target coverage >80% for `fallback.go`, >90% for `settings.go`
- [ ] T032 Run end-to-end smoke test per quickstart.md §4: migrate DB → start service → `PUT /api/llm/settings` enable local → `GET /api/llm/models` → `POST /api/knowledge/query` → verify `llm_info` in response → kill llm-svc mid-request → verify fallback event in `GET /api/llm/fallback-events`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **blocks all user story phases**
- **Phase 3 (US1)**: Depends on Phase 2 — primary MVP path
- **Phase 4 (US2)**: Depends on Phase 2 + T004 (SettingsStore) — can begin after Phase 2; benefits from US1 handler wiring (T013) but FallbackRouter itself is independent
- **Phase 5 (US3)**: Depends on Phase 2 + T005 (FallbackStore); independent of US1/US2 implementation
- **Phase 6 (Polish)**: Depends on all desired user stories complete

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2. Independent — no US2/US3 dependency.
- **US2 (P2)**: Can start after Phase 2. T021 (wiring in main.go) benefits from T013 (US1 route registration) being done first — otherwise wire independently.
- **US3 (P3)**: Can start after Phase 2 + T005. T024–T027 are all independent of US1/US2 routes.

### Within Each Phase

- Data stores (T004, T005) → before router/handlers
- Handler implementation → before route registration (T013, T025)
- `FallbackRouter` (T015–T020) → before wiring into main.go (T021)

### Parallel Opportunities

Within **Phase 2**: T004 and T005 can run in parallel (different files)

Within **Phase 3** (US1): T008 (types) and T009/T010/T011 are sequential; T012 (knowledge query extension) can run parallel to T009–T011 since it touches a different file

Within **Phase 4** (US2): T018 (`classifyError`) and T019 (cache) can run in parallel; T022/T023 (tests) can run in parallel after T015–T020 complete

Within **Phase 5** (US3): T024, T026 can run in parallel (handler + model listing enrichment are in same file but different functions — coordinate)

---

## Parallel Example: User Story 2

```bash
# After T015 (FallbackRouter struct) complete, launch in parallel:
Task T016: "Implement FallbackRouter.Embed in fallback.go"
Task T018: "Implement classifyError in fallback.go"  # coordinate line ranges
Task T019: "Implement settings cache in FallbackRouter" # coordinate line ranges

# After T015–T020 complete, launch tests in parallel:
Task T022: "Unit tests - table-driven FallbackRouter mock scenarios"
Task T023: "Unit tests - WebSocket notification on fallback"
```

---

## Implementation Strategy

### MVP (User Story 1 + foundations only — 14 tasks)

1. Complete Phase 1 (T001–T003)
2. Complete Phase 2 (T004–T007)
3. Complete Phase 3 (T008–T014)
4. **STOP and VALIDATE**: Settings API works, models list, knowledge query has `llm_info`
5. Demo: configure local LLM → query → see `llm_info.mode` in response

### Full Feature (all 3 user stories — 32 tasks)

1. Setup + Foundational (Phase 1–2)
2. US1 — Settings + model listing (Phase 3)
3. US2 — FallbackRouter + WebSocket (Phase 4) → highest reliability value
4. US3 — Fallback event history (Phase 5) → monitoring/observability
5. Polish (Phase 6)

### Parallel Team Strategy

With 2 developers after Phase 2:
- Dev A: Phase 3 (US1 — Settings API, handlers, wiring)
- Dev B: Phase 4 (US2 — FallbackRouter struct, Embed, Complete, tests)
Both merge → Phase 5 (US3) + Phase 6 (Polish) together

---

## Notes

- [P] tasks = different files or clearly non-overlapping code regions; safe to run concurrently
- [Story] label maps each task to its user story for traceability to spec.md acceptance scenarios
- `FallbackRouter` never crashes the request — on double-failure (local + cloud both error), return cloud error upstream
- Model name stored in `llm_settings` is always a **name** (e.g., `llama-3-8b-q4`), never a file path
- Secrets rule: no API keys, no model file paths in any log line or error message sent to client
- SC-004 (WebSocket notification within 1s of fallback): `hub.Broadcast` is synchronous in the existing hub implementation — this is met automatically
- Run `go test ./...` from `app/backend/` before each Phase 6 step
