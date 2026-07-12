# L1-R1 — OpenWork Research (Doc Classification + Capability Inventory)

- Task: L1-R1 (Requirement Baseline research), role: repository-researcher (READ-ONLY).
- Method: full read of docs/openwork-requirements-and-basic-design.md (868 lines, Vietnamese);
  structural + runtime verification against the reference tree at
  .loop-engineer/source/openwork/ (branch dev, HEAD 1897f9f).
- Doc generated at commit 00190e5; live HEAD is 1897f9f. Shallow clone, no history/diff
  available, so classification is based on whether the current tree still matches the doc's
  major structural + runtime claims (all citations below re-verified against 1897f9f).

---

## Section 1 — Doc Classification

**Verdict: VALID_WITH_GAPS.**

The doc is accurate, well-cited, and honestly hedged. Every major structural and runtime
claim spot-checked still holds at HEAD 1897f9f. Not unqualified VALID only because (a) it
was written against an older commit and history could not be diffed, and (b) it explicitly
leaves several features "unconfirmed" which remain gaps. Far from STALE/INVALID: the
four-layer architecture, Electron shell, OpenCode-as-runtime, and server-owned state are
all present today.

### Structural claims — CONFIRMED at HEAD 1897f9f
- Four-layer split present: apps/app (UI), apps/desktop (shell), apps/server, apps/orchestrator.
- Desktop shell is Electron, NOT Tauri: apps/desktop/electron/ has main.mjs (78KB),
  runtime.mjs (68KB), preload.mjs, updater.mjs; NO src-tauri/ directory. Confirms CON-004 / 18.3 / 19.2.
