# Cowork GHC — Scope & Acceptance (Requirement Baseline, L1)

> Status: L1 Requirement Baseline. This is a requirements/acceptance document, not a
> technical design. Framework, runtime, storage, and IPC mechanisms are decided in L3
> (Architecture) via ADRs. This document only says *what* must be true and *how it is
> verified*, plus which decisions L3 must make.

## 1. Product statement

Cowork GHC is a desktop AI cowork product for the Windows 11 local PC. A user picks a
local folder, talks to an AI agent that can read and change files in that folder under
explicit permission, using their own LLM provider keys, entirely from their own machine.

Cowork GHC is **its own product**. OpenWork (`different-ai/openwork`) is a **research
reference only**: it is read to learn which capabilities matter and which boundaries are
load-bearing. Cowork GHC never forks, clones, or rebrands OpenWork, never inherits
OpenWork branding, and never adopts an OpenWork feature that is not actually built there
as a requirement. All OpenWork citations below point into the read-only reference tree
at `.loop-engineer/source/openwork/` @ `1897f9f` and are sourced from
`.loop-engineer/evidence/L1/openwork-research.md` (hereafter "research") and
`.loop-engineer/evidence/L1/reference-delta.md` ("reference-delta").

The research classified the OpenWork analysis document as **VALID_WITH_GAPS**: the
four-layer split, Electron shell, OpenCode-as-runtime, and server-owned state are all
present today; the gaps are commit drift, an under-specified credential store, and
several overstated/unbuilt features (templates, marketplace, memory bank). Cowork GHC
scope is built to stand on its own and does **not** import OpenWork's unbuilt features
as requirements.

## 2. Classification legend

| Decision | Meaning |
|----------|---------|
| MUST | Required for the POC to be Done. Has testable acceptance criteria below. |
| SHOULD | Strongly desired; built if it fits the POC budget. Has acceptance criteria. |
| COULD | Optional nice-to-have; only if cheap. Acceptance sketched, not gating. |
| DEFERRED | A real future system; POC designs the *boundary* only, builds nothing. |
| OUT_OF_SCOPE | Explicitly not part of Cowork GHC (POC or product core). |

## 3. Capability matrix

Capability IDs are grouped by the 9 POC areas. "OpenWork behavior" is one line with a
reference citation; it is context, not a spec to copy.

### Area 1 — Workspace

| ID | Capability | OpenWork behavior (reference) | Cowork GHC | Rationale |
|----|-----------|-------------------------------|------------|-----------|
| W1 | Pick a local folder (native picker) | Electron `dialog.showOpenDialog` / `pickDirectory` in `apps/desktop/electron/main.mjs` (research §2.1) | MUST | Entry point of the whole product; needs a native OS picker. |
| W2 | Recent / known workspaces list | Shell-owned list `apps/desktop/electron/workspace-store.mjs` (research §2.1) | SHOULD | Real usability win; not required to prove the core loop. |
| W3 | Validate path (exists, writable, spaces + Unicode) | `POST /workspaces/local` + `workspace-init.ts` (research §2.1) | MUST | Windows paths with spaces/Unicode are a stated acceptance target. |
| W4 | Operations confined to the granted workspace | Server-side guards, all writes via `routes/files.ts` (research §2.5, §3.5) | MUST | Core security invariant (workspace boundary). |
| W5 | Attach remote workspace by base URL | `POST /workspaces/remote` + `discoverOpenworkWorkspace` (research §2.1) | DEFERRED | Cowork GHC is a local-PC product; remote/multi-host is a later port. |

### Area 2 — Agent session

