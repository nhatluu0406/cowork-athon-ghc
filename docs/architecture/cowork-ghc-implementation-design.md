# Cowork GHC — Implementation Design (L3, Architecture Candidates)

> Status: **Accepted — FROZEN in Loop L4 (Architecture Review), 2026-07-11.** This design is the
> coherent whole that the six ADRs (`docs/architecture/decisions/0001`–`0006`) compose into. Every
> decision here is **Accepted (frozen)**: ratified after a five-lens critique (runtime, frontend,
> test, security, UX), a threat model, and a reference-verification pass, with the review-driven
> corrections folded in. Changing a frozen decision requires a superseding ADR. This document
> contains **no feature/product code**.
> It cites L2 discovery evidence (`.loop-engineer/reports/discovery-report.md` and
> `.loop-engineer/evidence/L2/*`) for load-bearing claims.

Cowork GHC is its own Windows-11 local-PC desktop AI cowork product. OpenWork
(`.loop-engineer/source/openwork/` @ `1897f9f`) is a **read-only research reference**: never
forked, cloned, rebranded, or a build dependency. All "reference pattern" mentions below mean a
pattern learned from reading OpenWork, re-implemented as Cowork GHC's own code.

## 1. Design goals & invariants honored

This design is written to honor, without exception, the invariants in `.claude/rules/`:

- UI is a **client of a local application service bound to loopback only** (ADR 0003).
- Business logic is **not** in UI components; filesystem mutation goes through the
  execution/application boundary (§3, §5).
- **Permission is enforced at the execution boundary**, not just in the UI — a Deny actually
  blocks on disk / in the runtime (§5).
- **One source of truth per state type**; one session mechanism; one credential store (§4, §6).
- Provider abstraction is provider-neutral (ADR 0005).
- External integrations go through **port/adapter** seams; deferred systems are boundary-only (§7).
- **One owner/supervisor per child-process lifecycle**; PID/port/identity tracked under `.runtime/`
  (ADR 0004, §8).
- No secrets in logs, errors, frontend state, or browser local storage (ADR 0006, §6).

## 2. Layered architecture (top to bottom)

```
┌───────────────────────────────────────────────────────────────────────────┐
│  UI Client (renderer)  — React in the Electron window                       │
│  - renders sessions, EV timeline, permission prompts, settings, status      │
│  - NO business logic, NO filesystem/credential access, NO provider HTTP      │
│  - reaches native capabilities ONLY via the preload bridge                   │
│  - reaches business logic ONLY via the loopback service (HTTP + SSE)         │
└──────────────┬───────────────────────────────────┬──────────────────────────┘
   preload bridge (native only)          HTTP + SSE (loopback, per-launch token)
               │                                    │
┌──────────────▼─────────────┐        ┌─────────────▼──────────────────────────┐
│  App Shell (Electron main) │        │  Local Application Service (Node)        │
│  - native capabilities:    │ spawns │  == the EXECUTION / PERMISSION BOUNDARY  │
│    folder picker (W1), tray,│───────►│  - session/EV/permission/file/provider   │
│    auto-update, window      │        │    application logic                     │
│  - supervises ONE child:    │        │  - workspace boundary enforcement (W4/F4)│
│    the Local Service        │        │  - permission enforcement (P1/P3)        │
│  - writes app-shell PID rec │        │  - credential resolution + injection     │
└─────────────────────────────┘       │  - EV event mapping (OpenCode SSE → EV)  │
                                       │  - supervises ONE child: OpenCode        │
                                       └──────────────┬───────────────────────────┘
                                        HTTP + SSE (loopback, Basic-auth secret)
                                                      │
                                       ┌──────────────▼───────────────────────────┐
                                       │  OpenCode Runtime (pinned child)          │
                                       │  - sessions + message store (own SQLite)  │
                                       │  - tool-permission, tool calls, LLM loop  │
                                       │  - provider wire calls (auth/stream/cancel)│
                                       └──────────────┬───────────────────────────┘
                                                      │ HTTPS (provider APIs)
                                       ┌──────────────▼───────────────────────────┐
                                       │  LLM Providers (Anthropic/OpenAI/Gemini/  │
                                       │  OpenRouter/custom OpenAI-compatible)     │
                                       └───────────────────────────────────────────┘
```

Two loopback hops (renderer→service, service→runtime), both bound to `127.0.0.1`/`::1` only
(ADR 0003). The **service is the single execution/permission boundary**: everything sensitive —
workspace confinement, permission enforcement, credential injection, redaction, EV mapping —
happens there, in front of the runtime.