- OpenCode is the external pinned runtime: constants.json = {"opencodeVersion":"v1.17.11"}.
- pnpm-workspace.yaml lists apps/*, packages/*, ee/apps/*, ee/packages/*; allowBuilds still
  contains @whiskeysockets/baileys (orphaned WhatsApp dep the doc flags). Confirms 6.2, 29.
- ee/apps/: den-api, den-controller, den-web, den-worker-proxy, den-worker-runtime,
  inference, landing — all present. ee/ license boundary intact.
- Server-owned state files present: apps/server/src/{approvals,tokens,audit,config,
  managed-opencode,skills,plugins,mcp,commands,skill-hub}.ts and
  routes/{core,files,operations,workspaces,sessions,registry}.ts.
- Key symbols verified in code:
  - assertOpencodeProxyAllowed at apps/server/src/server.ts:634; proxyOpencodeRequest at
    server.ts:887. Viewer gate enforced (server.ts:638-652), with the #1918 comment (BR-002).
  - ApprovalService at apps/server/src/approvals.ts:16; auto-mode allow :31-32;
    timeout -> fail-closed deny :42-45 (confirms NFR-007, BR-003).
  - DEFAULT_HOST = "127.0.0.1" at apps/server/src/config.ts:48 (confirms NFR-001 loopback).
  - Path guards normalizeWorkspaceRelativePath (routes/files.ts:46) and resolveSafeChildPath
    (files.ts:112) (confirms NFR-013).
  - Secret redaction collectSecretValues/scrubKnownSecretValues at
    apps/app/src/app/lib/diagnostics-bundle.ts:121/132 (confirms NFR-008).
  - hashToken + scope owner/collaborator/viewer at apps/server/src/tokens.ts (NFR-004).

### Claims NOT fully confirmed (carried as gaps)
- Templates (FR-040): doc says unconfirmed. Still unconfirmed — no dedicated template
  store/API; "template" appears only incidentally in session/sidebar/app-sidebar.tsx,
  settings/state/{debug-view-model,extensions-store}.ts.
- Marketplace capability (FR-041) and Memory bank (FR-042): design-note/draft status
  unchanged — no independent route/schema evidence beyond docs.
- test:orchestrator / test:router mismatch (FR-004): not re-verified line-by-line.
- Provider credential storage location: doc 22 does NOT pin where provider API keys live. See Section 4.

### Commit-drift note
Doc commit 00190e5 -> live HEAD 1897f9f. No git diff possible (shallow clone). No
contradiction found between doc and live tree on any checked claim; structure/runtime drift
risk low, line-number drift inside large files unquantified.

---

## Section 2 — Capability Inventory (by Cowork GHC POC area)

Citations into .loop-engineer/source/openwork/. Mode = host/local (H), client/remote (C), or both.

### 1. Workspace
- Create local workspace + scaffold .opencode/: POST /workspaces/local ->
  apps/server/src/routes/workspaces.ts; init via apps/server/src/workspace-init.ts. (H) [FR-013]
- Attach remote workspace by base URL (a server can be client of another server):
  POST /workspaces/remote + discoverOpenworkWorkspace, routes/workspaces.ts. (C) [FR-014]
- Native folder picker via Electron dialog.showOpenDialog (pickDirectory),
  apps/desktop/electron/main.mjs. (H) [FR-017]
- Local workspace list owned by shell: apps/desktop/electron/workspace-store.mjs (46KB). (H)

### 2. Agent session
- Session create/prompt: UI session.create({directory}) in
  apps/app/src/react-app/domains/session/sync/actions-store.ts; prompt in
  use-session-interactions.ts; server proxies to OpenCode via /opencode/*. (both) [FR-006]
- Session grouping/pin/order at OpenWork layer (independent of OpenCode):
  apps/server/src/session-groups.ts + UI session-management-store.ts. (both) [FR-009]
- Sessions read via light proxy: apps/server/src/routes/sessions.ts (15KB). Real
  session/message store is OpenCode's own sqlite; apps/server/src/opencode-db.ts seeds
  "blueprint sessions" directly. (both)

### 3. Execution visibility
- Real-time updates over SSE: UI subscribes event.subscribe() in
  apps/app/src/react-app/kernel/global-sdk-provider.tsx; server proxies OpenCode's /event
  SSE transparently (does not synthesize events) — proxyOpencodeRequest server.ts:887. (both) [FR-007]
- Execution plan / todo timeline: read todos in use-session-interactions.ts. (both) [FR-008]
- Debug view (runtime info, execution cmd/cwd/env, audit, dev-log):
  apps/app/src/react-app/domains/settings/pages/debug-view.tsx. (both) [FR-023/024]

### 4. Permission & approval  (TWO independent layers — key for Cowork GHC)
- Tool-level permission (emitted by OpenCode): UI modal
  apps/app/src/react-app/domains/session/chat/permission-approval-modal.tsx;
  respondPermission proxies to OpenCode permission/:requestId/reply. (both) [FR-010]
- Server-level write approval (OpenWork Server owns a separate queue): ApprovalService
  apps/server/src/approvals.ts:16; routes GET/POST /approvals in routes/operations.ts. (both) [FR-011]
- Enforced at execution boundary, not UI: viewer scope blocked from non-GET proxy and from
  replying to permission requests — assertOpencodeProxyAllowed server.ts:634-652 (BR-002).
  Fail-closed on timeout approvals.ts:42-45 (NFR-007). Auto mode via --approval auto (config.ts). (both)

### 5. File operations
- All workspace read/write goes through the server: apps/server/src/routes/files.ts (47KB) —
  no direct UI/renderer write path (BR-001, server-first). (both) [FR-015]
- Path-traversal guard: normalizeWorkspaceRelativePath (files.ts:46), resolveSafeChildPath
  (files.ts:112). (both) [NFR-013]
- Atomic write (temp+rename) + optimistic concurrency (baseUpdatedAt/force) — files.ts.
  Inbox upload / outbox artifacts also in files.ts. (both) [FR-016]
- Mutation pipeline: auth -> path guard -> ApprovalService.requestApproval -> write ->
  recordAudit -> reload if opencode.json changed (doc Diagram 5). (both)

### 6. Provider & model
- Provider-neutral: "50+ LLMs with your own provider keys" (README.md). Providers are called
  by OpenCode, not OpenWork; OpenWork proxies. (both)
- Model/provider selection in UI: apps/app/src/app/utils/providers.ts,
  apps/app/src/components/model-select.tsx, apps/app/src/app/defaults/models.ts, kernel
  model-config.ts (per-workspace {model,variant} map). (both)
- Per-workspace runtime config overlay (e.g. disabled providers) written to OpenCode via
  OPENCODE_CONFIG file: apps/server/src/openwork-runtime-config.ts:3,110 (disabled_providers);
  stored in runtime.sqlite (Drizzle) per doc 22. (both)
- Extension provider configs: settings/ollama-config.tsx, openai-image-gen-config.tsx,
  google-workspace-config.tsx, computer-use-config.tsx.
- Credential storage NOT pinned by doc — provider API keys flow to OpenCode's own auth store
  (auth.json, referenced from server.ts and apps/desktop/electron/runtime.mjs). See Section 4.

### 7. Runtime extension (skills / plugins / MCP / templates)
- Skills: list/import/install-from-hub/remove — apps/server/src/skills.ts, skill-hub.ts
  (GitHub different-ai/openwork-hub); UI settings/pages/skills-view.tsx; local IPC
  listLocalSkills/importSkill in apps/desktop/electron/main.mjs. (both; local IPC = H) [FR-018]
- OpenCode plugins: read/write opencode.json plugin:[...] — apps/server/src/plugins.ts;
  desktop IPC readOpencodeConfig/writeOpencodeConfig. Backward-compatible with OpenCode CLI (NFR-006). (both) [FR-019]
- MCP servers: add/remove/enable/disable/clear-auth — apps/server/src/mcp.ts + /workspace/:id/mcp*. (both) [FR-020]
- Slash-commands: .opencode/commands/*.md — apps/server/src/commands.ts; desktop IPC
  opencodeCommandList/Write/Delete. (both) [FR-021]
- Export/import full extension config: /workspace/:id/export, /import in server.ts (+ extensions-export.ts). (both) [FR-022]
- External UI-control MCP (ui_status/ui_snapshot/ui_list_actions/ui_execute_action):
  packages/openwork-ui-mcp/index.mjs; desktop bridge ui-control-server.mjs. (H) [FR-034]
- Templates: no dedicated implementation found (FR-040, unconfirmed). Marketplace/memory-bank
  are design docs only (FR-041/042).

### 8. Settings & diagnostics
- Settings hub with extension registry: apps/app/src/react-app/domains/settings/
  (settings-layout.tsx, extension-registry.tsx, pages/). (both)
- Diagnostics bundle with secret scrubbing: apps/app/src/app/lib/diagnostics-bundle.ts
  (collectSecretValues:121, scrubKnownSecretValues:132). (both) [NFR-008]
- Audit log per workspace: apps/server/src/audit.ts (recordAudit), GET /workspace/:id/audit;
  stored ~/.openwork/openwork-server/audit/<workspaceId>.jsonl. (both) [NFR-003]
- Structured request logging (toggleable): createServerLogger/logRequest in server.ts;
  dev-log sink off-by-default unless OPENWORK_DEV_LOG_FILE set (routes/core.ts:99-101). (both) [NFR-009/015]

---

## Section 3 — Key Architecture / Runtime / Boundary Facts (constraints for Cowork GHC)

1. OpenCode is an external agent runtime OpenWork orchestrates, never reimplements. Pinned
   centrally: constants.json = v1.17.11. OpenWork spawns "opencode serve" and proxies it.
   (19.5) — Cowork GHC decision point: reuse vs replace runtime.
2. Four-layer split, one process each, decoupled by HTTP: UI (apps/app, React 19 + Vite,
   runtime-agnostic) -> shell (apps/desktop, Electron) -> server (apps/server, filesystem-
   backed API) -> orchestrator (apps/orchestrator, headless CLI host). UI imports nothing
   Electron-specific; native access via a bridge (apps/app/src/app/lib/desktop.ts). (14, 16, 19.1)
3. UI<->service transport is HTTP + transparent SSE proxy. UI talks to the server via
   @opencode-ai/sdk; server forwards OpenCode's /event SSE unchanged (proxyOpencodeRequest,
   server.ts:887). Server controls WHO may call, not event content. (20.4, 21)
4. Permission is enforced at the execution boundary (server), not the UI, and there are TWO
   layers: OpenCode tool-permission (proxied) + OpenWork server write-approval (ApprovalService,
   fail-closed on timeout). Viewer scope hard-blocked at server.ts:634. (23) — matches Cowork
   GHC's core invariant.
5. Server owns all workspace mutation + state; loopback by default. DEFAULT_HOST=127.0.0.1
   (config.ts:48), opt-in --remote-access. All file writes go through routes/files.ts with
   path-traversal guards + atomic write + audit. UI never writes the workspace directly (BR-001). (22, NFR-001/013)
6. In-process embedding on desktop: server usually runs embedded in the Electron main process
   (dynamic import of apps/server/dist/embedded.js via runtime.mjs), not a child process;
   default desktop runtime is "direct" (spawn opencode serve), not the orchestrator. (18.1-18.2)
   — a lifecycle-ownership consideration for Cowork GHC.
7. ee/ is a license boundary (FSL-1.1-MIT), not a technical dependency of the core. All
   Cloud/SSO/billing/remote-worker capability lives there and gates off by default for
   self-host. Cowork GHC (its own product) should treat ee/ as out-of-core reference. (5, CON-005)

---

## Section 4 — Known Gaps / Overstated Features

Doc's own declared gaps (29, still valid):
- Intended root architecture docs (VISION.md, PRINCIPLES.md, PRODUCT.md, ARCHITECTURE.md,
  TRIAGE.md) referenced by README/AGENTS.md but DO NOT exist (CON-007). Only
  apps/app/src/react-app/ARCHITECTURE.md exists (scoped to the UI).
- README describes Tauri; code is Electron (CON-004) — confirmed: no src-tauri/. README
  build-from-source instructions are stale.
- Templates (FR-040): promoted in README, no store/API found — likely renamed, folded into
  Skills, or not built.
- Marketplace capability (FR-041) and Memory bank (FR-042): docs/*-architecture.md self-label
  as "design note" / "Draft for scoping" — NOT implemented features.
- docs/extensions-manifest-foundation.md: a 4-step "PR Stack" — completion unknown.
- WhatsApp/Telegram connectors: product philosophy only; no implementing package. Only orphan
  trace is @whiskeysockets/baileys in pnpm-workspace.yaml allowBuilds (confirmed present,
  consumed by nothing). Slack exists only as org-level MCP connection in ee/, not a bot.
- Two parallel billing systems (Stripe seats/inference vs Polar worker-gating) — undocumented
  rationale (ee/ only; out of Cowork GHC core scope).
- SCIM does not provision Groups (/Groups -> 501) (BR-006) — ee/ only.

Gaps found by this research (beyond the doc):
- Provider credential storage is under-specified. Doc 22 pins locations for server config,
  tokens, audit, runtime config, and OpenCode session DB, but does NOT state where provider
  API keys are stored. Evidence indicates keys live in OpenCode's own auth store (referenced
  from server.ts and apps/desktop/electron/runtime.mjs) — i.e. OpenWork does NOT own a single
  credential store; provider keys sit inside the OpenCode runtime config/auth. This directly
  affects Cowork GHC's "one credential store / no keys in browser storage" invariant and needs
  an explicit decision.
- Line-number drift risk: citations re-verified against HEAD 1897f9f where checked, but the doc
  was authored at 00190e5 and large files (files.ts 47KB, main.mjs 78KB, cli.ts 225KB) may have
  shifted line numbers; treat exact lines as approximate unless re-grepped.

---

## Evidence source paths (reference, read-only)
- Doc under analysis: docs/openwork-requirements-and-basic-design.md
- Reference tree: .loop-engineer/source/openwork/ @ 1897f9f (branch dev)