| ID | Capability | OpenWork behavior (reference) | Cowork GHC | Rationale |
|----|-----------|-------------------------------|------------|-----------|
| S1 | Create / continue / rename / history | UI `session.create` + server session proxy `routes/sessions.ts` (research §2.2) | MUST | Basic unit of work; without it there is no product. |
| S2 | Send prompt + streaming response | Prompt via `use-session-interactions.ts`; SSE over `/event` (research §2.2, §2.3) | MUST | The core interactive loop; streaming is expected UX. |
| S3 | Cancel a running task | (runtime-level cancellation via proxied runtime) | MUST | Safety + control; user must stop a runaway task. |
| S4 | Restore session state after app restart | OpenCode owns session sqlite; server seeds/reads (research §2.2) | SHOULD | High value; "when feasible" per scope, so not gating. |
| S5 | Session grouping / pin / order | `session-groups.ts` + `session-management-store.ts` (research §2.2) | COULD | Organization nicety; not core to proving the loop. |
| S6 | Clear runtime / session status indicator | Debug/runtime info surfaced in `debug-view.tsx` (research §2.3) | MUST | Honesty invariant: user must always know true state. |

### Area 3 — Execution visibility

| ID | Capability | OpenWork behavior (reference) | Cowork GHC | Rationale |
|----|-----------|-------------------------------|------------|-----------|
| EV1 | Plan / todo timeline | Todos read in `use-session-interactions.ts` (research §2.3) | MUST | Trust: user sees what the agent intends. |
| EV2 | Per-step status | SSE-driven step updates (research §2.3) | MUST | Trust + debuggability. |
| EV3 | Show tool calls | Proxied runtime events, not synthesized (research §2.3, §3.3) | MUST | User must see what the agent is doing. |
| EV4 | Show file mutations | Mutation pipeline visible; writes via server (research §2.5) | MUST | Direct link to the permission/audit story. |
| EV5 | Long-running progress | Event stream conveys progress (research §2.3) | SHOULD | Good UX for slow tasks; not gating. |
| EV6 | Errors with a recovery action | Frontend rules require recovery-carrying errors (`.claude/rules/frontend.md`) | MUST | Rule invariant; errors must be actionable. |
| EV7 | Never render a fake "completed" state | Server forwards real events, does not fabricate (research §3.3) | MUST | Core honesty invariant across the product. |

### Area 4 — Permission & approval

| ID | Capability | OpenWork behavior (reference) | Cowork GHC | Rationale |
|----|-----------|-------------------------------|------------|-----------|
| P1 | Requests originate from the execution boundary | Two layers: runtime tool-permission + server `ApprovalService` (research §2.4, §3.4) | MUST | Invariant: permission is enforced where the action happens. |
| P2 | Allow / Deny in UI | `permission-approval-modal.tsx`; reply proxied (research §2.4) | MUST | User-facing control surface. |
| P3 | Deny actually blocks (server-enforced, not UI-only) | `assertOpencodeProxyAllowed` blocks non-permitted proxy (research §2.4, §3.4) | MUST | Core invariant: a Deny must prevent the action on disk. |
| P4 | Sensitive actions carry an approval level | Server write-approval queue distinct from tool-permission (research §2.4) | SHOULD | Lets high-risk ops require stronger confirmation. |
| P5 | Local audit event for important decisions | `audit.ts` `recordAudit`, per-workspace jsonl (research §2.8) | MUST | Security rule: important decisions are auditable locally. |
| P6 | Fail-closed on approval timeout | Timeout → deny in `approvals.ts:42-45` (research §2.4) | SHOULD | Safe default; strongly recommended, not strictly gating. |
| P7 | Local service binds loopback only | `DEFAULT_HOST=127.0.0.1` (research §3); non-loopback is enterprise/remote territory | MUST | Network-exposure invariant: the execution boundary must not be reachable off-host without an explicit L3 ADR. |

### Area 5 — File operations

| ID | Capability | OpenWork behavior (reference) | Cowork GHC | Rationale |
|----|-----------|-------------------------------|------------|-----------|
| F1 | Read / create / edit files | All via server `routes/files.ts`; no direct UI write (research §2.5) | MUST | The agent's primary side effect. |
| F2 | Move / rename when allowed | File API surface in `files.ts` (research §2.5) | SHOULD | Common editing action; not core to the loop. |
| F3 | Delete only with explicit approval | Mutation pipeline gated by `ApprovalService` (research §2.5) | MUST | Destructive; must require approval. |
| F4 | Prevent path traversal | `normalizeWorkspaceRelativePath`, `resolveSafeChildPath` (research §2.5) | MUST | Security invariant (workspace boundary, `..`/UNC/symlink). |
| F5 | Show diff / description before applying | Mutation described in pipeline (research §2.5) | SHOULD | Informed consent; strengthens permission UX. |
| F6 | Verify real on-disk changes in tests | Atomic temp+rename write (research §2.5) | MUST | Testing rule: no fake mutations; assert bytes on disk. |

