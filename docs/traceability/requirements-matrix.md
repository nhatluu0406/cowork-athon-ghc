# Requirements Traceability Matrix

> **Document No.**: RAD-TRACE-001 &nbsp;|&nbsp; **Last Updated**: 2026-07-12

---

## Table of Contents

- [Requirements → Design Mapping](#requirements--design-mapping)
- [Requirements → Implementation Mapping](#requirements--implementation-mapping)
- [Requirements → Test Mapping](#requirements--test-mapping)
- [Defect Tracking (BUG)](#defect-tracking-bug)
- [Change Summary (2026-07-12)](#change-summary-2026-07-12)

---

## Requirements → Design Mapping

| ID | Summary | Spec | Plan | Status |
|---|---|---|---|---|
| REQ-204 | Enterprise Knowledge Graph from Microsoft 365 (Go backend + Rust `llm-svc` + React frontend) | [spec.md](../../specs/REQ-204-M365-001-m365-knowledge-graph/spec.md) | [plan.md](../../specs/REQ-204-M365-001-m365-knowledge-graph/plan.md) | Complete (per Phase 11 audit, 2026-07-12) |
| REQ-205 | Integrate M365 Knowledge Graph (REQ-204) into Cowork GHC — knowledge-tool + panel, thin-client architecture | [spec.md](../../specs/REQ-205-COWORK-001-m365-cowork-integration/spec.md) | [plan.md](../../specs/REQ-205-COWORK-001-m365-cowork-integration/plan.md) | Planned — pending D1/D2 sign-off (see IMPLEMENTATION_CHECKLIST.md) |

---

## Requirements → Implementation Mapping

| ID | Summary | Tasks | Branch | Status |
|---|---|---|---|---|
| REQ-204 | M365 Knowledge Graph build-out | [tasks.md](../../specs/REQ-204-M365-001-m365-knowledge-graph/tasks.md) | `204-implement-final-gaps` | Complete — Go 43/43 tests, Rust 43/43 tests, Frontend built w/ Playwright E2E |
| REQ-205 | Cowork GHC ↔ M365KG integration | [tasks.md](../../specs/REQ-205-COWORK-001-m365-cowork-integration/tasks.md) | TBD (see IMPLEMENTATION_CHECKLIST.md — likely a new branch, not `204-implement-final-gaps`) | Not started — Phase 0 pre-flight sign-off pending |

---

## Requirements → Test Mapping

| ID | Summary | Acceptance Criteria | Test Coverage | Status |
|---|---|---|---|---|
| REQ-204 | M365 Knowledge Graph | spec.md §16 E2E acceptance flow | Go unit/integration (`backend/tests`), Rust (`llm-svc/tests`), Playwright (`Frontend/tests/e2e`) | Passing (per tasks.md Phase 11 audit) |
| REQ-205 | Cowork GHC ↔ M365KG integration | spec.md §3 US-1–US-5 | Planned: `service/tests/knowledge/*` (unit/contract), gated integration tests (`M365KG_INTEGRATION_TESTS=1`), new E2E scenarios (tasks.md Phase 3) | Not yet written (Not Started) |

---

## Defect Tracking (BUG)

| ID | Summary | Root Cause | Fix Spec | Status |
|---|---|---|---|---|

_No BUG-XXX items filed yet._

---

## Change Summary (2026-07-12)

- Added REQ-204 (retroactive record): Enterprise Knowledge Graph from Microsoft 365 — complete, backfilled into this matrix for traceability continuity (Feature).
- Added REQ-205: Integrate the completed M365 Knowledge Graph into Cowork GHC as an optional, permission-gated knowledge source (tool + panel + settings), thin-client architecture, off by default (Feature).