## 3. Why the service is standalone (not embedded)

The reference embeds its server in Electron main (`runtime.mjs:1203`). Cowork GHC instead runs the
service as a **standalone Node process** (ADR 0003) because it (a) most literally realizes "UI is a
client of a local service," (b) is **headless-testable** without a GUI (UI↔service, service↔runtime,
permission round-trip, P7, filesystem mutation all run under the Node `--test` harness), (c) yields a
clean single-owner supervision chain, and (d) keeps the boundary **shell-neutral**, preserving the
ADR 0002 Tauri revisit condition. The embedded model remains the documented fallback if the extra
process proves operationally costly.

## 4. Bounded contexts, module boundaries & source-of-truth

Each module has one responsibility (coding rules: no God services, no giant `utils`, target
< 250 lines/file). Contexts inside the Local Service:

| Context | Responsibility | Source of truth |
|---|---|---|
| Workspace | Grant/validate a folder; confine all ops (W1/W3/W4/F4) | Cowork GHC workspace registry (app-owned) |
| Session | Create/continue/rename/history/cancel (S1–S6) | **OpenCode SQLite** owns content; app owns light metadata (grouping/pin/order) |
| Execution visibility | Map runtime events → EV model; per-step/tool/file/plan (EV1–EV7) | OpenCode `/event` SSE (mapped, not fabricated) |
| Permission | Originate + enforce approvals; fail-closed; audit (P1–P7) | Service-side approval state + local audit log |
| File ops | Read/create/edit/move/delete under approval; path safety (F1–F6) | Filesystem (verified on disk) |
| Provider | `ProviderPort` config, test, model, stream-delegate, error map (PR*) | Logical model refs (app) + runtime config overlay |
| Credential | Resolve/inject key handles (PR9) | **Windows Credential Manager** (single store) |
| Settings & diagnostics | Settings, redacted logs, versions, reset (SD*) | App settings store (corrupt-tolerant) |
| Lifecycle/supervision | Spawn/track/stop children; `.runtime/` records (LC1–LC5) | `.runtime/pids/*.json` (durable) |

**One source of truth per state type** (invariant): session *content* lives only in OpenCode's
store (ADR 0001); *credentials* live only in Windows Credential Manager (ADR 0006); *runtime
process state* lives only in `.runtime/pids/` (ADR 0004); *model preferences* are logical refs in
app settings (secret-free). No parallel session mechanism, no second credential store.

## 5. Where permission is enforced & how a Deny blocks

- **Origin (P1):** every approval request originates at the execution boundary — either an OpenCode
  tool-permission event (proxied) or a service-side write-approval — never a UI-only heuristic.
- **Enforcement (P3, load-bearing):** the Local Service holds the pending action. On **Deny** it
  **never performs the file mutation** (Deny blocks the action on disk), **and** it sends an
  **explicit deny reply** back to the runtime — via OpenCode's permission-reply / `abortSession`
  path — so the runtime's pending permission request is unblocked and the session moves to an
  actionable terminal/error state. A Deny must **not** silently drop or never-forward the reply: that
  would strand the runtime waiting forever. Bypassing the UI by calling the service directly is also
  blocked — the service authorizes the reply path itself (reference pattern
  `assertOpencodeProxyAllowed`, `server.ts:634-654`; re-implemented, not copied). A Deny test asserts
  the target file is **unchanged on disk** (F6) **and** the session reaches a terminal state (no hang).
- **Workspace confinement (W4/F4):** all file ops resolve against the granted workspace root;
  `..`, absolute escapes, UNC, and symlink escapes are refused and recorded (reference pattern
  `normalizeWorkspaceRelativePath`/`resolveSafeChildPath`).
- **Fail-closed (P6) + audit (P5):** approval timeout → deny; important decisions (grant/deny,
  sensitive file op, provider change) write a local audit event with no secret values.
- **Honest EV state + resync (EV1–EV7/S6, ADR 0003):** the service defines the EV event types and
  the **terminal-state set** (`completed`/`errored`/`cancelled`/`denied`) — the load-bearing surface
  L5 must fully specify. A reconnecting client re-syncs **authoritative server state** from a
  snapshot/resync endpoint (not client-side event-sourcing), so a dropped stream never leaves a stale
  `waiting`/`completed` view. Two-hop SSE (runtime→service→renderer) applies a coalescing/backpressure
  contract so token streaming never floods the UI thread. No fake `completed` state is ever rendered.

