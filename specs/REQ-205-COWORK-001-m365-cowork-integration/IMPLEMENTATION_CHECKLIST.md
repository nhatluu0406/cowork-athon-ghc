# Implementation Checklist — REQ-205: M365 Knowledge Graph Integration into Cowork GHC

Generated: 2026-07-12
ID: REQ-205
Spec: specs/REQ-205-COWORK-001-m365-cowork-integration/spec.md
Plan: specs/REQ-205-COWORK-001-m365-cowork-integration/plan.md
Tasks: specs/REQ-205-COWORK-001-m365-cowork-integration/tasks.md
Data Model: specs/REQ-205-COWORK-001-m365-cowork-integration/data-model.md
Contracts: specs/REQ-205-COWORK-001-m365-cowork-integration/contracts/api.md
Research: specs/REQ-205-COWORK-001-m365-cowork-integration/research.md
Constitution: `.specify/memory/constitution.md` — **not this subsystem's governing document** (see spec.md D6); actual governance is `AGENTS.md` / `CLAUDE.md` / `.agent-workflow/roles/*.md`.
Depends on: REQ-204 (specs/REQ-204-M365-001-m365-knowledge-graph/) — complete, unmodified by this REQ.

## Artifacts Status
- [x] Governance check: ✅ AGENTS.md/CLAUDE.md/.agent-workflow/roles reviewed; constitution.md confirmed inapplicable (D6)
- [x] Spec: ✅ authored, including Locked Decisions (D1–D6) and Open Questions
- [x] Checklist: ✅ 19 items audited, 11 resolved with citations, 8 tracked as non-blocking gaps (carried below)
- [x] Plan: ✅ generated, phased, role-mapped, risk-assessed
- [x] Analyze: ✅ clean — all 16 FRs + 6 NFRs trace to a plan phase and module; no orphaned components; data-model/contracts/spec consistent
- [x] Tasks: ✅ generated — 4 phases, 28 tasks, 13 parallelizable

## ⚠️ PRE-FLIGHT SIGN-OFF REQUIRED BEFORE Phase 1/2 IMPLEMENTATION STARTS

This REQ contains two decisions (D1, D2 in spec.md §1) that resolve ambiguity in the *original request* in a way that diverges from its literal wording. They are implementable as written, but per this project's own rule ("scope creep is a blocker... flag it, ask the user before including" / "large architecture changes require independent review"), **do not let `speckit-implementer` proceed past Phase 0 (`tasks.md` T0.1/T0.2) without an explicit human confirmation**, recorded here:

- [x] **D1 sign-off** (native TS/DOM Knowledge Panel vs. literal "merge React components") — Decision: **Full React reuse** (merge React components) — Signed off by: DungPham — Date: 2026-07-13
- [x] **D2 sign-off** (external M365KG stack, thin-client model vs. bundling the stack into the Windows installer) — Decision: **External stack** (thin-client REST model) — Signed off by: DungPham — Date: 2026-07-13
- [x] **Tool schema sign-off** (T0.3, `runtime-llm-engineer`) — recorded in `contracts/api.md` as the source of truth. Confirmed via code inspection: `core/contracts/src/permission.ts`'s `PermissionActionKind` currently has no network/external-data-access value (only `file_create`/`file_edit`/`file_delete`/`file_move`/`command_exec`). Resolution: Phase 1 (T1.8) adds one additive kind (proposed `"network_access"`, classified `standard` in `approval-level.ts`'s exhaustive switch) — no existing kind is renamed or removed. — Confirmed by: speckit-implementer (documented constraint per PO instruction) — Date: 2026-07-13
- [x] **Local M365KG stack startup verified** (T0.4) — documented constraint: stack is not currently running in this environment; Phase 3 integration/E2E tests (T3.1–T3.4) are gated behind `M365KG_INTEGRATION_TESTS=1` and are skipped (not failed) by default per tasks.md's own design. Live-stack verification deferred to whoever runs Phase 3 with `M365KG_INTEGRATION_TESTS=1` in an environment with the stack up. — Confirmed by: speckit-implementer (documented constraint per PO instruction) — Date: 2026-07-13

