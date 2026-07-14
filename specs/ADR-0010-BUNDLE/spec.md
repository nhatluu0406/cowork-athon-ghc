---
title: "ADR 0010 Remaining Work: M365KG Stack One-Time Init & Packaging Wiring"
document_type: "specification"
language: "en"
status: "ready-for-implementation"
---

# ADR 0010 Remaining Work: Stack Initialization & Packaging Integration

**Scope:** Complete the M365KG stack bundling feature (ADR 0010) by implementing one-time initialization logic and electron-builder packaging wiring.

**Context:** ADR 0010 designed the supervisor lifecycle, provisioning (download+verify), and extraction for Windows portable binaries. Implementation completed and tested at lifecycle/provisioning module level (service/src/knowledge/stack/). Remaining: application-layer integration (init at first launch, packaging).

**Acceptance criteria:**
- Postgres cluster initialized (`initdb`) on first provision, idempotent
- Neo4j initial password set (`neo4j-admin dbms set-initial-password`) on first provision
- Backend database migrations run against initialized Postgres (via Go binary's own migration tooling)
- Init state persisted (flag in `.runtime/m365kg-init.done` or similar)
- electron-builder.yml updated: provisioning/init wired into app startup sequence (or first-run hook)
- Smoke test: app launches → M365KG stack started + initialized → ready for queries
- No changes to REQ-205 Phase 1–3 test suite (m365kg-integration.test.ts); new tests are optional but welcome

**Non-scope:**
- Changing the provisioning/sources/stack-supervisor modules themselves (already complete, tested)
- Reverse D2 decision (already done, documented in ADR 0010 + spec.md D2')
- Performance tuning or runtime optimization of bundled processes