### Area 6 — Provider & model

| ID | Capability | OpenWork behavior (reference) | Cowork GHC | Rationale |
|----|-----------|-------------------------------|------------|-----------|
| PR1 | Provider-neutral abstraction | "50+ LLMs with your own keys"; runtime calls providers (research §2.6) | MUST | Invariant: no single-vendor lock-in. |
| PR2 | Add a provider credential | Keys flow to runtime auth store today (research §2.6, §4) | MUST | Prerequisite to any live call. |
| PR3 | Test connection | (config surfaces in `providers.ts` / model-select) (research §2.6) | MUST | User must confirm a key works before relying on it. |
| PR4 | Configure model: default + per-session | Per-workspace `{model,variant}` map (research §2.6) | MUST | Core control over cost/quality per task. |
| PR5 | Switch provider/model without app restart | Runtime config overlay written live (research §2.6) | MUST | UX + honesty; restart-to-switch is unacceptable. |
| PR6 | Provider health indicator | Disabled-providers overlay (research §2.6) | SHOULD | Helps diagnose; not gating. |
| PR7 | Handle invalid key / timeout / rate limit / unavailable | Provider errors surface via proxied runtime (research §2.6) | MUST | Negative-path robustness is a stated acceptance target. |
| PR8 | Secrets never in logs / screenshots / frontend state | `diagnostics-bundle.ts` scrubs secrets (research §2.8) | MUST | Security invariant. |
| PR9 | One OS-backed credential store; no real keys in browser local storage | OpenWork does NOT own one store; keys sit in runtime auth (research §4) | MUST | Cowork GHC invariant that OpenWork does **not** satisfy; needs an L3 ADR to pick the mechanism (the *requirement* stands now). |
| PR10 | Target providers: Anthropic, OpenAI, Google, OpenRouter, one OpenAI-compatible (e.g. DeepSeek/custom) | Provider-neutral runtime (research §2.6) | MUST | Named coverage target; live keys not required for all — mock/contract test and clearly mark non-live providers. |

### Area 7 — Runtime extension

| ID | Capability | OpenWork behavior (reference) | Cowork GHC | Rationale |
|----|-----------|-------------------------------|------------|-----------|
| RE1 | Skills (with one sample skill) | `skills.ts` / `skill-hub.ts` + `skills-view.tsx` (research §2.7) | SHOULD | Demonstrates extensibility; one sample is enough for POC. |
| RE2 | MCP servers add/remove/enable + one sample integration | `mcp.ts` + `/workspace/:id/mcp*` (research §2.7) | SHOULD | Key extension seam; prove with one working integration. |
| RE3 | Plugins | `plugins.ts`, opencode.json plugin list (research §2.7) | COULD | Overlaps skills/MCP; optional for POC. |
| RE4 | Workflow templates: save + re-run | NOT implemented in OpenWork (research §4, overstated) | SHOULD | Real value, but Cowork GHC defines it fresh — it is NOT inherited from OpenWork. |
| RE5 | Diagnostics for failed extensions | Debug view surfaces runtime info (research §2.3) | SHOULD | Extensions fail; user needs a reason. |
| RE6 | Reuse an existing agent/tool runtime (do not rebuild) | OpenCode pinned as external runtime `v1.17.11` (research §3.1) | MUST | Invariant: do not rebuild a runtime without an ADR benefit; L3 decides reuse-vs-build. |

### Area 8 — Settings & diagnostics