## 6. Where secrets live (and never live)

- **Single store:** Windows Credential Manager via `@napi-rs/keyring` (ADR 0006).
- **In state:** only a `CredentialRef = { store: "os", account }` handle (ADR 0005). Never key
  bytes in the renderer, DOM, frontend state, browser local storage, logs, or diagnostics.
- **Injection (SEC-1, AC1–AC6):** the service resolves the key at the boundary and injects it as a
  **per-provider environment variable** into the OpenCode child's spawn env at launch (OpenCode reads
  provider keys from process env). Cowork GHC **never** calls `c.auth.set` and never writes the
  runtime's `auth.json`/`env.json` (writing OpenCode's default `auth.json` is forbidden). Env
  injection is the only sanctioned channel. Negative tests — for **both** a standard provider **and**
  the custom OpenAI-compatible provider — assert no key on disk, in logs, or in any frontend snapshot
  (ADR 0006). L6 confirms the exact per-provider env var names via a keyless spike against the pinned
  binary (gated to the ADR 0001 pin).
- **Redaction (SEC-2, PR8/SD3):** the scrubber matches the secret **VALUE** (not just the env-var
  name — name-only matching leaks the value; reference `managed-opencode.ts:27,87`).
  `ProviderPort.redactionPatterns()` feeds it, and coverage includes the **diagnostics bundle** and
  the **execution-metadata record** (the reference scrubber covered only session/host tokens —
  `diagnostics-bundle.ts:121-138`). Redaction stays on with verbose logging.

## 7. Port/adapter seams (present + DEFERRED boundary-only)

- **Present:** `ProviderPort` (ADR 0005) — one implementation delegating to OpenCode now.
- **DEFERRED — boundary only, nothing built:**
  - **D1 Dispatch / fan-out** — a `DispatchPort` seam over the session context; POC exposes the
    seam shape only.
  - **D2 Microsoft automation** (Teams/SharePoint/OneDrive/Graph) — an `IntegrationPort` adapter
    slot; not built.
  - **D3 Knowledge system** (RAG/vector/graph) — a `KnowledgePort` retrieval seam; no index built.
  - **D4 LLM gateway** (key pool / rotation / failover / cost routing) — a second `ProviderPort`
    implementation + routing table; drop-in because `CredentialRef` is a handle and `ModelRef` is
    logical (ADR 0005 §D4). Not built.
- **Out of scope:** OOS1 `/ee` (Fair Source — never copied), OOS2 remote/multi-user, OOS3 chat
  connectors.

## 8. `.runtime/` layout & supervision (ADR 0004)

```
.runtime/
  pids/      app-shell.json | local-service.json | agent-runtime.json  (see ADR 0004 schema)
  logs/      per-role redacted logs (SD3)
  state/     transient supervision state
  temp/      scratch (clean.bat allowlist)
```

- Supervision chain: lifecycle CLI → App Shell → Local Service → OpenCode; **one owner per child**.
- Each `.runtime/pids/*.json` carries `{ role, pid, port, host, startedAt, exePath, runtimeVersion }`
  (no `identityToken` — the env/CLI-token scheme is infeasible: Win32_Process exposes no env, and
  OpenCode `/global/health` returns only `{healthy, version}`). Identity is verified before any kill
  by re-matching **PID + process start-time + exePath** via `Get-CimInstance Win32_Process` (a reused
  PID cannot be mis-killed) — **never** by generic image name (LC3). Per-run data isolation uses child
  ENV (`XDG_DATA_HOME` + `OPENCODE_CONFIG_DIR`), since OpenCode has no `--data-dir` flag. This local,
  non-secret **supervision identity** is distinct from the ADR 0003 **boundary client token** (a
  per-launch secret); the trust boundary is single-user/single-machine. Stale records are pruned;
  "nothing running" is a valid `0`.
- Graceful stop = loopback shutdown request → then `taskkill /PID <pid> /T /F` (tree) or a Win32
  Job Object (SIGTERM is not graceful on Windows and does not kill descendants — discovery-report
  §4). Aligns with the existing `tools/loop-engineer/lifecycle.mjs` scaffold (`RUNTIME_DIRS`,
  `parsePidFile`, `runningPids`) which L5/L6 turn from stubs into the real writer/reaper.

## 9. Component / module map

