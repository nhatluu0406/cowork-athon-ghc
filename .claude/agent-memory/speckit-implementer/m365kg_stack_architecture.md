---
name: m365kg-stack-architecture
description: Where the bundled M365KG stack (ADR 0010) lives, its module boundaries, and the D2->D2' external-vs-bundled reversal — orient here before touching this area again
metadata:
  type: project
---

Cowork GHC's M365 Knowledge Graph feature has an ADR-0010-driven architecture that is easy to get
lost in across sessions. Orientation map (as of 2026-07-13):

- `service/src/knowledge/stack/` — the bundled-stack lifecycle modules: `provisioning.ts`
  (download+SHA256-verify+extract the Postgres/Neo4j/JRE/llm-svc Windows zips),
  `sources.ts` (pinned download URLs), `stack-roles.ts` (per-role launch spec: command/args/env/
  readiness probe for each of the 4 child processes), `stack-supervisor.ts`
  (`M365KGStackSupervisor` — starts/stops an already-*initialized* cluster, composes 4
  `GenericChildSupervisor`s), and `stack-initializer.ts` (`M365KGStackInitializer` — the ONE-TIME
  `initdb`/Neo4j-password/migrations step that must run before the supervisor's first real start;
  added 2026-07-13). `index.ts` barrels the public surface for the `./knowledge/stack`
  `package.json` export subpath (mirrors the pre-existing `./knowledge/types` subpath — deep
  imports, not the `src/index.ts` main barrel, is this project's convention for `knowledge/*`).
- `service/src/runtime/generic-*` — the role-agnostic single-child-process supervisor skeleton
  (`GenericChildSupervisor`) that all 4 M365KG roles + the initializer's brief temp-starts reuse,
  extracted from the OpenCode-specific `OpencodeSupervisor`/`supervisor.ts` (which is untouched).
- `app/shell/src/service/m365kg-stack-*.ts` — the Electron-shell-side wiring (paths, secrets,
  launch orchestration), added 2026-07-13, wired non-blockingly into `main.ts`'s `prepare()`. Kept
  fully separate from `ServiceController`/`lifecycle.ts` (the Cowork/OpenCode chat service's own
  owner) — M365KG is additive and must degrade silently, never crash the shell.
- `service/src/knowledge/*.ts` (NOT `knowledge/stack/`) — `m365kg-client.ts` (`KnowledgeSourceClient`,
  a thin REST client to whatever `baseUrl` is configured), `router.ts`, `tool.ts`, `store.ts` — this
  is the REQ-205 Phase 1/2 layer, unchanged by ADR 0010's bundling; the bundled backend just becomes
  one more possible value for that `baseUrl`, but nothing currently *auto-configures* it there (a
  known, deliberately out-of-scope gap — see `docs/product/current-status.md`'s ADR 0010 Phase 4
  section, "provisioning download step is still not wired").
- **D2 → D2' (2026-07-13, same day as original D2 sign-off)**: the M365KG stack was originally
  meant to run externally/manually (D2, thin-client model — user installs+runs it themselves,
  configures the URL in Settings). The Product Owner reversed this (D2') — Cowork now bundles and
  self-provisions the whole stack. `specs/REQ-205-COWORK-001-m365-cowork-integration/spec.md`
  keeps D2 verbatim (marked superseded) alongside D2' per this project's "no info lost" convention
  — read D2' there, not D2, when reasoning about current behavior.
- Full ADR: `docs/architecture/decisions/0010-m365kg-stack-bundling.md`. Remaining-work spec/tasks/
  checklist for the init+packaging slice: `specs/ADR-0010-BUNDLE/`.

**Known open gaps** (as of 2026-07-13, not yet closed): Neo4j license not legally confirmed (blocks
GA); the provisioning *download* step is implemented (`provisioning.ts`) but nothing calls it from
`app/shell` yet — `m365kg-stack-launch.ts`'s `isProvisioned` check will see an empty `stackRoot` on
every real run until that's wired; zero execution against real Windows/Postgres/Neo4j binaries
anywhere in this codebase's history so far (see [[env-packaging-limitation]] for why this sandbox
specifically can't close that gap).