| ID | Capability | OpenWork behavior (reference) | Cowork GHC | Rationale |
|----|-----------|-------------------------------|------------|-----------|
| SD1 | General + provider settings | Settings hub `domains/settings/` (research §2.8) | MUST | Configuration surface for the product. |
| SD2 | Runtime status | Debug view runtime info (research §2.3, §2.8) | MUST | Honesty: user sees if the runtime is up. |
| SD3 | Redacted logs | `createServerLogger`/`logRequest`; dev-log off by default (research §2.8) | MUST | Security invariant; logs must be safe by default. |
| SD4 | Diagnostics export (scrubbed) | `diagnostics-bundle.ts` (research §2.8) | SHOULD | Support/debug aid; must reuse scrubbing. |
| SD5 | Reset app / recover from corrupt settings | (settings state stores) (research §2.8) | SHOULD | Resilience; app must not brick on bad config. |
| SD6 | Delete local application data on request | Separate opt-in reset (not `clean.bat`) per scripts/README | SHOULD | User control over their data; distinct from `clean.bat`. |
| SD7 | Show Cowork GHC + runtime version | Runtime pinned centrally (research §3.1) | MUST | Basic diagnosability + support. |

### Area 9 — Windows lifecycle scripts

| ID | Capability | Source | Cowork GHC | Rationale |
|----|-----------|--------|------------|-----------|
| LC1 | `init.bat` prepares env (idempotent) | `scripts/README.md`, `init.bat` | MUST | Bootstrap step; already scaffolded in L0. |
| LC2 | `start.bat` starts app + services (honest NOT READY until runtime exists) | `scripts/README.md`, `start.bat` | MUST | Launch path; must not fake success. |
| LC3 | `stop.bat` stops only Cowork GHC processes gracefully | `scripts/README.md`, `stop.bat` | MUST | Single-owner lifecycle; no killing by generic name. |
| LC4 | `clean.bat` removes only allowlisted generated data | `scripts/cleanup-manifest.json`, `clean.bat` | MUST | Must preserve protected paths; confirm before delete. |
| LC5 | Double-click from Explorer; `%~dp0` root independence; honest exit codes | `scripts/README.md` | MUST | Operational requirement of all four scripts. |

### Deferred systems & out-of-scope

| ID | Capability | Source | Cowork GHC | Rationale |
|----|-----------|--------|------------|-----------|
| D1 | Dispatch / fan-out agent | task scope | DEFERRED | Future system; POC designs the port/adapter boundary only. |
| D2 | Microsoft automation (Teams/SharePoint/OneDrive/Graph) | task scope | DEFERRED | Future integration; boundary seam only. |
| D3 | Knowledge system (RAG / vector / graph) | task scope | DEFERRED | Future system; boundary seam only. |
| D4 | Advanced LLM gateway (key pool / rotation / load-balance / failover / cost routing) | task scope | DEFERRED | Future system; POC has a simple provider abstraction, not a gateway. |
| OOS1 | `ee/` enterprise cloud (SSO / billing / remote workers / Den) | research §3.7, reference-delta | OUT_OF_SCOPE | License boundary; ~91% of reference churn; never part of local-PC core. |
| OOS2 | Remote-access / multi-user server mode | research §3.5 (loopback default, opt-in `--remote-access`) | OUT_OF_SCOPE | Cowork GHC invariant: local service is loopback-only. |
| OOS3 | Chat connectors (WhatsApp / Telegram / Slack bots) | research §4 (unbuilt; orphan `baileys` dep only) | OUT_OF_SCOPE | Not built in reference; not a Cowork GHC requirement. |

## 4. Acceptance criteria (MUST and SHOULD)

Criteria are written to be observable and testable. Negative/error cases are called out
where they matter. "The service" = the local application service (loopback only, L3 picks
the mechanism); "the runtime" = the agent/tool runtime; "the workspace" = the granted
local folder.

### Workspace
- **W1 (MUST)** — Given the app is running, When the user invokes "open workspace", Then a
  native OS folder picker opens; When a folder is selected, Then the app treats it as the
  active workspace and no other folder is accessible without a new grant.