```
cowork-ghc/
  app/shell/            Electron main + preload: picker(W1), tray, auto-update, service supervisor
  app/ui/               React renderer: sessions, EV timeline, permission modal, settings, status
  service/              Local application service (standalone Node, loopback) — the boundary:
    workspace/          grant + validate + confine (W1/W3/W4/F4)
    session/            session orchestration over OpenCode (S1–S6) + light metadata
    execution/          EV event mapping (OpenCode SSE → EV model, EV1–EV7)
    permission/         approval origin + enforcement + audit (P1–P7)
    files/              file mutation pipeline + path safety (F1–F6)
    provider/           ProviderPort (PR*) — delegates wire calls to the runtime
    credential/         @napi-rs/keyring adapter + inject-at-launch (PR9/SEC-1)
    diagnostics/        redacted logging + scrubber + diagnostics export (SD3/SD4/PR8/SEC-2)
  runtime/              OpenCode pin + launch/config + supervision glue (RE6/ADR 0001/0004)
  tools/loop-engineer/  existing lifecycle CLI (.runtime/ writer/reaper — ADR 0004)
  scripts/              thin %~dp0 .bat entry points (LC1–LC5)
```

Files stay cohesive and < 250 lines where practical (coding rules); ports/adapters used only at
real boundaries.

## 10. Requirements → component traceability

| Req | Component / ADR |
|---|---|
| W1 | app/shell picker → service/workspace (ADR 0002) |
| W3/W4/F4 | service/workspace + service/files path safety (§5) |
| S1–S6 | service/session over OpenCode store (ADR 0001) |
| EV1–EV7 | service/execution event mapping (ADR 0001 §3) |
| P1/P2/P3/P5/P7 | service/permission + ADR 0003 loopback (§5) |
| P6/P4 | service/permission fail-closed + approval levels |
| F1/F3/F6 | service/files mutation pipeline (§5) |
| PR1/PR2/PR3/PR4/PR5/PR7/PR10 | service/provider ProviderPort — PR2 `configureCredential(ref)` (ADR 0005) + service/credential (ADR 0006) |
| PR8/SD3 | service/diagnostics scrubber (ADR 0006 SEC-2) |
| PR9 | service/credential @napi-rs/keyring (ADR 0006) |
| RE6 | runtime/ OpenCode pin (ADR 0001) |
| SD1/SD2/SD7 | service/diagnostics + app/ui status + version surfacing |
| LC1–LC5 | tools/loop-engineer + scripts + ADR 0004 |
| D1–D4 | port seams, boundary-only (§7) |

## 11. L4-locked seams (renderer hardening, test fixtures, cold-start)

These are frozen at L4 as load-bearing seams; L5/L6 implement and test them but cannot drop them.

- **Electron renderer-hardening checklist (frontend MED-3).** The renderer displays
  model-generated content, so the shell (ADR 0002) locks: a restrictive **CSP**; `sandbox: true`;
  `nodeIntegration: false`; `contextIsolation: true`; **navigation lockdown** (block
  `will-navigate` / `window.open` to non-app origins); and **no generic IPC passthrough** — the
  renderer reaches business logic only through the typed loopback boundary client and native
  capabilities only through the narrow, typed preload bridge.
- **Captured-real-frame test-fixture seam (test HIGH-1).** Contract, integration, and EV-reducer
  tests run against fixtures **captured from the REAL OpenCode SSE boundary** (recorded frames), not
  hand-invented frames. Re-capture is wired into the **ADR 0001 pin/upgrade gate**: any OpenCode
  version bump re-captures fixtures so tests cannot silently drift from the real wire shape. This
  seam is locked so L5/L6 cannot ship hollow-green tests against fictional frames.
- **Cold-start readiness contract + crash recovery UX (UX MED).** Boot is multi-process (shell +
  service + supervised OpenCode child); the service and each child expose a **health/ready** signal
  and the UI shows **progressive readiness** (not a blank hang) until the chain is up. If a
  supervised child crashes, the UI **surfaces the crash and offers a recovery action** (restart /
  view diagnostics) — never a silent hang or a fake-ready state.

## 12. Open items handed to L4

- Ratify or override each ADR (esp. **0002 shell** — the closest call — and **0003 placement**).
- Confirm the standalone-service vs embedded trade against operational cost.
- Confirm the OpenCode pin value + upgrade-test gate, and the SSE-schema re-normalization extent.
- Confirm the identity-token supervision scheme (Job Object vs `taskkill /T`).
- Confirm the 5th provider is a user-defined OpenAI-compatible endpoint.
- Confirm `@napi-rs/keyring` vs Electron `safeStorage`.
- The multi-role critique, threat-model pass, and architecture freeze are L4's, not this loop's.