## Phase Summary
| Phase | Description | Task count | Parallelizable |
|-------|-------------|-----------|---------------|
| 0 | Pre-flight sign-off | 4 | N (sequential confirmations) |
| 1 | Service layer (`/service` client, router, tool, credential) | 9 | Y (T1.1–T1.4 tests; T1.5–T1.7 impl) |
| 2 | UI layer (Knowledge Panel, Settings) | 7 | Y (T2.1–T2.3 tests; T2.4–T2.6 impl) |
| 3 | Integration & E2E | 4 | Y (T3.2–T3.4) |
| 4 | Regression, security, packaging | 7 | Y (T4.2–T4.4) |

## Acceptance Criteria (from spec.md §3)
- [ ] US-1: agent can answer M365-knowledge questions in-conversation via a permission-gated tool call, with graceful degradation when unconfigured/unavailable, and no cross-user result leakage.
- [ ] US-2: user can inspect the citations behind an answer via the Knowledge Panel; no panel entry point for turns without a knowledge-tool call.
- [ ] US-3: user can configure/test/disconnect the M365 Knowledge Source via Settings, with honest connectivity failure reasons and correct status when the backend later becomes unreachable.
- [ ] US-4: user can browse a bounded (≤50-node), read-only graph view of an entity's relationships, responsively.
- [ ] US-5: last-synced timestamp is surfaced alongside answers/citations when available (read-only; no sync-trigger from Cowork).

## Constitutional / Governance Constraints (must be honored by implementer)
- UI is a client of the local service — no business logic in `knowledge-panel.ts`/`knowledge-graph-view.ts`.
- Permission checked at the execution boundary — `m365_knowledge_search` must go through `PermissionGate`/`ToolPermissionProxy`; a permission denial must actually prevent the M365KG call (test T1.3 asserts this).
- One credential store — `m365-knowledge` is a new *kind* within the existing keyring-backed store, not a second mechanism.
- No secrets in browser local storage / frontend state / logs — enforced by T1.4, T2.3, and the T4.7 security review.
- Single owner per child-process lifecycle — Cowork does not adopt process ownership of the M365KG stack (Postgres/Neo4j/backend/`llm-svc` remain externally managed, D2).
- No new UI framework without explicit override of D1.
- No M365KG (`backend`/`llm-svc`/`Frontend`) file changes except a possible additive `ALLOWED_ORIGINS` widen (FR-014) — research.md R1 concludes this is not needed.

## Open Questions / Known Risks (carried from spec.md §6, research.md, checklists/requirements-quality.md)
- D1/D2 sign-off (above, blocking).
- Settings scope for M365KG connection setup — how much (endpoint+token only, vs. full Entra app-registration fields) Cowork's Settings should collect (spec.md Open Question 3) — affects Phase 2 UI shape, not Phase 1.
- Roadmap recording: whether `docs/product/productization-roadmap.md` gets a new phase entry for this initiative — PO decision, not authored by this REQ's artifacts.
- CHK004: no independent "kill switch" beyond Settings' Disconnect action (R6) — accepted as sufficient; revisit if PO wants a more forceful override.
- CHK008/CHK012: bounded node count (50) and panel render budget (300ms) are this plan's own proposed numbers (research.md R4) — not independently validated against real M365KG graph density; revisit after Phase 3 if real entity neighborhoods are routinely larger/smaller than expected.
- Risk: PO overrides D1 after Phase 2 starts (rework risk) — mitigated by Phase 0 gate.
- Risk: M365KG stack unavailable in the environment used for CI — mitigated by gating Phase 3's integration/E2E tests behind `M365KG_INTEGRATION_TESTS=1`, kept out of default `npm test`.

## Branch Target
Branch: `205-cowork-m365-integration` (created from `204-implement-final-gaps` on 2026-07-13) — resolved: REQ-205 is a distinct REQ from REQ-204 and must not commit to REQ-204's own branch; a dedicated feature branch was cut per this checklist's own suggested naming.