- **W3 (MUST)** — Given a picked path, When it does not exist / is not a directory / is not
  writable, Then the app rejects it with a clear message and no session starts. Given a path
  containing spaces and/or Unicode characters (e.g. `C:\Users\名前\My Projects (test)`), When
  selected, Then it is accepted and all subsequent file operations resolve correctly.
- **W4 (MUST)** — Given an active workspace, When any file operation targets a path outside
  the workspace root, Then the service refuses it at the execution boundary (not just the UI)
  and records the refusal. See F4 for traversal specifics.
- **W2 (SHOULD)** — Given prior workspaces were opened, When the app starts, Then a recent
  workspaces list is shown and selecting one reopens it without re-picking; a removed/renamed
  folder is shown as unavailable rather than silently failing.

### Agent session
- **S1 (MUST)** — Given a workspace, When the user creates a session, Then it appears in a
  session list; When the user renames it, Then the new name persists; When reopened, Then its
  message history is shown. Continuing a session appends to the same history.
- **S2 (MUST)** — Given an active session, When the user sends a prompt, Then the response
  streams incrementally without blocking the UI; When the runtime finishes, Then a real
  terminal state is shown (not a fabricated one, see EV7).
- **S3 (MUST)** — Given a task is running, When the user cancels, Then the runtime stops
  producing output for that task, the UI reflects a cancelled (not completed) state, and no
  further file mutations from the cancelled task are applied.
- **S6 (MUST)** — At all times the UI shows a truthful session/runtime status (idle / working
  / waiting-for-approval / error / cancelled / runtime-down); the status never shows "ready"
  or "done" when the runtime is actually down or busy.
- **S4 (SHOULD)** — Given sessions existed before an app restart, When the app reopens, Then
  prior sessions are listed and at least their history is restorable; if restore is not
  feasible for an in-flight task, the UI says so honestly rather than faking resumption.

### Execution visibility
- **EV1–EV4 (MUST)** — During a task the UI honestly renders: the plan/todo (EV1), per-step
  status transitions (EV2), each tool call the runtime makes (EV3), and each file mutation
  with its target path (EV4). These reflect real runtime events, not synthesized ones.
- **EV6 (MUST)** — When any step errors, Then the UI shows the error with a recovery action
  (retry / adjust / cancel) and never a raw stack trace or a leaked secret.
- **EV7 (MUST)** — The UI must never display a "completed" / "success" state that is not
  backed by a real terminal event from the runtime/service. A test injects a mid-task failure
  and asserts the UI does not show completion.

### Permission & approval
- **P1 (MUST)** — Every permission/approval request presented to the user originates from the
  execution boundary (runtime or service), not from UI-only heuristics.
- **P2 (MUST)** — A permission request presents clear Allow and Deny actions describing the
  action and its target.
- **P3 (MUST, load-bearing)** — Given a pending action requiring approval, When the user
  clicks Deny, Then the service prevents the action from occurring on disk / in the runtime.
  A test performs a Deny on a file write and asserts the file is unchanged on disk. Bypassing
  the UI (calling the service directly without approval) must also be blocked.
- **P5 (MUST)** — Given an important decision (approval grant/deny, sensitive file op,
  provider change), When it occurs, Then a local audit event is recorded with no secret
  values in it.
- **P7 (MUST)** — Given the local application service is running, When its listening sockets
  are inspected, Then it is bound only to loopback (`127.0.0.1` and/or `::1`) and is not
  reachable from another host on the network. A test connects from a non-loopback interface
  and asserts the connection is refused. Any non-loopback binding requires an explicit L3 ADR
  and is otherwise treated as a defect.
- **P4 (SHOULD)** — Sensitive actions (e.g. delete, bulk write) carry a higher approval level
  than routine reads, and the UI communicates that level.
- **P6 (SHOULD)** — Given an approval request with no response within its timeout, Then the
  decision fails closed (deny) and the action does not occur.

### File operations
- **F1 (MUST)** — Given approval where required, When the agent reads/creates/edits a file,
  Then the change is applied through the service and verifiable on disk; the UI reflects it
  (see EV4). The UI never writes the filesystem directly.
