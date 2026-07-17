# Requirements Quality Checklist: M365 Knowledge Graph Integration into Cowork GHC

**Purpose**: Validate the completeness, clarity, and consistency of `spec.md` — testing the requirements writing quality, not the implementation.
**Created**: 2026-07-12
**Feature**: [spec.md](../spec.md)

**Note**: Generated per the `/speckit.checklist` step. Validates whether REQ-205's requirements are documented completely and unambiguously enough to implement without guesswork.

## Requirement Completeness

- [x] CHK001 - Is the UI-framework mismatch between `/app/ui` (vanilla TS) and `/Frontend` (React) explicitly addressed rather than assumed? [Completeness] — Resolved: spec.md §1 D1, with rationale, rejected alternative, and an explicit override path.
- [x] CHK002 - Is the process/packaging model for the M365KG backend stack (bundled vs. external) explicitly decided? [Completeness] — Resolved: spec.md §1 D2.
- [x] CHK003 - Is the credential-storage mechanism for the new M365KG token specified, consistent with existing Cowork credential handling? [Completeness] — Resolved: spec.md §1 D4, FR-003, NFR-003.
- [ ] CHK004 - Is a rollback/disable path specified if the feature causes instability once shipped (e.g., a kill switch beyond "unconfigured by default")? [Completeness, Gap] — Not specified; recommend `plan.md` define whether D5's "off by default" is also independently toggle-able off *after* configuration, not just before.
- [ ] CHK005 - Are error-message copy/i18n requirements specified, given Cowork's existing UI strings are Vietnamese-first (`docs/product/current-status.md` uses `Đã đưa tệp vào ngữ cảnh` etc.)? [Completeness, Gap] — Not specified in spec.md; flag for `plan.md`/`tasks.md` to decide whether new Knowledge Panel strings follow the existing Vietnamese-first UI convention or are English-only for this feature.

## Requirement Clarity

- [x] CHK006 - Is "thin client" (D2) defined precisely enough to bound scope (i.e., does it list exactly which calls Cowork is and isn't allowed to make)? [Clarity] — Resolved: D2 body + FR-001/002 restrict `/service` to the Go backend's documented REST API only, explicitly excluding direct Neo4j/Postgres/`llm-svc` access.
- [x] CHK007 - Is "off by default" (D5) given a concrete activation condition? [Clarity] — Resolved: D5 — inert until endpoint + credential configured in Settings.
- [ ] CHK008 - Is "bounded node count" (US-4, NFR-004) given a specific number, or left to `plan.md`? [Clarity, Ambiguity] — Intentionally deferred to `plan.md`/`tasks.md` (a UI/UX sizing decision, not a requirements-level one) — tracked, not a defect.

## Requirement Consistency

- [x] CHK009 - Is Out-of-Scope's exclusion of "M365KG admin features" consistent with US-3's Settings-configuration story? [Consistency] — Resolved: Out of Scope explicitly distinguishes "consuming already-configured knowledge" (in scope, US-3) from "connection setup / delta-sync admin" (out of scope, remains M365KG Frontend's job) — Open Question 3 flags the one residual ambiguity (how much of a token/endpoint Cowork's Settings should collect).
- [x] CHK010 - Is FR-014 (CORS) consistent with D2/D3's stated integration path (service-to-service, not browser-to-service)? [Consistency] — Partially resolved: FR-014 itself flags that whether CORS work is needed at all depends on a `plan.md`-level decision (server-to-server calls from Node `/service` don't hit browser CORS); marked explicitly conditional rather than asserted as required, to avoid a false requirement.

## Acceptance Criteria Quality

- [x] CHK011 - Are US-1's degraded-state acceptance criteria measurable (not configured / permission not granted / permission-filtered results) rather than aspirational? [Acceptance Criteria Quality] — Resolved: US-1 criteria are stated as concrete Given/When/Then with observable outcomes (tool not invoked, prompt shown, no cross-user leakage).
- [ ] CHK012 - Is "responsive" (US-4, NFR-004) paired with a measurable latency/frame-budget target? [Measurability, Gap] — Not quantified in spec.md; recommend `plan.md` set a concrete bound (e.g., panel render time budget) before `tasks.md` treats this as done-able.

## Scenario Coverage

- [x] CHK013 - Is the "M365KG backend becomes unreachable mid-session" scenario covered? [Coverage] — Resolved: US-3's third acceptance criterion.
- [ ] CHK014 - Is a scenario defined for the M365KG backend returning a *slow but eventually successful* response near the tool-call timeout boundary (NFR-004)? [Coverage, Edge Case, Gap] — Not covered; recommend `tasks.md` include a timeout-boundary test case.
- [ ] CHK015 - Is a scenario defined for token expiry mid-session (M365KG JWT/Entra token expires while Cowork holds a cached credential)? [Coverage, Edge Case, Gap] — Not explicitly covered; D4 implies refresh-via-`/api/auth/token/refresh` exists on the M365KG side, but spec.md does not state Cowork's `/service` must call it proactively vs. reactively on 401. Recommend resolving in `plan.md` (added as `research.md` topic).

## Dependencies & Assumptions

- [x] CHK016 - Is the dependency on REQ-204 being complete explicitly verified rather than assumed? [Dependency] — Resolved: spec.md §0 cites REQ-204's own Phase 11 audit (Go 43/43, Rust 43/43 tests) as verified evidence, not an assumption.
- [x] CHK017 - Is the assumption that the M365KG stack is "independently running" made an explicit, testable dependency rather than an implicit expectation? [Assumption] — Resolved: §7 Dependencies states this as a runtime (not build) dependency, and D2/FR-004 require Cowork to detect and report its absence rather than assume presence.

## Ambiguities & Conflicts

- [x] CHK018 - Are the decisions that diverge from the user's literal original wording (D1) flagged for confirmation rather than silently substituted? [Ambiguity, Traceability] — Resolved: D1 carries an explicit "⚠️ NEEDS CONFIRMATION" marker and an override path; also listed in §6 Open Questions item 1.
- [ ] CHK019 - Is there a single owner and target resolution point (before `plan.md` finalization vs. before `tasks.md` vs. before implementation) assigned to each of the six Open Questions in §6? [Gap] — Partially resolved: each Open Question states which phase it blocks, but no named owner/date; acceptable for a same-session PO handoff, but `IMPLEMENTATION_CHECKLIST.md` should carry these forward explicitly so `speckit-implementer` does not silently pick a default.

## Outcome

11 of 19 items resolved with explicit spec.md citations; 8 remain as tracked gaps, all non-blocking for proceeding to `plan.md` (none represent a contradiction — all are either deferred-by-design to `plan.md`/`tasks.md`, or genuinely open questions already logged in spec.md §6). Proceeding to Planning phase is authorized; unresolved items are carried into `IMPLEMENTATION_CHECKLIST.md` as pre-flight items for the implementer/PO.
