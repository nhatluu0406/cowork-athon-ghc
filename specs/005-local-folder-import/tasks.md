# Tasks: Local Folder Import (005)

**Input**: Design documents from `specs/005-local-folder-import/`

**Sources**: spec.md (6 user stories), plan.md, data-model.md, contracts/api.md, quickstart.md, research.md

**Branch**: `005-local-folder-import`

**Module path**: `github.com/rad-system/m365-knowledge-graph`

---

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no shared state dependency)
- **[US#]**: Maps to user story from spec.md
- Exact file paths included in every task

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Migrations, go.mod dependencies, and new package skeleton.

- [ ] T001 Add new Go dependencies to `app/backend/go.mod`: `github.com/ledongthuc/pdf`, `github.com/saintfish/chardet`, `golang.org/x/text` (check if `excelize` and `go-docx` already present)
- [ ] T002 Create migration file `app/backend/migrations/005_local_import.sql` — tables `local_sources`, `import_jobs`, `local_files`; ALTER `chunks` ADD COLUMN `local_file_id UUID NULL REFERENCES local_files(id) ON DELETE CASCADE`; DROP NOT NULL on `chunks.file_id`; add CHECK constraint `chunks_source_xor`; indexes (see data-model.md §1)
- [ ] T003 [P] Create package skeleton `app/backend/internal/localimport/` with empty files: `source.go`, `job.go`, `file.go`, `scanner.go`, `path.go`, `encoding.go`, `extractor.go`, `processor.go`, `dispatcher.go`, `neo4j.go`, `handler.go`
- [ ] T004 [P] Create Neo4j constraint migration `app/backend/migrations/005_local_import_neo4j.cypher` — `LocalDocument` uniqueness constraint on `local_file_id`, `LocalSource` node schema (data-model.md §2)

**Checkpoint**: `go mod tidy` passes; migration SQL is syntactically valid; package files compile (empty bodies)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core path validation, CRUD stores, and entity types — required by ALL user stories.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [X] T005 Implement Go types in `app/backend/internal/localimport/source.go`: `LocalSource` struct, `CreateSourceRequest`, `PatchSourceRequest`, `LocalSourceStore` with `Create`, `List`, `Get`, `Update`, `Delete`, `UpdateStats`, `SetStatus` methods backed by PostgreSQL `local_sources` table
- [X] T006 Implement Go types in `app/backend/internal/localimport/job.go`: `ImportJob` struct, `JobStatus` constants (`queued`/`running`/`completed`/`failed`/`stale`), `JobProgress`, `ImportJobStore` with `Create`, `UpdateStatus`, `UpdateProgress`, `List`, `Get`, `MarkStaleJobs` methods backed by PostgreSQL `import_jobs` table
- [X] T007 Implement Go types in `app/backend/internal/localimport/file.go`: `LocalFile` struct, `ScanEntry`, `DeltaResult`, `DeltaAction` constants, `LocalFileStore` with `Upsert`, `GetByRelPath`, `ListBySource`, `Delete` methods backed by PostgreSQL `local_files` table
- [X] T008 Implement `app/backend/internal/localimport/path.go`: `ValidateSourcePath(userInput string) (string, error)` using `filepath.Abs` + `filepath.Clean` + UNC rejection; `RedactPath(absPath, sourceRoot string) string` returning rel_path only; `IsInsideRoot(path, root string) bool`
- [X] T009 [P] Write unit tests `app/backend/tests/unit/localimport/path_test.go`: valid absolute path, relative path rejected, `..` traversal rejected, UNC path rejected (`\\server\share`), Windows-style path on Linux (`C:\Users\...` rejected), symlink path accepted as-is (resolution tested separately), empty string rejected — target >90% coverage

**Checkpoint**: `go test ./internal/localimport/... -run TestPath` passes; `go test ./internal/localimport/... -run TestStore` passes with test DB

---

## Phase 3: User Story 1 — Basic Local Folder Import (Priority: P1) 🎯 MVP

**Goal**: Add a folder path as a local source and import its documents so they appear in knowledge search results.

**Independent Test**: POST `/api/local/sources` with a real temp directory → POST `/api/local/sync` → wait for job completion → GET `/api/knowledge/query?q=<known_term>` returns result with `source_type: "local"`.

### Implementation for US1

- [X] T010 [US1] Implement `app/backend/internal/localimport/scanner.go`: `Scanner` struct with `Walk(ctx) (<-chan ScanEntry, <-chan error)`; respect `Recursive`, `HiddenFiles`, `FollowSymlinks`, `MaxDepth` from `LocalSource`; use `filepath.WalkDir`; symlink detection via `os.Lstat`; skip `ModeSymlink` entries when `follow_symlinks=false`
- [X] T011 [P] [US1] Write unit tests `app/backend/tests/unit/localimport/scanner_test.go`: temp dir with nested structure, depth limit enforcement, hidden file include/exclude, non-recursive mode, permission-denied subdirectory skipped gracefully
- [X] T012 [US1] Implement `app/backend/internal/localimport/encoding.go`: `DetectEncoding(sample []byte) (charset string, confidence float64, err error)` using BOM check (UTF-8 `EF BB BF`, UTF-16 LE/BE) then `chardet.Detect()` on first 4KB; `ConvertToUTF8(data []byte, charset string) ([]byte, error)` using `golang.org/x/text/transform`; confidence threshold 0.7 → treat as binary
- [X] T013 [P] [US1] Upgrade `app/backend/internal/parsers/pdf.go`: replace regex-scraper stub with `github.com/ledongthuc/pdf` reader; preserve existing regex fallback when library returns empty/error; return `(string, error)`; streaming read for files >8MB
- [X] T014 [P] [US1] Inspect and upgrade `app/backend/internal/parsers/docx.go` and `app/backend/internal/parsers/xlsx.go` — if stubs, wire `go-docx` and `excelize` respectively; if real libraries already used, verify they handle streaming large files
- [X] T015 [US1] Implement `app/backend/internal/localimport/extractor.go`: `Extractor` struct; `Extract(ctx, absPath, mimeType string) (ExtractResult, error)`; route by MIME type and extension to `parsers.PDFParser` / `parsers.DocxParser` / `parsers.XlsxParser` / `parsers.TextParser`; binary detection via `net/http.DetectContentType` on first 512 bytes; set `IsBinary=true` and skip text extraction for non-supported MIME types
- [X] T016 [P] [US1] Write unit tests `app/backend/tests/unit/localimport/extractor_test.go`: PDF with known text, DOCX with known text, XLSX with known data, TXT UTF-8, binary PNG → metadata-only, unknown extension → metadata-only
- [X] T017 [US1] Implement `DeltaResolver` in `app/backend/internal/localimport/file.go`: `Classify(ctx, sourceID string, entry ScanEntry) (DeltaResult, error)` — compare `mtime`+`size` fast-path; if changed compute SHA-256 via `crypto/sha256`; classify as `DeltaAdded` / `DeltaModified` / `DeltaUnchanged` / `DeltaDeleted`
- [X] T018 [P] [US1] Write unit tests `app/backend/tests/unit/localimport/delta_test.go`: new file → Added, unchanged file → Unchanged (no hash computed), mtime changed same content → Unchanged (hash matches), content changed → Modified, file in DB not on disk → Deleted
- [X] T019 [US1] Implement `app/backend/internal/localimport/processor.go`: `Processor.Run(ctx, job ImportJob) error` — scan source → for each DeltaResult: skip Unchanged; for Added/Modified: Extract → Chunk (via `parsers.Chunker`) → batch INSERT into `chunks` with `local_file_id` → Upsert `local_files`; for Deleted: DELETE chunks + local_files row; update `import_jobs` progress every 50 files; call `localFileStore.Upsert` with final stats
- [X] T020 [US1] Implement `app/backend/internal/localimport/dispatcher.go`: `Dispatcher` with buffered channel queue (cap=100), `N = min(4, runtime.GOMAXPROCS(0))` workers; `Enqueue(job) error` returns `ErrQueueFull` if full; `Start(ctx)` launches worker goroutines; `MarkStaleJobs` called at startup; one running job per source enforced via `ImportJobStore.HasRunning(ctx, sourceID) bool`
- [X] T021 [US1] Implement HTTP handlers in `app/backend/internal/localimport/handler.go`: `POST /api/local/sources` (validate path via `ValidateSourcePath`, create source, return 201); `GET /api/local/sources` (list); `GET /api/local/sources/{id}` (get, 404 if missing); `DELETE /api/local/sources/{id}` (delete, 202 async cleanup); `POST /api/local/sync` (validate enabled, check running job, enqueue, return 202 with job_id); `GET /api/local/jobs` (list with filter); `GET /api/local/jobs/{id}` (get)
- [X] T022 [US1] Wire local handler and dispatcher into `app/backend/cmd/main.go`: instantiate `LocalSourceStore`, `ImportJobStore`, `LocalFileStore`, `Scanner`, `Extractor`, `Processor`, `Dispatcher`; register routes on router; call `dispatcher.MarkStaleJobs` at startup; call `dispatcher.Start(ctx)` before server listen
- [X] T023 [US1] Update `app/backend/internal/retrieval/stages.go` SemanticSearch SQL query: add LEFT JOIN `local_files lf ON lf.id = c.local_file_id`; add LEFT JOIN `m365_files mf ON mf.id = c.file_id`; populate `SourceType` (`"local"` | `"m365"`) and `DisplayPath` (`"Local: " + lf.rel_path` | `"M365: " + mf.file_name`) in `SearchResult` struct
- [X] T024 [US1] Write integration test `app/backend/tests/integration/localimport/import_test.go`: create temp dir with 5 TXT files containing known phrases; POST source; POST sync; poll job until completed; GET `/api/knowledge/query?q=<phrase>`; assert result has `source_type: "local"` and `display_path` matches filename

**Checkpoint**: Integration test passes. `go test ./tests/integration/localimport/...` green. M365 integration tests still pass (`go test ./tests/integration/connectors/...`).

---

## Phase 4: User Story 2 — Recursive Scanning with File Filters (Priority: P2)

**Goal**: Recursively scan subdirectories and filter by file extension so only relevant files are imported.

**Independent Test**: Create 3-level temp dir with PDF, DOCX, TXT, PNG files; configure source with `include_ext=[".pdf",".docx"]`, `recursive=true`; import; verify only PDF and DOCX chunks appear; PNG and TXT absent from results.

### Implementation for US2

- [X] T025 [US2] Extend `app/backend/internal/localimport/scanner.go` `Walk` method: apply `IncludeExt` / `ExcludeExt` filter per `ScanEntry`; normalise extensions to lowercase before comparison; log skipped file count to job metrics (`files_skipped++`); apply `MaxDepth` counter via WalkDir depth tracking
- [X] T026 [P] [US2] Write unit tests in `app/backend/tests/unit/localimport/scanner_test.go` (extend existing): `include_ext=[".pdf"]` → only PDF entries emitted; `exclude_ext=[".log"]` → `.log` files skipped; mixed case `.PDF` normalised and matched; very deep dir (>MaxDepth) → warning logged, entries up to depth included
- [X] T027 [US2] Verify and test `POST /api/local/sources` accepts `include_ext` and `exclude_ext` arrays and persists them to `local_sources` — add validation: each ext must start with `.`; add handler test in `app/backend/tests/unit/localimport/handler_test.go`

**Checkpoint**: `go test ./internal/localimport/... -run TestScanner` passes including filter cases.

---

## Phase 5: User Story 3 — Delta Sync for Changed Files (Priority: P2)

**Goal**: Re-import only changed files on subsequent syncs; detect added, modified, and deleted files.

**Independent Test**: Import 10 files; modify 2, add 1, delete 1; re-sync; verify job shows `files_modified=2`, `files_added=1`, `files_deleted=1`, `files_skipped` (unchanged) ≥ 7; search for content of modified file returns updated text.

### Implementation for US3

- [X] T028 [US3] Extend `app/backend/internal/localimport/processor.go` `Run` method: after walking, compute set of rel_paths from `LocalFileStore.ListBySource` → subtract current scan entries → mark missing as `DeltaDeleted`; DELETE their `chunks` rows (by `local_file_id`) then DELETE `local_files` row; update `import_jobs.files_deleted` counter
- [X] T029 [US3] Extend `app/backend/internal/localimport/processor.go` for Modified action: DELETE existing `chunks` rows for that `local_file_id` before inserting new chunks; update `local_files` row (`content_hash`, `mtime`, `file_size`, `chunk_count`, `updated_at`)
- [X] T030 [P] [US3] Write unit tests `app/backend/tests/unit/localimport/delta_test.go` (extend): full cycle — first import sets `local_files` rows; second import with one file changed → Modified; one file deleted → Deleted; one file new → Added; unchanged → Unchanged; verify DB state after each action
- [X] T031 [US3] Verify `GET /api/local/jobs/{id}` response includes `files_added`, `files_modified`, `files_deleted`, `files_skipped` with correct values — add assertions to integration test `import_test.go`

**Checkpoint**: Delta sync integration test passes; re-sync of unchanged corpus completes with `files_skipped = N, files_modified = 0`.

---

## Phase 6: User Story 4 — File Format Support with Automatic Extraction (Priority: P1)

**Goal**: Extract text from all 5 supported formats (PDF, DOCX, TXT, MD, XLSX) correctly and make content searchable.

**Independent Test**: Create one file of each format with the phrase "unique-test-phrase-XK7"; import; query for "unique-test-phrase-XK7"; get 5 results with `source_type: "local"` from 5 different files.

### Implementation for US4

- [X] T032 [US4] Extend `app/backend/internal/localimport/encoding.go`: handle MD files as UTF-8 text (same path as TXT); ensure `parsers.TextParser` returns full content for `.md` extension; verify heading preservation (headings remain as text, not stripped)
- [X] T033 [P] [US4] Write parser fixture tests `app/backend/tests/unit/localimport/extractor_test.go` (extend): create minimal fixture files (testdata/) for each format — PDF (ledongthuc), DOCX (go-docx), XLSX (excelize multi-sheet), TXT UTF-8, MD with headings; verify known phrases extracted; verify XLSX extracts from all sheets; verify MD headings in output
- [X] T034 [P] [US4] Add `app/backend/tests/unit/localimport/encoding_test.go`: UTF-8 BOM file, UTF-16 LE file, Latin-1 file, undetectable binary → `IsBinary=true`; verify all convertible files output valid UTF-8
- [X] T035 [US4] Extend integration test `app/backend/tests/integration/localimport/import_test.go`: add one fixture of each format; verify all 5 appear in query results with correct `source_type`

**Checkpoint**: All parser unit tests pass. Integration test with mixed formats passes.

---

## Phase 7: User Story 5 — Import Status and Progress Tracking (Priority: P3)

**Goal**: Show real-time progress of import jobs so users know how many files have been processed.

**Independent Test**: Trigger sync on folder with 100 files; poll `GET /api/local/jobs/{id}` every 500ms; verify `progress_pct` advances from 0 → 100 and `status` transitions `queued` → `running` → `completed`.

### Implementation for US5

- [ ] T036 [US5] Extend `app/backend/internal/localimport/processor.go`: update `import_jobs.progress_pct` every 50 files via `ImportJobStore.UpdateProgress`; set `files_total` at scan completion before processing begins; set `started_at` when processing begins, `finished_at` when done
- [ ] T037 [US5] Extend `app/backend/internal/localimport/job.go` `ImportJobStore`: add `UpdateProgress(ctx, id string, progress JobProgress) error` where `JobProgress` holds all counter fields; ensure progress update is a single SQL UPDATE (atomic)
- [ ] T038 [P] [US5] Add error collection to processor: when a file fails with `EPERM` / parser error, append redacted path (`RedactPath(absPath, sourceRoot)`) to `import_jobs.error_messages` array; increment `files_skipped`; continue processing; cap stored errors at 100 entries
- [ ] T039 [US5] Add `GET /api/local/jobs` query param support for `source_id` and `status` filters in `app/backend/internal/localimport/handler.go`; verify pagination `limit`/`offset` works correctly

**Checkpoint**: `GET /api/local/jobs/{id}` shows `progress_pct > 0` for in-flight job; `error_messages` populated when permission-denied files exist.

---

## Phase 8: User Story 6 — Manual Sync Trigger (Priority: P3)

**Goal**: Users can manually trigger a sync via the API; concurrent sync requests are rejected gracefully.

**Independent Test**: POST `/api/local/sync` while job is running → 409 response with `job_running` error code and `job_id` of running job.

### Implementation for US6

- [ ] T040 [US6] Add `ImportJobStore.HasRunning(ctx, sourceID string) (*ImportJob, error)` to `app/backend/internal/localimport/job.go`: SELECT from `import_jobs` WHERE `source_id=$1 AND status='running'` LIMIT 1
- [ ] T041 [US6] Extend `POST /api/local/sync` handler in `app/backend/internal/localimport/handler.go`: check `HasRunning` before enqueue; if running → return 409 with `{ "error": "job_running", "job_id": "<id>" }`; if disabled source → return 400 with `{ "error": "source_disabled" }`
- [ ] T042 [P] [US6] Add `DELETE /api/local/sources/{id}` cleanup: when source deleted, set `import_jobs.status = 'stale'` for any running jobs for that source; then DELETE `local_files` (cascades to `chunks` via FK), DELETE `local_sources`; return 202
- [ ] T043 [P] [US6] Add `PATCH /api/local/sources/{id}` enabled toggle: when `enabled=false`, subsequent `POST /api/local/sync` returns 400 `source_disabled`; re-enabling allows sync; verify in handler unit test

**Checkpoint**: Concurrent sync test: second POST returns 409 while first job is running. Source disable/enable cycle works correctly.

---

## Phase 9: Neo4j Integration (Priority: P2)

**Goal**: Create `LocalDocument` and `LocalSource` graph nodes for imported files, enabling graph-based retrieval.

**Independent Test**: After importing a file, run Neo4j query `MATCH (d:LocalDocument) RETURN d.local_file_id` and verify the imported file's UUID is present.

### Implementation for Neo4j

- [ ] T044 Implement `app/backend/internal/localimport/neo4j.go`: `LocalNeo4jClient` struct wrapping `neo4j.DriverWithContext`; `UpsertSource(ctx, source LocalSource) error` — MERGE `LocalSource {source_id}`; `UpsertDocument(ctx, f LocalFile, source LocalSource) error` — MERGE `LocalDocument {local_file_id}` SET properties; CREATE `(d)-[:PART_OF]->(s)` relationship; `DeleteDocument(ctx, localFileID string) error` — DETACH DELETE node
- [ ] T045 Wire `LocalNeo4jClient` into `app/backend/internal/localimport/processor.go`: call `UpsertSource` once per job start; call `UpsertDocument` for each Added/Modified file after chunk storage; call `DeleteDocument` for each Deleted file; errors in neo4j are logged and skipped (non-fatal for MVP — text search still works)
- [ ] T046 [P] Wire existing NLP entity extraction into processor: after extracting text for a file, call `nlp.Extractor.Extract(ctx, text)` to get entities; create `MENTIONS` relationships between `LocalDocument` and extracted `Entity` nodes in Neo4j

**Checkpoint**: Neo4j query after integration test returns `LocalDocument` nodes. Graph expander in retrieval pipeline can traverse from local doc.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Security hardening, performance, documentation.

- [ ] T047 [P] Security audit of `app/backend/internal/localimport/path.go`: add test cases for Windows long path (`\\?\C:\...`), null byte in path, path with only spaces, path pointing to `/proc` or `/sys` (Linux); ensure all rejected with clear error codes
- [ ] T048 [P] Performance: implement batch INSERT for chunks using `lib/pq` `pq.CopyIn` in `app/backend/internal/localimport/processor.go` for large imports (>500 chunks in one file); fallback to single INSERT if CopyIn fails
- [ ] T049 [P] Add `app/backend/cmd/routes_test.go` smoke tests for all new `/api/local/*` routes: verify 401 when no JWT; verify 404 for unknown source ID; verify 400 for invalid path
- [ ] T050 Run `go test ./...` — all tests pass; run `go vet ./...` — no warnings; run migration on a fresh DB and verify schema matches data-model.md
- [ ] T051 Update `docs/` with Vietnamese-language API overview for local folder import: create `app/backend/docs/local-import-api.md` summarising endpoints, setup steps, and search integration (data-model.md §4 as reference)

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)          → no dependencies; start immediately
Phase 2 (Foundational)   → depends on Phase 1; BLOCKS all user story phases
Phase 3 (US1 P1)         → depends on Phase 2; 🎯 MVP delivery point
Phase 4 (US2 P2)         → depends on Phase 2 + Phase 3 scanner
Phase 5 (US3 P2)         → depends on Phase 2 + Phase 3 processor
Phase 6 (US4 P1)         → depends on Phase 2 + Phase 3 extractor (T013–T015)
Phase 7 (US5 P3)         → depends on Phase 3 complete
Phase 8 (US6 P3)         → depends on Phase 3 complete
Phase 9 (Neo4j)          → depends on Phase 3 complete; can run in parallel with Phases 4–8
Phase 10 (Polish)        → depends on all desired phases complete
```

### User Story Dependencies (within Phase 2 complete)

- **US1 (P1, Phase 3)**: No dependency on other stories — implement first
- **US2 (P2, Phase 4)**: Needs scanner from US1 (T010) — extends it, not re-implements
- **US3 (P2, Phase 5)**: Needs processor from US1 (T019) — extends it
- **US4 (P1, Phase 6)**: Needs extractor from US1 (T015) — extends parser tests
- **US5 (P3, Phase 7)**: Needs job store and processor from US1 — adds progress hooks
- **US6 (P3, Phase 8)**: Needs handler from US1 (T021) — extends it

### Within Each Phase

Models/stores → extractor/scanner → processor → dispatcher → handler → wiring → tests

---

## Parallel Opportunities

### Phase 2 (Foundational) — can all start in parallel after T001:
```
T005 (source.go)    ‖  T006 (job.go)    ‖  T007 (file.go)    ‖  T008 (path.go) + T009 (path_test.go)
```

### Phase 3 (US1) — parallel after T005–T008 complete:
```
T010 (scanner.go)   ‖  T012 (encoding.go)   ‖  T013 (pdf.go)   ‖  T014 (docx/xlsx.go)
      ↓