- **F3 (MUST)** — Given a delete request, When it is not explicitly approved, Then no file is
  deleted; When approved, Then the file is removed and an audit event is recorded.
- **F4 (MUST, negative)** — Given inputs using `..`, an absolute path outside the workspace, a
  UNC path, or a symlink escaping the workspace, When submitted, Then the service refuses the
  operation and records the refusal; a test asserts no file outside the workspace is touched.
- **F6 (MUST)** — File-mutation tests assert the actual on-disk bytes/state after the
  operation, not just a UI or API success response.
- **F2 (SHOULD)** — Move/rename within the workspace works under permission and is reflected
  on disk; a move that would escape the workspace is refused (as F4).
- **F5 (SHOULD)** — Before applying an edit, the UI shows a diff or a human-readable
  description of the change so the user can make an informed Allow/Deny.

### Provider & model
- **PR1 (MUST)** — The provider abstraction is provider-neutral and screen-independent: adding
  a provider does not require changing unrelated UI/business code, and no single vendor is
  hard-coded into the core flow.
- **PR2/PR3 (MUST)** — Given provider settings, When the user adds a credential and clicks
  "test connection", Then a real (or contract-mocked) call reports success or a mapped error;
  the credential value is never echoed back into the UI, DOM, logs, or screenshots.
- **PR4 (MUST)** — The user can set a default model and override the model per session; the
  per-session choice governs that session's calls.
- **PR5 (MUST)** — Switching provider/model takes effect for the next request without
  restarting the app; the UI confirms the active model honestly.
- **PR7 (MUST, negative)** — For each of invalid key, timeout, HTTP 429 rate limit, and
  provider unavailable/network loss, the UI shows a distinct, mapped, actionable error (with a
  recovery action) and no secret leaks into the message or logs. Retries are bounded (no
  infinite loop).
- **PR8 (MUST)** — No provider secret appears in any log, error message, frontend state, DOM,
  screenshot, or diagnostics export. A redaction test asserts a known secret is scrubbed
  everywhere it could surface.
- **PR9 (MUST)** — Real provider API keys are stored in a single OS-backed credential store
  (e.g. Windows Credential Manager or an L3-ADR-approved equivalent), never in browser local
  storage and never embedded in application/session state; state holds only a reference. The
  storage *mechanism* is decided by an L3 ADR; the *requirement* is fixed here. A test asserts
  no key material is present in any browser-local-storage / frontend state snapshot.
- **PR10 (MUST)** — The abstraction supports Anthropic, OpenAI, Google, OpenRouter, and one
  OpenAI-compatible provider (e.g. DeepSeek/custom endpoint). Each has a contract test
  (connect, auth error, configured model, streaming, timeout, cancellation, rate limit, error
  mapping, secret redaction). Providers not exercised with a live key are clearly marked as
  "not live-tested" in the UI/docs; the POC does not require live keys for all five.
- **PR6 (SHOULD)** — Provider health/reachability is surfaced so a user can tell a
  configured-but-unreachable provider from a working one.

### Runtime extension
- **RE6 (MUST)** — Cowork GHC reuses an existing agent/tool runtime rather than reimplementing
  one, unless an L3 ADR justifies building. The runtime version is pinned and shown (see SD7).
  Whether to reuse OpenCode or another runtime is an open L3 decision.
- **RE1 (SHOULD)** — At least one sample skill can be listed, enabled, and exercised in a
  session; a broken skill surfaces a diagnostic (see RE5).
- **RE2 (SHOULD)** — At least one MCP server can be added, enabled/disabled, and used within a
  session; removing it cleans up cleanly.
- **RE4 (SHOULD)** — A user can save a workflow template and re-run it later; this is a
  Cowork-GHC-defined capability, not inherited from OpenWork (where it is unbuilt).
- **RE5 (SHOULD)** — When an extension (skill / plugin / MCP) fails to load or run, the app
  shows a clear diagnostic (name, reason) without crashing the session.

