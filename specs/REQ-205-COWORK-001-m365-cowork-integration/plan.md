# Implementation Plan: M365 Knowledge Graph Integration into Cowork GHC

Companion to `spec.md` (requirements) and `research.md` (technical decisions R1–R7). This plan defines architecture, module ownership, phasing, risks, and governance compliance. It does not contain code.

---

## 1. Architecture Overview

```
┌─────────────────────────── Cowork GHC (this repo, unchanged process boundaries) ───────────────────────────┐
│                                                                                                              │
│  app/shell (Electron main)                                                                                  │
│   └─ starts /service in-process (ServiceController) — unchanged                                             │
│                                                                                                              │
│  app/ui (renderer, vanilla TS/DOM)                                                                          │
│   ├─ existing: app-shell.ts, activity-panel.ts, session-panel.ts, ...  — unchanged                          │
│   └─ NEW: knowledge-panel.ts  (native TS/DOM, D1)                                                            │
│        ├─ mounted alongside createActivityPanel() in app-shell.ts                                           │
│        ├─ calls /service via existing ServiceClient (no new IPC channel)                                    │
│        └─ NEW: knowledge-graph-view.ts (minimal SVG renderer, R7 — no reactflow, no React)                  │
│                                                                                                              │
│  service (Node/TS, loopback HTTP server)                                                                    │
│   ├─ existing routers — unchanged                                                                            │
│   ├─ NEW: src/knowledge/router.ts        → /v1/knowledge/*  (contracts/api.md)                              │
│   ├─ NEW: src/knowledge/m365kg-client.ts → KnowledgeSourceClient (REST client, D2/D3)                       │
│   ├─ NEW: src/knowledge/tool.ts          → registers m365_knowledge_search with the OpenCode runtime         │
│   ├─ reuses: permission/permission-gate.ts, files/tool-permission-proxy.ts (FR-008, no new bypass)           │
│   └─ reuses: credential/* (+1 credential kind "m365-knowledge", D4)                                          │
│                                                                                                              │
│  runtime (@cowork-ghc/runtime) — unchanged; tool registration is a /service-side concern (D3)                │
│                                                                                                              │
└──────────────────────────────────────────────┬───────────────────────────────────────────────────────────────┘
                                                 │  loopback HTTP, server-to-server (R1: no CORS involved)
                                                 ▼
┌─────────────────────────── M365 Knowledge Graph stack (REQ-204, unmodified, externally run) ────────────────┐
│  backend (Go)  ←gRPC→  llm-svc (Rust)          Neo4j            PostgreSQL                                  │
│  exposes: /api/knowledge/query, /api/entities, /api/graph/*, /api/m365/sync/status, /api/auth/token/refresh │
│  started independently via docker-compose (Postgres/Neo4j) + go run / cargo run (D2)                        │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Invariants this plan enforces** (from `.agent-workflow/roles/*.md`, applied to the new code):
- UI is a client of the local service — `knowledge-panel.ts` contains no business logic; all M365KG calls happen in `/service`.
- Permission checked at the execution boundary — `m365_knowledge_search` goes through `PermissionGate`, not just a UI confirmation.
- One credential store — reuses `@napi-rs/keyring` via existing `credential/*`, one new kind, not a parallel mechanism.
- Single owner per child-process lifecycle — Cowork does not adopt ownership of the M365KG stack's processes; `ServiceController`'s process ownership is untouched.
- No secrets in browser local storage / frontend state — `knowledge-panel.ts` never receives a raw token, only status + query results.

---

## 2. Module Ownership (maps to existing agent roles)

| Module | Owner role | New/Modified |
|---|---|---|
| `service/src/knowledge/m365kg-client.ts`, `router.ts`, `tool.ts` | `runtime-llm-engineer` | New |
| `service/src/credential/*` (+ `m365-knowledge` kind) | `runtime-llm-engineer` | Modified (additive) |
| `service/src/permission/*` (tool registration wiring only, no gate logic change) | `runtime-llm-engineer` | Modified (additive) |
| `app/ui/src/knowledge-panel.ts`, `knowledge-graph-view.ts` | `frontend-desktop-engineer` | New |
| `app/ui/src/app-shell.ts` (mount point) | `frontend-desktop-engineer` | Modified (additive) |
| Settings UI for M365 Knowledge Source | `frontend-desktop-engineer` | New (extends existing settings surface) |
| Test suites (unit/contract/integration/E2E) | `test-engineer` | New |
| Final packaged verification | `release-verifier` | N/A (runs existing process against the new build) |
| Architecture sign-off on D1/D2 override requests | `product-architect` | Advisory — see §6 |
| Security review of credential handling (D4) | `security-reviewer` | Required — "credential/security changes" trigger mandatory independent review per `AGENTS.md` |

No M365KG-side (`backend`/`llm-svc`/`Frontend`) module changes are planned. If R1's server-to-server assumption is wrong for some deployment (unlikely, see research.md), the only possible M365KG-side change is an additive `ALLOWED_ORIGINS` widen (FR-014) — owned by whoever maintains REQ-204, not this plan's roles.

---

## 3. Phased Implementation

### Phase 0 — Pre-flight (before any code)
- Confirm D1 and D2 with the Product Owner (spec.md §6, Open Questions 1–2). **Blocking.**
- Confirm exact `m365_knowledge_search` tool name/schema and its `PermissionActionKind` category with `runtime-llm-engineer` (Open Question 4).
- Verify a local M365KG stack can actually be started per `E2E_TESTING_GUIDE.md` in the dev environment used for integration testing (Phase 3 needs this to be true).

### Phase 1 — Service-layer client + tool (backend of this integration)
1. `service/src/knowledge/m365kg-client.ts` — `KnowledgeSourceClient` interface + REST implementation (contracts/api.md upstream table), including R2 (reactive refresh) and R3 (35s timeout).
2. `service/src/credential/*` — add `m365-knowledge` credential kind (D4).
3. `service/src/knowledge/router.ts` — `/v1/knowledge/status|configure|test-connection|connection|query|graph` (contracts/api.md).
4. `service/src/knowledge/tool.ts` — register `m365_knowledge_search`, wire through `ToolPermissionProxy`/`PermissionGate` (FR-008), implement FR-009's clean-degradation outcomes.
5. Unit + contract tests (mocked M365KG backend) for all of the above — `service/tests/knowledge/*.test.ts`, matching existing test file placement convention.
6. **Exit criterion**: `npm test` (service) green, including new suites; existing suites unaffected.

### Phase 2 — UI layer (Knowledge Panel + Settings)
1. `app/ui/src/knowledge-panel.ts` — contextual panel following the `activity-panel.ts`/File Work Review pattern (US-2), Vietnamese-first copy (R5).
2. `app/ui/src/knowledge-graph-view.ts` — minimal SVG node-link renderer, bounded to 50 nodes (R4/R7).
3. Settings additions for configure/test-connection/disconnect (US-3, R6), mounted alongside existing Settings sections.
4. `app-shell.ts` wiring — mount point only, no new IPC channel (renderer already talks to `/service` via `ServiceClient`).
5. Component/interaction tests per `frontend-desktop-engineer` conventions.
6. **Exit criterion**: `npm run build:renderer` succeeds; new component tests green; existing UI tests unaffected.

### Phase 3 — Integration & E2E
1. Integration tests exercising `/service` → real M365KG backend (local stack per D2), gated behind an env flag (e.g. `M365KG_INTEGRATION_TESTS=1`) since it requires the external stack running — not part of default `npm test`.
2. E2E scenario: ask a knowledge question in a live session → tool call → citation → Knowledge Panel inspection → disconnect. Modeled after `service/tests/session-live-run-e2e.test.ts`'s existing live-E2E convention.
3. Negative-path E2E: M365KG stack not running → clean degraded UX, no crash, no hung turn (US-1 2nd criterion, NFR-002).
4. **Exit criterion**: all Phase 3 tests pass locally with the M365KG stack running; negative-path test passes with it stopped.

### Phase 4 — Regression & Packaging
1. Run `npm run verify:release` — must remain green (NFR-005).
2. Run `backend`'s `go test ./...`, `llm-svc`'s `cargo test`, `Frontend`'s `npm run test:e2e` (Playwright) — must remain green, unmodified, proving zero regression on the M365KG side (NFR-005).
3. `npm run package:win` — packaged build succeeds with the new modules included.
4. `release-verifier` runs the four `.bat` scripts and a packaged smoke test including the new feature in both configured and unconfigured states.
5. `security-reviewer` reviews credential handling (D4) — mandatory per `AGENTS.md`'s "credential/security changes" trigger.
6. **Exit criterion**: PASS report from `release-verifier`, matching `.agent-workflow/contracts/verification-output.md`'s format.

---

## 4. Constitution / Governance Compliance

- `.specify/memory/constitution.md` is not this subsystem's governing document (spec.md D6); no formal gate applies from it. Its generically-sound practices (atomic writes, source traceability, no partial-state visibility) are honored anyway: `KnowledgeSourceConfig` writes are write-temp-then-rename (data-model.md §1.1), and citations always carry a `sourceRef` back to the M365KG record they came from (never anonymous knowledge).
- `AGENTS.md`/`CLAUDE.md` LEAN-mode default is honored: Phases 1–2 are implementable by a single engineer each without fan-out. Independent review is invoked only where the rules require it (credential handling → `security-reviewer`; this is a "large architecture change" by the rules' own definition → `product-architect` advisory sign-off on D1/D2 before Phase 0 exits, and `release-verifier` for final acceptance — not a broad multi-agent fan-out for routine work).
- `.agent-workflow/roles/*.md` boundaries are honored per §2's ownership table — no role's stated "Rules" are violated by this plan (e.g., no business logic in UI components, one credential store, permission enforced server-side).

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PO overrides D1 (wants real React reuse) after Phase 2 has started | Medium | High (rework) | Phase 0 explicitly blocks on D1 confirmation before Phase 2 begins. |
| M365KG stack unavailable in CI/dev environments used for Phase 3 | Medium | Medium | Phase 3 integration/E2E tests are gated behind an explicit env flag, not part of default `npm test` — Phase 1/2/4's default test runs never depend on the external stack being up. |
| M365KG backend response shape drifts from `contracts/api.md` in a future REQ-204 change | Low (REQ-204 is complete/frozen) | Medium | Contract tests in Phase 1 pin the expected shape; a REQ-204 change that breaks this integration would fail Cowork's contract tests, surfacing the break immediately rather than silently. |
| Packaging the new modules increases Cowork's installer size/startup time measurably | Low | Low | New modules are small (REST client + native DOM panel, no new framework per D1/R7); `ux-performance-reviewer` checks startup/re-render cost in Phase 4 as part of existing practice. |
| Tool timeout (R3, 35s) feels slow to users mid-conversation | Medium | Low | FR-009's clean degradation + a visible "still looking..." state (UX detail for `frontend-desktop-engineer` in Phase 2) rather than a silent hang. |
| Credential-store integration introduces a security regression | Low | High | Mandatory `security-reviewer` pass in Phase 4, scoped specifically to D4's new credential kind. |

---

## 6. Open Decisions Requiring Sign-off Before Implementation

Carried from `spec.md` §6 and `checklists/requirements-quality.md`:
1. D1 (native UI vs. scoped React mount) — **blocks Phase 2**.
2. D2 (external stack vs. bundled) — **blocks Phase 1** (changes the client's target entirely if overridden).
3. Settings scope for M365KG connection setup (spec.md Open Question 3) — blocks Phase 2's Settings UI shape, not Phase 1.
4. Exact tool name/schema sign-off from `runtime-llm-engineer` (spec.md Open Question 4) — blocks Phase 1 task T-1.4 (see `tasks.md`).
5. Roadmap recording (spec.md D5, Open Question 6) — does not block engineering work, but PO should decide whether `docs/product/productization-roadmap.md` gets a new entry.

---

## 7. Quickstart (for whoever picks up Phase 1)

```bash
# 1. Start the M365KG dependency stack (external, per D2 — see E2E_TESTING_GUIDE.md for full env)
docker-compose up -d postgres neo4j
(cd backend && go run cmd/server/main.go)
(cd llm-svc && cargo run --release)

# 2. Confirm it's reachable
curl http://localhost:8080/api/stats/overview   # will 401 without a token — that's expected pre-auth

# 3. Cowork side — existing dev loop, unchanged
npm run dev:renderer      # app/ui
npm test                  # service unit/contract tests (Phase 1/2 default — does not need the stack above)

# 4. Phase 3 only — integration tests against the real stack
M365KG_INTEGRATION_TESTS=1 npm test --workspace service
```

No new top-level script is required for Phases 1–2; Phase 3's integration flag is the only new invocation pattern.