T015 (extractor.go) + T016 (extractor_test.go)   ‖   T017 (delta) + T018 (delta_test.go)
      ↓
T019 (processor.go) → T020 (dispatcher.go) → T021 (handler.go) → T022 (main.go wiring) → T023 (retrieval) → T024 (integration test)
```

### After US1 complete — all lower-priority stories in parallel:
```
Phase 4 (US2)   ‖   Phase 5 (US3)   ‖   Phase 6 (US4)   ‖   Phase 9 (Neo4j)
```

---

## Implementation Strategy

### MVP First (P1 User Stories Only): Phases 1–3 + Phase 6

1. Complete Phase 1 (Setup) — ~30 min
2. Complete Phase 2 (Foundational stores + path) — ~2h
3. Complete Phase 3 (US1: basic import → search) — ~4h
4. **STOP and VALIDATE**: `go test ./tests/integration/localimport/...` green; manual POST→sync→query flow works
5. Add Phase 6 (US4: all 5 file formats) — ~2h
6. **MVP DEMO-READY**: import any local folder, search its content

### Incremental Delivery

- +Phase 4 (US2: filters/recursive) → power users with deep folder hierarchies
- +Phase 5 (US3: delta sync) → efficient re-sync without full re-import
- +Phases 7–8 (US5/US6: progress + concurrency guard) → production-readiness
- +Phase 9 (Neo4j graph) → graph-based retrieval and entity relationships

---

## Task Count Summary

| Phase | Tasks | User Story | Priority |
|-------|-------|-----------|---------|
| Phase 1 Setup | 4 | — | — |
| Phase 2 Foundational | 5 | — | — |
| Phase 3 US1 | 15 | US1 | P1 🎯 |
| Phase 4 US2 | 3 | US2 | P2 |
| Phase 5 US3 | 4 | US3 | P2 |
| Phase 6 US4 | 4 | US4 | P1 |
| Phase 7 US5 | 4 | US5 | P3 |
| Phase 8 US6 | 4 | US6 | P3 |
| Phase 9 Neo4j | 3 | — | P2 |
| Phase 10 Polish | 5 | — | — |
| **Total** | **51** | | |

Parallel [P] tasks: **18** (35% of total)

Independent test criteria defined for each of 6 user stories: ✅

MVP scope (Phases 1–3 + Phase 6): **28 tasks**, deliverable in ~1 development day.