### Settings & diagnostics
- **SD1 (MUST)** — General and provider settings are viewable and editable; changes persist
  across restart.
- **SD2 (MUST)** — Runtime status (up/down, version) is shown truthfully and updates when the
  runtime state changes.
- **SD3 (MUST)** — Logs are redacted by default (no secrets), verbose/dev logging is
  off-by-default and opt-in, and enabling it does not disable redaction.
- **SD7 (MUST)** — The app shows both the Cowork GHC version and the runtime version.
- **SD4 (SHOULD)** — A diagnostics export can be produced; it reuses the same redaction as
  logs and contains no secret values.
- **SD5 (SHOULD)** — Given corrupt settings, When the app starts, Then it recovers to a safe
  default (or offers a reset) instead of crashing; a reset restores working defaults.
- **SD6 (SHOULD)** — The user can explicitly delete local application data (sessions/history);
  this is a distinct opt-in action, separate from `clean.bat`, and it does not delete data
  without confirmation.

## 5. Windows lifecycle acceptance

These make the operational requirements of the four scaffolded scripts testable. Grounded
in `scripts/README.md` and `scripts/cleanup-manifest.json`.

- **LC5 double-click & root independence (MUST)** — Each of `init.bat`, `start.bat`,
  `stop.bat`, `clean.bat` runs when double-clicked from File Explorer with no terminal, no
  `cd`, no admin rights, and no file editing. Each self-locates the project root via `%~dp0`
  and behaves identically regardless of the caller's current working directory (including
  being launched from a different drive). Each pauses at the end so output is readable.
- **LC5 honest exit codes (MUST)** — Every script returns an honest exit code and never
  always-returns-0. Documented codes hold: `0` success or valid no-op; `3` start not-ready;
  `4` clean refused (app running); `9` Node.js missing. A script never prints success while
  returning failure, and never the reverse.
- **LC1 init (MUST)** — `init.bat` is idempotent: running it twice leaves a valid environment
  and does not overwrite user config or credentials. It creates `.runtime/` subdirs, reports
  missing toolchain (Node/npm/git) with install guidance and a non-zero code, and reports
  "nothing to install now" honestly when no app `package.json` exists yet.
- **LC2 start (MUST)** — `start.bat` prompts to run `init.bat` if the environment is not
  initialized. While the app runtime is not yet built it reports NOT READY and exits `3`
  rather than faking a launch. When a runtime exists it starts the local services/app and
  tracks process state under `.runtime/`.
- **LC3 stop (MUST)** — `stop.bat` stops only Cowork GHC's own tracked processes (from
  `.runtime/pids/`), tries graceful shutdown before force, never kills by generic name (e.g.
  `node.exe`), never touches processes it did not start, and treats "nothing running" as a
  valid `0` result. A stale PID is handled without error.
- **LC4 clean preserves protected paths (MUST)** — `clean.bat` first prints exactly what
  would be deleted and asks for confirmation (default No); `--yes` is required for
  non-interactive runs. It deletes only paths in the `generated`, `downloaded-library`, and
  `runtime-temporary` categories of `cleanup-manifest.json` and refuses any path overlapping a
  `preserve` entry. It NEVER deletes `.git/`, source, `docs/`, `.agent-workflow/`, `.claude/`,
  `.agents/`, `CLAUDE.md`, `AGENTS.md`, `tools/`, `scripts/`,
  `.loop-engineer/state|checkpoints|evidence|reports|source`, credentials, or the user
  workspace. It refuses to run if the project root is uncertain, if a target would escape the
  project (traversal), or if Cowork GHC appears to be running (exit `4`; run `stop.bat`
  first). Sessions/history/credentials are never removed by `clean.bat` (see SD6).

## 6. Deferred & out-of-scope

Boundary is designed (port/adapter seam) but nothing is built in the POC:
- **D1 Dispatch / fan-out agent** — a future multi-agent dispatch system; POC exposes only a
  clean seam, no fan-out.
