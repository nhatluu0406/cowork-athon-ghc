# Research & Technical Decisions: M365 Knowledge Graph Integration into Cowork GHC

Companion to `spec.md` §1 (Locked Decisions). Covers decisions not already resolved there, surfaced by the requirements-quality checklist (`checklists/requirements-quality.md` CHK004, CHK005, CHK008, CHK010, CHK012, CHK014, CHK015).

---

## R1 — Is a CORS change needed on the M365KG Go backend? (resolves FR-014 / CHK010)

**Question**: Cowork's `/service` will call the M365KG Go backend's REST API. Does this require widening `ALLOWED_ORIGINS` on the Go backend (`internal/api/middleware.go`, default `http://localhost:5173` per REQ-204 spec §12)?

**Finding**: `/service` runs as a Node.js `node:http` server (`service/src/server/http-service.ts`) making outbound HTTP requests to the M365KG backend from **server-side Node code**, not from a browser `fetch()` in `/app/ui`. CORS is a browser-enforced policy; a server-to-server HTTP client (e.g. Node's `fetch`/`http.request`) is not subject to it.

**Decision**: **No CORS change is required.** `/service`'s `KnowledgeSourceClient` calls the M365KG backend directly as a server-side HTTP client. FR-014 becomes a no-op for the default deployment topology; only re-examine it if a future iteration has `/app/ui` call the M365KG backend directly from the renderer (explicitly out of scope — violates "UI is a client of the local service" and D2/D3).

---

## R2 — Token refresh strategy for the M365KG credential (resolves CHK015)

**Question**: M365KG issues JWTs (demo mode) or Entra ID tokens with `/api/auth/token/refresh` (REQ-204 contracts/api.md). Should Cowork's `/service` refresh proactively (before expiry) or reactively (on a 401)?

**Finding**: Cowork's existing provider-credential handling (`service/src/credential/*`, `service/src/provider/router.ts`) has no precedent for proactive background refresh of a third-party token — provider API keys are typically long-lived, unlike M365KG's session JWT.

**Decision**: **Reactive refresh.** `KnowledgeSourceClient` treats a `401`/`403` from the M365KG backend as a signal to call `/api/auth/token/refresh` once, retry the original request once, and only then surface `auth_failed` status if refresh also fails. No background timer/polling is introduced (keeps the feature inert when unused, consistent with D5). This mirrors a standard single-retry-on-401 pattern and avoids adding a new scheduled-job concept to `/service` for a feature that's off by default.

**Rejected alternative**: proactive refresh via a background interval — rejected because it would run even when the feature is otherwise idle, contradicting D5 ("inert until configured... no behavior change for users who never configure it" — a background timer is a behavior change the instant configuration happens, regardless of use).

---

## R3 — Tool-call timeout boundary (resolves NFR-004 / CHK014)

**Question**: What happens if the M365KG backend is slow (e.g., a large retrieval pipeline run) but would eventually succeed?

**Finding**: REQ-204's own `E2E_TESTING_GUIDE.md` production checklist targets "Search latency < 30 seconds (p95)" for the 8-stage retrieval pipeline. Cowork's tool-execution layer has no existing precedent for a tool-specific timeout distinct from overall session/streaming timeouts (repository survey found no per-tool timeout constant in `service/src/permission/*` or `service/src/runtime/*`).

**Decision**: `m365_knowledge_search` tool calls use a **35-second client-side timeout** in `KnowledgeSourceClient` (M365KG's own stated p95 + a 5s margin), after which the tool reports a clean `unavailable`/`timeout` outcome (FR-009) rather than hanging the conversation turn. This value is a named constant (`M365_KNOWLEDGE_QUERY_TIMEOUT_MS`), not a magic number, so it can be tuned without a code-shape change — same convention as `FILE_REVIEW_MAX_SNAPSHOT_BYTES` etc.

---

## R4 — Knowledge Panel graph node-count bound (resolves NFR-004 / CHK008 / CHK012)

**Question**: What bounded node count keeps the panel responsive?

**Finding**: No existing Cowork graph-rendering precedent (this is a new visual element). Existing bounded-preview conventions in the same product (`FILE_REVIEW_MAX_SNAPSHOT_BYTES` = 64 KiB, `FILE_REVIEW_MAX_DIFF_LINES` = 500) establish the product's general philosophy: pick a conservative bound, name it as a constant, document it in the same table style as `docs/product/current-status.md`'s "Limits (configured)" table.

**Decision**: Cap the Knowledge Panel's node-link view at **50 nodes** per render (`KNOWLEDGE_PANEL_MAX_NODES`) — the entity's immediate 1-hop neighborhood from `/api/graph/path`/`/api/graph/nodes`, truncated with an explicit "N more relationships not shown" affordance rather than silently dropping data. Panel render must complete within **300ms** after data arrives (a UI responsiveness budget, not a network budget — network latency is covered by R3) — this becomes an explicit item in `test-engineer`'s performance test pass.

---

## R5 — UI string language convention for the new panel (resolves CHK005)

**Question**: Cowork's existing UI copy is Vietnamese-first (e.g. `Đã đưa tệp vào ngữ cảnh`, `Xem lại thay đổi`, `Nội dung bị ẩn vì file có thể chứa credential hoặc secret.` per `docs/product/current-status.md`). Should the new Knowledge Panel follow this convention?

**Decision**: **Yes — Vietnamese-first, matching the existing product convention**, with the same terse/functional tone as existing strings (e.g. "Đã tìm thấy N tài liệu liên quan", "Không thể kết nối tới nguồn kiến thức M365"). English internal identifiers (constant names, route paths, tool name) remain English per this project's engineering convention; only user-facing copy is Vietnamese. This avoids introducing a second language convention into one visual surface of the same app.

---

## R6 — Feature disable/kill-switch (resolves CHK004)

**Decision**: The Settings UI's M365 Knowledge Source configuration includes an explicit "Disconnect" action (clears stored credential, sets status back to `not_configured`) in addition to never being configured in the first place — reuses the same UX shape as clearing other credentials (`DELETE /v1/credentials`). No separate "emergency kill switch" beyond this is needed for a feature that is entirely additive and already fails closed on any backend unavailability (D5, FR-009).

---

## R7 — Reuse vs. build for the panel's graph rendering (supports D1)

**Question**: If not `reactflow` (React-only), what renders the bounded node-link view natively?

**Finding**: No existing vanilla-JS graph-rendering dependency in `/app/ui`'s `package.json`. Introducing a new third-party graph library is a smaller, more justifiable dependency addition than a second UI framework (single-purpose, tree-shakeable, no framework lock-in) but still needs a build-vs-buy call.

**Decision**: **Build a minimal custom SVG renderer** scoped to the 50-node bound (R4) — force-directed layout is unnecessary at this scale; a simple radial/hierarchical layout (center entity + 1-hop neighbors arranged around it) is sufficient and avoids pulling in a physics-simulation dependency for a bounded, small dataset. Revisit with a proper graph-layout library only if a future requirement needs multi-hop exploration beyond this bound.

---

## Summary Table

| # | Question | Decision | Blocks |
|---|---|---|---|
| R1 | CORS needed? | No — server-to-server call | FR-014 (now a no-op) |
| R2 | Token refresh strategy | Reactive (on 401, single retry) | `plan.md` Phase 1 |
| R3 | Tool timeout | 35s (`M365_KNOWLEDGE_QUERY_TIMEOUT_MS`) | `plan.md` Phase 1, NFR-004 |
| R4 | Graph node bound | 50 nodes (`KNOWLEDGE_PANEL_MAX_NODES`), 300ms render budget | `plan.md` Phase 2, NFR-004 |
| R5 | UI language | Vietnamese-first, matching existing convention | `plan.md` Phase 2 |
| R6 | Kill switch | "Disconnect" action, reuse credential-clear pattern | `plan.md` Phase 1 |
| R7 | Graph rendering approach | Custom minimal SVG renderer, no new framework | `plan.md` Phase 2, D1 |
