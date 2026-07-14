# Feature Specification: M365 Knowledge Graph Integration into Cowork GHC

> **Status**: Draft — pending PO confirmation on Decisions D1, D2 (see §1)
> **Author**: speckit-planner
> **Date**: 2026-07-12
> **Requirement ID**: REQ-205
> **Depends on**: REQ-204 (M365 Knowledge Graph, `specs/REQ-204-M365-001-m365-knowledge-graph/`) — complete (backend + `llm-svc` + Frontend all built and tested per that spec's Phase 11 audit)
> **Related governance**: `AGENTS.md`, `CLAUDE.md` (Cowork GHC LEAN process), `.agent-workflow/roles/*.md` (role boundaries), `.specify/memory/constitution.md` (testing/correctness invariants, applied where relevant — that constitution predates Cowork GHC and is written for a different subsystem; see §1 D6)

---

## 0) Why This Is a Separate Requirement, Not a REQ-204 Amendment

REQ-204 built the M365 Knowledge Graph as a **standalone product** (its own Go backend, Rust `llm-svc`, React frontend, Postgres, Neo4j). It is complete and independently verified (`tasks.md` Phase 11: Go 43/43 tests pass, Rust 43/43 tests pass, Frontend built with Playwright E2E coverage).

This requirement is a **cross-project integration**: making that already-built system usable *from inside* the separate, pre-existing **Cowork GHC** product (an Electron desktop app, `/service` + `/runtime` + `/app/shell` + `/app/ui`), which has its own architecture, its own constitution-equivalent (`AGENTS.md`/`CLAUDE.md`/`.agent-workflow/roles/*.md`), and its own release process (`poc-v0.1`, packaged Windows builds, `verify:release`). No file under `service/`, `runtime/`, `app/`, or `tools/` currently references `backend/`, `llm-svc/`, or `Frontend/`, and neither `package.json`'s `workspaces` array nor `docker-compose.yml` wires them together — confirmed by direct repository survey. This is new scope, hence a new REQ rather than a REQ-204 task.

---

## 1) Locked Decisions (from architecture survey — see rationale under each)

These decisions resolve the ambiguities the raw request left open. They are written as decisions (not options) so `plan.md`/`tasks.md` have a single shape to build against — but **D1 and D2 diverge from what the user's original wording literally asked for**, so they are flagged for explicit confirmation before implementation starts.

### D1 — UI integration is native (vanilla TS/DOM), not a React merge ⚠️ NEEDS CONFIRMATION

**The ask**: "merge the frontend part into Cowork GHC... merge React components into the Electron renderer."

**The finding**: `/app/ui` is plain TypeScript + direct DOM manipulation (`app/ui/src/app-shell.ts`), Vite-built, with **no React dependency and no client-side router** (`app/ui/package.json` explicitly notes "React/UI in later tasks" — i.e., React was deferred, not adopted). `/Frontend` (M365KG) is a full React 19 + TanStack Query + Zustand + Tailwind + `reactflow` single-page app with its own router and pages.

**Decision**: Do **not** import the M365KG React app or introduce React as a second UI framework into `/app/ui`. Instead, build a new **Knowledge Panel** as a native TS/DOM module inside `/app/ui`, following the existing `activity-panel.ts` / `FileReviewArtifact` panel pattern (a contextual side panel driven by data from `/service`, presentational only — no business logic in the panel itself, per the frontend-desktop-engineer role rule). Graph visualization uses a lightweight vanilla-JS-compatible renderer (e.g., an SVG/canvas node-link view built for this panel), not `reactflow` (a React-only library).

**Why**: introducing React into a renderer that has deliberately stayed framework-light is a "large architecture change" (per `AGENTS.md`, this class of change requires independent review) with real packaging/bundle-size/testability cost, and it violates the existing invariant "UI is a client of the local service" only if care isn't taken — a second framework raises the risk of it not being. Rebuilding the ~4 read views Cowork actually needs (search, entity reference, graph view, source status) natively is bounded work; importing an entire second SPA is not.

**Alternative considered and rejected**: embed `/Frontend`'s built bundle in an isolated `<webview>`/`BrowserView`. Rejected: conflicts with `app/shell`'s existing CSP (`security/csp.ts`) and navigation guard (`security/navigation.ts`), and creates a second, differently-authenticated surface the user would context-switch into rather than a panel inside their existing conversation — worse UX than the request implied.

**If the PO overrides this decision**: importing React scoped *only* to the new Knowledge Panel's DOM subtree (e.g., mounting a small React root inside one `<div>` the vanilla shell owns) is possible without rewriting `app-shell.ts` wholesale — flag this preference back to speckit-planner/product-architect before `plan.md` is finalized, since it changes Phase 2 task shape materially.

### D2 — ⚠️ SUPERSEDED 2026-07-13 — see D2' below

> **This original D2 is superseded.** Kept verbatim below for the historical record (per this
> project's "no info lost" documentation rule) — do not implement against it. The active decision
> is **D2'**, immediately following.

**Decision (superseded)**: Neo4j, PostgreSQL, the Go backend, and `llm-svc` continue to run as an **independently started local stack** (via existing `docker-compose.yml` for Postgres/Neo4j, plus `go run`/binary and `cargo run`/binary for backend/`llm-svc`, per `E2E_TESTING_GUIDE.md`). Cowork GHC does **not** bundle, spawn, or package these processes inside the Electron installer. `/service` gains a new **thin HTTP client module** that talks only to the Go backend's REST API (`/api/knowledge/query`, `/api/entities`, `/api/graph/*`, `/api/m365/*`) at a configurable base URL (default `http://localhost:8080`). Cowork never talks to Neo4j, PostgreSQL, or `llm-svc` directly — it respects the M365KG system's own boundary (Go backend is the sole entry point; `llm-svc` is internal-only per REQ-204 §3.3).

**Why (superseded)**: Cowork GHC is a packaged Windows desktop POC; bundling Postgres + Neo4j (JVM-class memory footprint, 1–2 GB heap per `docker-compose.yml`) + two more native processes inside an Electron installer is disproportionate to this feature's value and conflicts with the product's "local-first, lightweight" positioning. Treating M365KG as an optional, separately-managed local data source is the lower-risk, non-breaking path, and matches "one owner per child-process lifecycle" (product-architect invariant) — M365KG's own process lifecycle stays owned by its own tooling, not Cowork's.

**Consequence (superseded)**: the feature is **unavailable** (cleanly, not broken) unless the user has the M365KG stack running and has configured its endpoint in Cowork's settings. This is a first-class state the UI must represent, not an error.

### D2' — Cowork bundles and self-provisions the M365KG stack (supersedes D2, 2026-07-13)

**Decision**: Reversed by explicit Product Owner (DungPham) instruction, 2026-07-13. Cowork GHC now
**bundles, provisions, and supervises** PostgreSQL, Neo4j, the Go backend, and `llm-svc` as child
processes of its own Local Service, using portable (no-installer, no-Administrator) Windows
binaries downloaded and SHA-256-verified on first run — the end user installs and configures
nothing. Full rationale, license review (PostgreSQL License permissive; Neo4j Community GPLv3 via
"mere aggregation" as a separate child process), and lifecycle design (a new `M365KG Stack
Supervisor` owner extending ADR 0004's existing supervision tree) are in
**`docs/architecture/decisions/0010-m365kg-stack-bundling.md`** — that ADR is the source of truth;
this entry exists so `spec.md` doesn't contradict it.

**Why**: D2's original "external, thin-client" model made the feature usable only in a dev/test
environment — a real Cowork GHC end user (a business user with a packaged Windows install) cannot
be expected to install and run Postgres/Neo4j/Go/Rust services themselves. Without self-provisioning,
the feature is effectively unusable by the actual target user.

**Consequence**: `/service`'s `KnowledgeSourceClient` (D2's thin HTTP client, unchanged) now talks
to a **Cowork-managed local instance** by default instead of a user-managed external one; the
"M365KG stack unreachable" degraded state (D2's original UI requirement) is now rarer in practice
but still required — provisioning/startup can still fail (disk space, port conflict, first-run
download failure) and must degrade cleanly, not crash.

**Impact on already-implemented Phase 1/2 code**: `service/src/knowledge/m365kg-client.ts`'s
`KnowledgeSourceClient` interface and REST contract are **unchanged** — it is still a thin client
to a base URL; only *what starts and owns the process at that base URL* changes. No changes needed
to Phase 1/2 code on this account alone.

### D3 — Integration mechanism: bespoke REST client + new tool, not the MCP adapter stub

**Finding**: `service/src/extensions/mcp-adapter.ts` is an explicit, unattached "Tier 2" future-work stub for a live MCP process — it is not functional today.

**Decision**: Build a bounded `service/src/knowledge/` module (REST client + router) now; do not build out MCP infrastructure as a prerequisite. Register a new OpenCode-invokable tool (e.g. `m365_knowledge_search`) that routes through the existing `PermissionGate`/`ToolPermissionProxy` exactly like filesystem tools.

**Why**: building MCP support and the M365 integration simultaneously is materially larger scope than this request, and MCP's wire contract isn't defined yet in this repo. Revisit MCP as the transport in a later requirement if/when Tier 2 MCP work lands — this integration's client interface should be swappable (single `KnowledgeSourceClient` abstraction), not thrown away.

### D4 — Credential storage: reuse the existing Windows keyring, one new credential kind

**Decision**: The M365KG API token (JWT, or Entra ID access/refresh token pair once Entra mode is used) is stored via the same mechanism already used for LLM provider credentials (`service/src/credential/*`, backed by `@napi-rs/keyring`), as a new credential kind (`m365-knowledge`). The renderer never receives the raw token — same pattern as existing provider credentials exposed only via `/v1/credentials` metadata, never the secret value itself.

**Why**: "one credential store," "no real API keys in browser local storage," "secrets never appear in logs, errors, frontend state" are existing, non-negotiable rules (`runtime-llm-engineer` role, `AGENTS.md` Safety section). Introducing a second credential mechanism for this one integration would violate them.

### D5 — Feature is off by default, gated by explicit configuration

**Decision**: The Knowledge Panel, the `m365_knowledge_search` tool, and all `/v1/knowledge/*` routes are inert until the user configures an M365KG endpoint + credential in Settings (mirrors the existing provider-configuration UX in `service/src/provider/router.ts` / `diagnostics/settings-router.ts`). No behavior changes for users who never configure it.

**Why**: this feature is not on the current roadmap (`docs/product/productization-roadmap.md`'s active phase is C "File Work Review" → next slice "Minimal Workspace Navigator"; this integration isn't in that sequence). Making it strictly additive and opt-in avoids disrupting the roadmap's phase gating and satisfies "focus on minimal, non-breaking integration" from the original request. **The Product Owner should decide whether to record this as a new roadmap phase/initiative in `docs/product/productization-roadmap.md`; this spec does not edit that file.**

### D6 — Constitution applicability

`.specify/memory/constitution.md` is written for a different, earlier subsystem ("RAD Knowledge Gateway", FR-38 code graph — its own canonical-source table points at a `specs/REQ-003-...` path that doesn't exist in this repo). It is not Cowork GHC's or M365KG's governing document; `AGENTS.md`/`CLAUDE.md`/`.agent-workflow/roles/*.md` are. Where the constitution's INVARIANTs are generically sound engineering practice (atomic visibility, source traceability, determinism, crash safety), this spec applies them as **good practice**, not as a formally-binding gate — flagged here so `/speckit.analyze` doesn't report a false conflict against an inapplicable document.

---

## 2) Overview

Cowork GHC users working on M365-knowledge-related tasks (e.g., "who owns the Contoso migration project," "find the latest SOW doc for Customer X," "which engineers know Terraform") currently have no way to ground the agent's answers in the organization's actual M365 data (OneDrive/SharePoint/Teams) unless they manually attach files. The M365 Knowledge Graph project already solves this — permission-aware retrieval over a Neo4j business entity graph with citation-backed answers — but as a separate product with its own login and UI.

This feature connects the two: Cowork's conversation and tool-execution layer gets a new, permission-gated way to query the M365 Knowledge Graph and surface entity/document references directly in chat, and the desktop UI gets a lightweight panel to browse/inspect those references, **without** requiring the user to leave Cowork, without bundling M365KG's heavy backend stack into the Cowork installer, and without breaking any existing Cowork or M365KG functionality or test suite.

## Scope / Out of Scope

**In scope:**
- A new `/service` module that acts as a permission-aware REST client to the M365KG Go backend.
- A new OpenCode tool the agent runtime can invoke to answer M365-knowledge questions, gated by Cowork's existing permission system.
- Surfacing M365 entity/document citations returned by a tool call in the conversation transcript, with a way to inspect them (Knowledge Panel).
- Configuration UI (Settings) for the M365KG endpoint + credential.
- A connection/health/status indicator (M365KG stack reachable vs. not configured vs. unreachable).
- Unit, contract, integration, and E2E test coverage for all new code, and a regression pass proving `npm run verify:release`, `backend`'s `go test ./...`, `llm-svc`'s `cargo test`, and `Frontend`'s Playwright suite all still pass unmodified.

**Out of scope (this REQ):**
- Bundling/packaging Postgres, Neo4j, the Go backend, or `llm-svc` inside the Cowork Windows installer.
- Rebuilding or replacing any M365KG backend/frontend functionality (REQ-204 is complete and untouched by this work except where explicitly noted, e.g. CORS config, §5 FR-014).
- Introducing a general-purpose plugin/MCP framework (tracked as a separate future requirement, see D3).
- Multi-tenant M365KG admin features (connection setup, delta-sync configuration) beyond a read-only "is it connected and healthy" surface in Cowork — configuring M365 *sources* remains the M365KG Frontend's job (`DataSourcesPage.tsx`); Cowork only *consumes* already-configured knowledge.
- Any change to M365KG's auth model, permission model, retrieval pipeline, or data schema.
- Mobile/web Cowork surfaces (Cowork GHC itself is Windows-desktop-only; out of scope per existing roadmap).

---

## 3) User Stories

### US-1 (P1): Ask an M365-knowledge question inside a Cowork conversation

As a Cowork GHC user, I want to ask a question that requires organizational M365 knowledge (e.g., "who's the project lead for the Q3 migration?") inside my normal conversation, so that I get a grounded, cited answer without leaving the app or manually hunting for the source document.

**Acceptance criteria:**
- Given the M365 Knowledge Source is configured and healthy, when the user asks a question the agent determines needs M365 knowledge, then the agent invokes the `m365_knowledge_search` tool, receives an answer + entity/document citations from the M365KG backend, and presents them in the transcript.
- Given the M365 Knowledge Source is **not configured**, when the agent would otherwise invoke this tool, then it degrades gracefully (does not call the tool, does not error the turn) and may state the capability isn't configured.
- Given a tool call is about to run, when permission has not yet been granted for the M365 knowledge source in this session, then the existing permission-prompt flow (`PermissionGate`) is shown before the call executes — never auto-approved silently.
- Given the M365KG backend returns permission-filtered results for the authenticated M365 identity, when Cowork displays them, then Cowork shows exactly what the backend returned — it does not re-filter, re-rank, or cache results across users/sessions in a way that could leak one user's results to another.

### US-2 (P1): See what the agent cited

As a Cowork GHC user, I want to inspect the specific M365 documents/entities an answer was grounded in, so that I can verify the answer before acting on it.

**Acceptance criteria:**
- Given a conversation turn included an `m365_knowledge_search` tool call with results, when the user opens the Knowledge Panel for that turn, then they see the cited documents/entities (name, source type, and a link/reference back to the M365KG entity or graph node), following the same "review panel alongside the conversation" pattern as the existing File Work Review panel.
- Given no M365 tool call occurred in a turn, when the user looks at that turn, then no Knowledge Panel entry point is shown for it (no empty/misleading panel).

### US-3 (P2): Configure the M365 Knowledge Source

As a Cowork GHC user (or admin), I want to point Cowork at my already-running M365 Knowledge Graph backend and enter its access token, so that the feature becomes available.

**Acceptance criteria:**
- Given the Settings UI, when the user enters an M365KG base URL and credential, then Cowork validates connectivity (a health check against `/api/stats/overview` or equivalent) and stores the credential via the existing Windows-keyring-backed credential store — never in plaintext, never in renderer-accessible storage.
- Given an invalid/unreachable endpoint, when the user tests the connection, then Cowork reports a specific, honest failure reason (unreachable / auth rejected / timeout) — no generic silent failure.
- Given a previously-working configuration becomes unreachable later (M365KG stack stopped), when the user is in a conversation, then the connection-status indicator reflects this without crashing the session or blocking unrelated tool use.

### US-4 (P2): Browse the knowledge graph read-only

As a Cowork GHC user, I want a lightweight way to see the business entity graph (people/projects/documents/technologies) related to my current workspace context, so that I can explore connections without switching to the separate M365KG web app.

**Acceptance criteria:**
- Given the Knowledge Panel is open and the M365 Knowledge Source is healthy, when the user searches for or clicks into an entity, then a node-link visualization of that entity's immediate relationships renders (read-only; no edit/create/delete of graph data from Cowork).
- Given a large result set (many nodes), when rendered, then the panel remains responsive (bounded node count per view, consistent with Cowork's existing bounded-preview conventions, e.g. `FILE_REVIEW_MAX_*` limits) rather than attempting to render the entire graph.

### US-5 (P3): Trigger a data sync status check

As a Cowork GHC user, I want to see whether my M365 data source is up to date, so that I know whether an answer might be based on stale data.

**Acceptance criteria:**
- Given the Knowledge Panel or a knowledge-tool result, when sync metadata is available from the backend (`/api/m365/sync/status`), then Cowork surfaces a last-synced timestamp alongside the answer/citation.
- Triggering a *new* sync from Cowork is out of scope for this REQ (read-only status only) — see Out of Scope.

---

## 4) Functional Requirements

**Service layer (`/service`)**
- FR-001: `/service` MUST provide a `KnowledgeSourceClient` abstraction with a REST implementation targeting the M365KG Go backend's documented API (`specs/REQ-204-M365-001-m365-knowledge-graph/contracts/api.md`).
- FR-002: `/service` MUST expose new local routes (namespace `/v1/knowledge/*`) that proxy to the M365KG backend, never exposing the M365KG credential or raw backend URL to the renderer.
- FR-003: `/service` MUST support configuring the M365KG base URL and credential via a route analogous to existing `/v1/providers/*` / `/v1/credentials` routes.
- FR-004: `/service` MUST perform a health check (e.g. against `/api/stats/overview` or `Health`-equivalent) and expose connection status (`not_configured` | `connected` | `unreachable` | `auth_failed`) via a status route.
- FR-005: Every `/v1/knowledge/*` call that results in an outbound request to the M365KG backend MUST pass through the same audited path as other outbound-capable actions — no bypass of `PermissionGate` for the tool-invocation path (FR-008).

**Tool / agent runtime integration**
- FR-006: A new tool (`m365_knowledge_search`, exact name confirmed in `plan.md`) MUST be registered with the OpenCode runtime, callable by the agent during a session.
- FR-007: The tool's request/response schema MUST map to the M365KG `/api/knowledge/query` contract (query text in; answer + entities + sources + confidence out).
- FR-008: Every invocation of the tool MUST be routed through `ToolPermissionProxy`/`PermissionGate` before executing, with the same fail-closed timeout/audit behavior as existing tools (no new bypass path).
- FR-009: If the M365 Knowledge Source is not configured or unreachable, the tool MUST report this to the runtime as a clean "unavailable" outcome, not a thrown/opaque error that could surface as a broken turn.

**UI (`/app/ui`)**
- FR-010: A Knowledge Panel MUST be addable to a conversation turn that included a knowledge-tool call, following the existing contextual-panel pattern (`activity-panel.ts`/File Work Review), rendered natively (TypeScript/DOM, per D1) — no new UI framework introduced without explicit PO override of D1.
- FR-011: The Knowledge Panel MUST show, at minimum: the answer's cited documents/entities, a bounded node-link graph view for entity relationships, and a last-synced timestamp when available.
- FR-012: A Settings section MUST allow configuring/testing/clearing the M365 Knowledge Source connection, matching existing Settings UX conventions.
- FR-013: The UI MUST NOT display raw M365KG credentials at any point (matches existing provider-credential display conventions — masked/absent, not plaintext).

**Cross-cutting / non-breaking**
- FR-014: If CORS configuration on the M365KG Go backend needs adjustment to allow Cowork's `/service` origin, that change MUST be additive (widen `ALLOWED_ORIGINS`, not narrow or replace existing entries) and MUST NOT be required if `/service`→backend calls are server-to-server (no browser CORS involved) — confirm which applies during `plan.md`'s technical design (this determines whether FR-014 has any work at all).
- FR-015: No existing Cowork GHC route, IPC channel, or test MUST change behavior for users who never configure the M365 Knowledge Source.
- FR-016: No existing M365KG backend/`llm-svc`/Frontend route, schema, or test MUST change behavior as a result of this integration, except the additive CORS change in FR-014 if determined necessary.

---

## 5) Non-Functional Requirements

- NFR-001 (Testability): every new module has unit test coverage at the same rigor as existing sibling modules (`service/tests/*` pattern) — contract tests using a mocked M365KG backend, matching `test-engineer` role's "mock vs contract vs live" distinction.
- NFR-002 (Honesty): connection/health state shown to the user must reflect real, current backend reachability — no cached "looks connected" state once the backend is known unreachable (test-engineer role: "tests must assert real effects").
- NFR-003 (Security): M365KG credential handling meets the same bar as existing provider credentials — Windows keyring only, never logged, never in frontend state, redacted in any diagnostics output.
- NFR-004 (Performance): Knowledge Panel graph rendering must stay responsive with bounded node counts (see US-4); a knowledge-tool call must not block the rest of a conversation turn indefinitely — apply a request timeout with a clean "unavailable" fallback (FR-009).
- NFR-005 (Non-regression): `npm run verify:release`, `backend`'s `go test ./...`, `llm-svc`'s `cargo test`, and `Frontend`'s Playwright suite must all pass, unmodified in outcome, after this integration lands (this is the explicit acceptance bar the user stated).
- NFR-006 (Windows-only): all new Cowork-side code must work under the existing Windows-packaged POC constraints (no new OS-specific dependency beyond what `electron-builder --win` already supports).

---

## 6) Open Questions

1. **(Blocks Phase 2 of `plan.md`)** Confirm D1 (native TS/DOM Knowledge Panel) vs. scoped-React-mount override — see D1 for the tradeoff.
2. **(Blocks Phase 1 of `plan.md`)** Confirm D2 (external M365KG stack, thin-client integration) is acceptable, vs. an alternative where the M365KG backend is packaged as a sidecar the Windows installer manages (would require a much larger effort estimate and a dedicated ADR per the product-architect role — not recommended for this POC, but flagging since it's the other literal reading of "bring M365KG into Cowork GHC").
3. Should Cowork's Settings expose M365KG connection *setup* (Entra ID app registration fields, etc.) or only accept a pre-obtained token/endpoint configured by whoever runs the M365KG stack? (Affects FR-003/FR-012 scope — current assumption: latter, simpler, matches "Cowork only consumes already-configured knowledge" in Out of Scope.)
4. Exact tool name/schema for `m365_knowledge_search` — proposed in FR-006, needs runtime-llm-engineer sign-off during `plan.md`.
5. Whether `/api/m365/sync/status` polling for US-5 should be on-demand only (simplest, recommended) or a background poll — background polling has cost/complexity implications for a feature that's off by default; recommend on-demand only unless PO wants otherwise.
6. Whether this integration should be recorded in `docs/product/productization-roadmap.md` as a new phase (D5) — Product Owner decision, not authored by this spec.

---

## 7) Dependencies

- REQ-204 (M365 Knowledge Graph) — complete; this REQ only *consumes* its documented API surface (`specs/REQ-204-M365-001-m365-knowledge-graph/contracts/api.md`), does not modify its internals except the possible additive CORS change (FR-014).
- Cowork GHC's existing `PermissionGate`, `ToolPermissionProxy`, credential store (`@napi-rs/keyring`), and Settings routes — reused, not rebuilt.
- The M365KG local stack (Postgres, Neo4j, Go backend, `llm-svc`) must be independently running and reachable for the feature to function; this is a runtime dependency, not a build dependency.