- **D2 Microsoft automation** — Teams/SharePoint/OneDrive/Graph automation is a future
  adapter behind the integration seam; not built.
- **D3 Knowledge system** — RAG/vector/graph knowledge is a future subsystem; POC has no
  retrieval index.
- **D4 Advanced LLM gateway** — key pool / rotation / load-balance / failover / cost routing
  is future; the POC has a simple provider abstraction (Area 6), not a gateway.

Explicitly out of scope for Cowork GHC:
- **OOS1 `ee/` enterprise cloud** — SSO/billing/remote workers/Den; a license boundary and
  the bulk of reference churn (reference-delta), never part of the local-PC core.
- **OOS2 remote-access / multi-user server mode** — the local service is loopback-only per
  invariant; multi-user/remote hosting is not a Cowork GHC capability.
- **OOS3 chat connectors (WhatsApp / Telegram / Slack bots)** — unbuilt even in the reference;
  not a requirement.

## 7. Open decisions for L3 (questions, not answers)

1. **Credential store mechanism** — What single OS-backed store holds provider keys on
   Windows (Windows Credential Manager via DPAPI? a vetted keyring library? something else),
   and how do sessions reference keys without ever holding key material? (Requirement PR9 is
   fixed; the mechanism is not.) Needs an ADR.
2. **Runtime reuse vs build** — Does Cowork GHC reuse OpenCode (as OpenWork does) as the
   pinned agent/tool runtime, reuse a different existing runtime, or build one? On what
   evidence (Windows support, license, packaging, testability)? (Requirement RE6 is fixed.)
   Needs an ADR.
3. **Desktop shell** — Electron or Tauri (or other) for the Windows native shell and the
   native capabilities (folder picker, tray, auto-update, process supervision)? The reference
   is Electron despite a stale Tauri README (research §4). Needs an ADR.
4. **Provider abstraction shape** — What is the port/adapter contract for providers such that
   the five target providers (PR10) and a future LLM gateway (D4) both fit without reshaping
   the core? Needs an ADR.

(Also flagged for L3, downstream of the above: local service transport/IPC and loopback
binding, single owner of the runtime child-process lifecycle and `.runtime/` state, and
persistence/session-store choice. These follow from the invariants and the decisions above.)

## 8. Traceability — MUST → capability area

| Area | Area name | MUST capabilities |
|------|-----------|-------------------|
| 1 | Workspace | W1, W3, W4 |
| 2 | Agent session | S1, S2, S3, S6 |
| 3 | Execution visibility | EV1, EV2, EV3, EV4, EV6, EV7 |
| 4 | Permission & approval | P1, P2, P3, P5, P7 |
| 5 | File operations | F1, F3, F4, F6 |
| 6 | Provider & model | PR1, PR2, PR3, PR4, PR5, PR7, PR8, PR9, PR10 |
| 7 | Runtime extension | RE6 |
| 8 | Settings & diagnostics | SD1, SD2, SD3, SD7 |
| 9 | Windows lifecycle scripts | LC1, LC2, LC3, LC4, LC5 |

Every MUST above has at least one acceptance criterion in §4/§5. No capability is marked
MUST without a criterion. SHOULD capabilities also carry criteria; COULD capabilities are
sketched in the matrix rationale and are non-gating.

## 9. Counts

- MUST: 41 — W1, W3, W4; S1, S2, S3, S6; EV1, EV2, EV3, EV4, EV6, EV7; P1, P2, P3, P5, P7;
  F1, F3, F4, F6; PR1, PR2, PR3, PR4, PR5, PR7, PR8, PR9, PR10; RE6; SD1, SD2, SD3, SD7;
  LC1, LC2, LC3, LC4, LC5.
- SHOULD: 15 — W2; S4; EV5; P4, P6; F2, F5; PR6; RE1, RE2, RE4, RE5; SD4, SD5, SD6.
- COULD: 2 — S5; RE3.
- DEFERRED: 5 — W5; D1, D2, D3, D4.
- OUT_OF_SCOPE: 3 — OOS1, OOS2, OOS3.
- Total capabilities classified: 66.
