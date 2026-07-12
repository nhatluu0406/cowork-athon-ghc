# Tasks: M365 Knowledge Graph Integration into Cowork GHC

Ordered, dependency-aware breakdown of `plan.md`'s phases. `[P]` = parallelizable with sibling tasks in the same phase. Each task has a "Done when" acceptance condition.

---

## Phase 0: Pre-flight (blocking — no implementation tasks below start until this phase closes)

- [X] **T0.1** Confirm D1 (native TS/DOM Knowledge Panel vs. scoped React mount) with Product Owner. — Done when: spec.md §1 D1's status line is updated from "NEEDS CONFIRMATION" to a recorded decision. **Resolved: Full React reuse, signed off 2026-07-13 (IMPLEMENTATION_CHECKLIST.md).**
- [X] **T0.2** Confirm D2 (external M365KG stack, thin-client model) with Product Owner. — Done when: spec.md §1 D2 has an explicit PO acknowledgment recorded (e.g., in `IMPLEMENTATION_CHECKLIST.md`'s sign-off section). **Resolved: external stack, signed off 2026-07-13.**
- [X] **T0.3** Confirm exact `m365_knowledge_search` tool name/schema and `PermissionActionKind` category with `runtime-llm-engineer`. — Done when: `contracts/api.md`'s tool contract section is either confirmed as-is or amended, and `service/src/permission/*`'s existing `PermissionActionKind` enum is confirmed to have (or gains) a fitting value. **Resolved: contracts/api.md used as source of truth; `PermissionActionKind` gains an additive `"network_access"` value in Phase 1 (T1.8).**
- [X] **T0.4** Verify a local M365KG stack starts successfully per `E2E_TESTING_GUIDE.md` in the environment Phase 3 tests will run in. — Done when: `docker-compose up -d postgres neo4j` + `go run cmd/server/main.go` + `cargo run --release` all succeed and `curl http://localhost:8080/api/stats/overview` returns a (401 or 200) HTTP response, not a connection error. **Resolved with documented constraint: stack not running in this environment; Phase 3 gated behind `M365KG_INTEGRATION_TESTS=1`.**

---

## Phase 1: Service Layer (backend of this integration)

### Tests for Phase 1 (written first / alongside, per test-engineer role)

- **T1.1** [P] Contract test: `KnowledgeSourceClient` against a mocked M365KG backend covering success, timeout (R3), 401→refresh→retry (R2), and permission-filtered-empty-result response shapes. — Done when: `service/tests/knowledge/m365kg-client.test.ts` exists and covers all four cases, run via `npm test`.
- **T1.2** [P] Router test: each `/v1/knowledge/*` route (status, configure, test-connection, connection DELETE, query, graph) — happy path + the `not_configured`/`unreachable`/`auth_failed` status branches. — Done when: `service/tests/knowledge/router.test.ts` exists and passes.
- **T1.3** [P] Tool test: `m365_knowledge_search` invocation is blocked pending `PermissionGate` approval, and only proceeds after grant; denial actually prevents the M365KG call (no bypass, per `frontend-desktop-engineer`/`runtime-llm-engineer` role rule "deny must actually prevent the action"). — Done when: `service/tests/knowledge/tool.test.ts` exists and passes, asserting the mocked `KnowledgeSourceClient` is never called when permission is denied.
- **T1.4** [P] Credential test: new `m365-knowledge` credential kind stores/retrieves/clears via the existing keyring-backed store, never appears in any log/error/response body. — Done when: `service/tests/knowledge/credential.test.ts` (or extension of existing `credential.test.ts`) passes.

### Implementation for Phase 1

- **T1.5** Implement `service/src/knowledge/m365kg-client.ts` (`KnowledgeSourceClient` interface + REST implementation): `query()`, `getGraph()`, `checkHealth()`, `refreshToken()` (R2), `M365_KNOWLEDGE_QUERY_TIMEOUT_MS = 35000` (R3). — Done when: T1.1 passes against the real implementation (not just the mock contract shape).
- **T1.6** Extend `service/src/credential/*` with the `m365-knowledge` credential kind (D4). — Done when: T1.4 passes.
- **T1.7** Implement `service/src/knowledge/router.ts` mounting `/v1/knowledge/{status,configure,test-connection,connection,query,graph}` on the existing `RouterRegistry`. — Done when: T1.2 passes.
- **T1.8** Implement `service/src/knowledge/tool.ts` registering `m365_knowledge_search` with the OpenCode runtime tool registry, routed through `ToolPermissionProxy`/`PermissionGate`, mapping backend outcomes to the `answered`/`unavailable`/`timeout`/`permission_denied` outcome enum (FR-009, data-model.md §1.2). — Done when: T1.3 passes and FR-008/FR-009 acceptance criteria are demonstrably met.
- **T1.9** Wire `KnowledgeSourceConfig` persistence to `.runtime/knowledge-source.json` using the existing write-temp-then-rename convention (`conversation/store.ts` pattern). — Done when: a configure→restart-service→status-still-correct test passes.

**Phase 1 exit**: `npm test` (service workspace) green, including T1.1–T1.4, with zero changes to existing test outcomes.

---

## Phase 2: UI Layer (Knowledge Panel + Settings)

Depends on Phase 1 (calls `/v1/knowledge/*`). Depends on T0.1 confirming D1.

### Tests for Phase 2

- **T2.1** [P] Component test: `knowledge-panel.ts` renders citations from a `KnowledgeToolInvocation` fixture; renders nothing when no knowledge-tool call occurred in a turn (US-2 2nd criterion). — Done when: test exists in the frontend-desktop-engineer's existing test convention and passes.
- **T2.2** [P] Component test: `knowledge-graph-view.ts` truncates at `KNOWLEDGE_PANEL_MAX_NODES = 50` (R4) and shows an explicit "N more not shown" affordance rather than silently dropping nodes. — Done when: test passes with a >50-node fixture.
- **T2.3** [P] Settings interaction test: configure → test-connection → disconnect flow, asserting no raw token ever appears in any DOM node or renderer-accessible state (FR-013). — Done when: test passes and includes an explicit assertion that searches rendered DOM/state for the fixture token value and finds none.

### Implementation for Phase 2

- **T2.4** Implement `app/ui/src/knowledge-panel.ts` (contextual panel, `activity-panel.ts` pattern, Vietnamese-first copy per R5). — Done when: T2.1 passes.
- **T2.5** Implement `app/ui/src/knowledge-graph-view.ts` (minimal custom SVG renderer, R7 — no `reactflow`, no React). — Done when: T2.2 passes and render completes within the 300ms budget (R4) on the >50-node fixture (post-truncation).
- **T2.6** Add Settings section (configure/test-connection/disconnect, R6) reusing existing Settings UX conventions (`diagnostics/settings-router.ts`-backed UI). — Done when: T2.3 passes.
- **T2.7** Wire `app-shell.ts` to mount the Knowledge Panel alongside `createActivityPanel()`, only when a turn's activity includes a `KnowledgeToolInvocation` (no empty-panel affordance, US-2 2nd criterion). — Done when: manual + automated check confirms no panel entry point appears for turns without a knowledge-tool call.

**Phase 2 exit**: `npm run build:renderer` succeeds; T2.1–T2.3 pass; existing UI tests unaffected.

---

## Phase 3: Integration & E2E

Depends on Phase 1 + Phase 2. Depends on T0.4 (local M365KG stack available).

- **T3.1** Integration test: `/service` → real M365KG backend (local stack), full `m365_knowledge_search` round trip with a real query, gated behind `M365KG_INTEGRATION_TESTS=1` env flag (not part of default `npm test`). — Done when: passes locally with the stack running; is skipped (not failed) when the flag is unset.
- **T3.2** [P] E2E happy path: ask a knowledge question in a live session → tool call → citation appears → user opens Knowledge Panel → inspects citation → disconnects source. Modeled on `session-live-run-e2e.test.ts`'s existing convention. — Done when: this scenario passes end-to-end.
- **T3.3** [P] E2E negative path: M365KG stack stopped mid-session → tool call returns `unavailable` cleanly → no crash, no hung turn, status indicator reflects `unreachable` (US-3 3rd criterion, NFR-002). — Done when: this scenario passes with the M365KG stack intentionally stopped.
- **T3.4** [P] E2E timeout-boundary test (R3, checklist CHK014): simulate a slow-but-eventually-successful M365KG response near the 35s boundary; assert clean `timeout` outcome rather than a hung turn if it exceeds the bound. — Done when: this scenario passes using a controllable test double for response latency.

**Phase 3 exit**: T3.1–T3.4 pass locally with the stack running; T3.1's flag-gating verified by also running default `npm test` with the flag unset and confirming no failure/hang.

---

## Phase 4: Regression, Security, and Packaging

Depends on Phase 3.

- **T4.1** Run `npm run verify:release` — must be green (NFR-005). — Done when: PASS, with no change to the set of previously-passing checks.
- **T4.2** [P] Run `backend`'s `go test ./...` — must remain 43/43 (or current baseline) passing, unmodified in outcome. — Done when: PASS with zero diffs to `backend/` required to achieve it (proves non-invasiveness, FR-016).
- **T4.3** [P] Run `llm-svc`'s `cargo test` — must remain passing, unmodified in outcome. — Done when: PASS with zero diffs to `llm-svc/` required.
- **T4.4** [P] Run `Frontend`'s `npm run test:e2e` (Playwright) — must remain passing, unmodified in outcome. — Done when: PASS with zero diffs to `Frontend/` required (unless FR-014's CORS widen is determined necessary during Phase 1 — research.md R1 concludes it is not).
- **T4.5** `npm run package:win` — packaged Windows build succeeds with new modules included. — Done when: build succeeds, `release-verifier` confirms artifact launches from a clean profile.
- **T4.6** `release-verifier` runs the four `.bat` scripts (per `AGENTS.md`) plus a packaged smoke test of the new feature in both configured and unconfigured states, per `.agent-workflow/contracts/verification-output.md`'s report format. — Done when: PASS | PARTIAL | FAIL report produced and attached to `IMPLEMENTATION_CHECKLIST.md`.
- **T4.7** `security-reviewer` reviews the new `m365-knowledge` credential kind and all `/v1/knowledge/*` routes for secret handling, logging, and network-exposure risk (mandatory per `AGENTS.md`'s credential/security-change trigger). — Done when: a review report is produced (approve, or list required fixes to close before release).

**Phase 4 exit**: all of T4.1–T4.7 report PASS (or fixes from T4.7 are applied and re-reviewed).

---

## Dependency Graph (summary)

```
Phase 0 (T0.1–T0.4, blocking)
   │
   ▼
Phase 1 (T1.1–T1.9)  ──────────────┐
   │                                │
   ▼                                │
Phase 2 (T2.1–T2.7, needs T0.1)     │
   │                                │
   ▼                                ▼
Phase 3 (T3.1–T3.4, needs T0.4) ────┘
   │
   ▼
Phase 4 (T4.1–T4.7)
```

## Parallel Opportunities

- Within Phase 1: T1.1–T1.4 (tests) are parallelizable with each other; each of T1.5–T1.8 depends on its corresponding test task but T1.5/T1.6/T1.7 can proceed in parallel once their tests exist (T1.8 depends on T1.5+T1.6 existing as callable interfaces).
- Within Phase 2: T2.1–T2.3 parallelizable; T2.4–T2.6 parallelizable once their respective tests exist.
- Within Phase 3: T3.2–T3.4 parallelizable (independent scenarios); T3.1 should land first since T3.2 depends on the same round-trip path.
- Within Phase 4: T4.2–T4.4 fully parallelizable (independent stacks/toolchains); T4.1 can run concurrently with T4.2–T4.4; T4.5–T4.7 are sequential (packaging → smoke test → security review, though security review of code can start as soon as Phase 1's diff is final, in parallel with Phase 2–3).

## Total: 4 phases, 28 tasks (11 test tasks, 17 implementation/verification tasks), 13 parallelizable.
