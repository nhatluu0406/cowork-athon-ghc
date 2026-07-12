# L4 Frontend / Desktop-Shell Design Review — Architecture Freeze Candidate

Review target: loop L4 (Architecture Review + freeze), task **L4-REV-FRONTEND**
Reviewer role: frontend/desktop-shell reviewer (independent; did NOT author the ADRs/design — product-architect did)
Lens: `.claude/rules/frontend.md` invariants + UI-as-client layering, permission enforcement, secrets, state contract, accessibility.
Verdict: **PASS_WITH_FINDINGS**

Findings by severity: CRITICAL 0 | HIGH 0 | MEDIUM 4 | LOW 3.
No Critical/High. From the frontend/shell lens the architecture is sound: business logic, provider HTTP,
filesystem, credential access, error semantics, retry bounds, and EV interpretation are all kept at the
loopback service boundary, and the UI is a pure HTTP+SSE client. The MEDIUM items are client-facing
**contract-shaping and Electron-hardening** gaps that are the proper business of L4/L5 and do not make it
unsafe to freeze. **Recommendation on ADR 0002 (Electron): RATIFY.**

---

## What I checked and found clean (evidence-based)

### UI-as-pure-client — honored, and honored well (Focus 1, 5)
- **Layering (design §2, :32-66).** Renderer explicitly has "NO business logic, NO filesystem/credential
  access, NO provider HTTP"; reaches native ONLY via the preload bridge and business logic ONLY via the
  loopback service. This is the literal frontend invariant.
- **Logic kept at the boundary, not leaked to the renderer** — verified in five places, each a place the
  reference or a naive design would have leaked logic into the UI:
  - PR7 error **semantics** are canonical at the service (`mapError`, ADR 0005 :60-63,73): "The UI only
    *formats* these; it never invents error semantics." Retries are bounded at the boundary, not the UI.
  - EV interpretation: OpenCode SSE is mapped to a Cowork-GHC EV model **at the service**; "the UI never
    speaks OpenCode's schema directly" (ADR 0001 §3 :60-64). Schema churn cannot leak into the UI.
  - Permission **origin + enforcement** are at the service (design §5 :107-118); UI only renders/relays.
  - Path safety / workspace confinement at the service (design §5 :114-116).
  - Redaction at the boundary (design §6 :129-131; ADR 0006 SEC-2).
  This discipline is a genuine strength; I found no place the design pushes business logic into the renderer.
- **Source-of-truth per state type (design §4 :88-103)** is server-owned (OpenCode SQLite for session
  content; service for permission/EV/audit; OS store for credentials; `.runtime/` for process state). At
  the domain level this satisfies "single source of truth; no duplicated server state." (One client-facing
  ambiguity — model preference — is a MEDIUM below.)

### Secrets never in the renderer/DOM/localStorage (Focus 1, 6)
- Only a `CredentialRef = { store:"os", account }` handle is ever in frontend state (design §6 :123-124;
  ADR 0006 :36-42; ADR 0005 :39,49). Keys are resolved and injected at the service at launch/call time
  (SEC-1), never reach the renderer, and negative test #2 asserts no key in any frontend-state /
  localStorage snapshot (ADR 0006 :56). Correct.

### Permission Allow/Deny maps to real server-side enforcement (Focus 2)
- The service holds the pending action; on **Deny** it never forwards the reply / never performs the
  mutation, a UI-bypass (direct service call) is blocked by service-side reply authorization, and the Deny
  test asserts the file is **unchanged on disk / F6** (design §5 :109-113). Fail-closed on timeout (P6) and
  audit (P5) are at the service (§5 :117-118). A UI "Deny" is not cosmetic — it blocks on disk. Correct.
- Honest EV rendering is feasible over SSE: plan/todo (EV1), per-step (EV2), tool calls (EV3), file
  mutations (EV4), progress (EV5), and errors-with-recovery (EV6) all ride the mapped EV stream from real
  runtime events, and EV7 ("never a fabricated completed state") is anchored to real terminal events
  (ADR 0001 :104; design §5). The transport can carry everything the honesty invariants require.

### Streaming is transport-compatible with a non-blocking UI (Focus 3)
- SSE (ADR 0003 :29-35) is uni-directional token/step streaming over loopback; network I/O is async so it
  does not block the renderer main thread (S2 :188-189). Cancel is a plain HTTP request (S3), so no
  bidirectional channel is needed. The transport choice does not preclude the "no excessive re-renders"
  rule (a coalescing strategy is an L5 concern — LOW note below).

### Electron (ADR 0002) from the UI/shell standpoint — RATIFY (Focus 4)
- The **standalone loopback service (ADR 0003)** already decouples the UI and all business logic from the
  shell: renderer/shell/tests are equal HTTP clients (ADR 0003 :44). So the shell's surface shrinks to a
  preload bridge + service supervision + tray/auto-update — exactly the surface ADR 0002 :69-72 says a
  Tauri revisit would re-do. The UI (React) is shell-agnostic either way; switching cost is low and
  isolated. This materially de-risks the Electron choice from a frontend perspective.
- Electron's UI-relevant wins are real for this project: proven native folder picker (W1), tray,
  `electron-updater`+NSIS auto-update, `node-pty`-class native deps, single Node/TS toolchain, and
  main-process supervision logic unit-testable under Node `--test` (ADR 0002 :35-58). The only thing traded
  is bundle/idle-RAM/default-deny footprint, which the scope does not make first-order POC goals; the
  revisit trigger (ADR 0002 :68-72) is concrete and testable, and the shell-neutral service/credential/
  provider layers make it genuinely reversible.
- **RATIFY Electron**, conditioned on adopting an explicit renderer-hardening checklist (MEDIUM-3 below) —
  Electron's "security is opt-in, not default-deny" (ADR 0002 :64) is the one place the choice actively
  adds frontend attack surface, and the design does not yet enumerate the mitigations.

---

## Findings

- [MEDIUM] **Frontend-1 — The client-facing EV event model + state contract is asserted but never shaped.**
  file: docs/architecture/cowork-ghc-implementation-design.md:36-38,92 ; docs/architecture/decisions/0001-agent-tool-runtime-and-persistence.md:60-64
  detail: `ProviderPort` gets a concrete interface sketch (ADR 0005 :35-50), but the EV model that the UI
    renders EV1–EV7 from is only named ("Cowork-GHC-owned EV event model") with no shape: no event-type
    set, no per-step status enum, no defined **terminal** states, no plan/todo shape. This is the single
    most load-bearing frontend contract (every honesty invariant EV1–EV7 + S6 depends on it) and it is the
    least specified.
  failure_scenario: With no defined terminal-state set, the UI is pushed to *infer* "completed"/"done" from
    the absence of further events or from heuristics — precisely the EV7 violation the design forbids
    ("never render a fake completed state"). Two independent L5 implementers map the schema differently and
    the UI silently diverges from runtime reality.
  recommendation: In L4, sketch the EV contract the way ADR 0005 sketches `ProviderPort`: the event union
    (plan/todo, step-status, tool-call, file-mutation, progress, error-with-recovery, terminal), an explicit
    per-step status enum, and the closed set of terminal states the UI is *allowed* to render as final. Pin
    "the UI may only show a terminal state on an explicit terminal event." Non-blocking for freeze; must
    land before L5 builds the timeline.

- [MEDIUM] **Frontend-2 — No SSE reconnect / state-snapshot resync path; UI is forced to event-source
  server state in the client.**
  file: docs/architecture/decisions/0003-local-service-transport-placement-loopback.md:29-35,102-104 ; docs/architecture/cowork-ghc-implementation-design.md:105-118
  detail: The design specifies the SSE **delta stream** but no authoritative **snapshot/query** endpoint for
    the UI to hydrate/reconcile current session state, EV timeline, and any *pending* permission request.
    SSE connections drop (sleep/resume, service restart, transient loopback error).
  failure_scenario: (a) The stream drops while a permission is pending; the service fail-closes on timeout
    (P6) but the UI never sees the resolution and shows a stale "waiting-for-approval," or misses the
    terminal event and shows nothing — an S6/EV7 honesty break. (b) With no snapshot to rehydrate from, the
    UI must accumulate all state purely from the event stream (client-side event sourcing), which
    *duplicates server state in the client* (contra `.claude/rules/frontend.md` single-source-of-truth) and
    diverges permanently after any missed event.
  recommendation: Add a state-snapshot/query contract (GET current session state + EV timeline + pending
    approvals) that the UI fetches on connect and on every SSE (re)connect, with the SSE stream as delta on
    top. Define the reconnect/resync rule. This is the mechanism that lets the frontend honor
    single-source-of-truth without re-deriving state. Non-blocking for freeze; specify in L4/early L5.

- [MEDIUM] **Frontend-3 — Electron renderer-hardening checklist and preload surface are not enumerated.**
  file: docs/architecture/decisions/0002-desktop-shell.md:56-57,64 ; docs/architecture/cowork-ghc-implementation-design.md:169-186
  detail: The design states "contextIsolation on" and "minimal preload bridge" but does not enumerate the
    rest of the Electron lockdown that ADR 0002 :64 itself admits is opt-in: `nodeIntegration:false`,
    `sandbox:true`, a strict renderer **Content-Security-Policy**, `will-navigate`/`setWindowOpenHandler`
    lockdown to block navigation to remote origins, and an **enumerated, typed preload channel list** (no
    generic `ipcRenderer.invoke` passthrough). The preload "native only" surface (§9) is not listed.
  failure_scenario: The renderer displays model/agent-generated content (markdown, tool output, file
    diffs) — an injection vector. Without a CSP + navigation lockdown, injected content in an Electron
    renderer escalates from XSS toward RCE / local-file / credential-store reach in a way a browser tab
    could not. A generic preload passthrough re-opens the very fs/native access the layering forbids.
  recommendation: Make the Electron hardening checklist (contextIsolation, nodeIntegration:false, sandbox,
    strict CSP, navigation/new-window deny, enumerated preload channels) an explicit ADR 0002 consequence
    and an L5 acceptance item. This is the one place the Electron ratification adds frontend attack surface,
    so it should be a named condition of RATIFY. Non-blocking for freeze.

- [MEDIUM] **Frontend-4 — Model-preference source-of-truth is ambiguous between browser localStorage and
  the service settings store.**
  file: docs/architecture/decisions/0006-credential-store.md:41-42 ; docs/architecture/cowork-ghc-implementation-design.md:96,102-103 ; docs/architecture/decisions/0005-provider-abstraction.md:120
  detail: ADR 0006 :41-42 says "Model refs and other UI preferences may stay in **local storage** (they are
    secret-free)," while design §4 :96 and ADR 0005 PR5 :120 put model configuration in the **app settings
    store** + a live **runtime config overlay**. It is unstated which is authoritative for the default and
    per-session model.
  failure_scenario: If localStorage is treated as authoritative (or as a second writer), the UI shows a
    model that the service/runtime overlay is not actually applying — a direct PR5 honesty break ("the UI
    confirms the active model honestly," scope :258) and a single-source-of-truth violation for model
    preference (two stores for one state type).
  recommendation: State that the **service settings store owns** default + per-session model preference (it
    is what drives the runtime overlay); the renderer may cache for first paint but must reconcile to the
    service value and must never be the writer of record. localStorage caching is fine only as a
    non-authoritative hint. Non-blocking for freeze; clarify in L4.

- [LOW] **Frontend-5 — Delivery of the per-launch boundary client-token to the renderer is unspecified.**
  file: docs/architecture/decisions/0003-local-service-transport-placement-loopback.md:66-68
  detail: The service issues an unpredictable per-launch token to its own clients so a co-resident process
    "cannot trivially call the boundary," but how the **renderer** receives it is not stated. (The L3
    security review MEDIUM-1 covered token *distinctness*, not renderer delivery.)
  failure_scenario: If the token is placed in `localStorage`/`sessionStorage` it persists stale across
    launches and sits in a JS-reachable store alongside the "no secrets in localStorage" surface, blurring
    the credential-hygiene invariant.
  recommendation: Deliver the per-launch token to the renderer via the preload bridge / in-memory only,
    never web storage; scope its lifetime to the launch. Backstopped by the P7 test but should be stated.

- [LOW] **Frontend-6 — Credential entry-time transient in the DOM is not addressed.**
  file: docs/architecture/decisions/0006-credential-store.md:120-124 (design §6) ; scope PR2 :253-254
  detail: The design correctly forbids ever *echoing* a key back to the UI, but says nothing about the
    unavoidable entry moment when the user types a key into the provider settings field.
  failure_scenario: A key left in component state / a re-rendered value / autofill / an autocomplete cache
    leaves key material reachable in the DOM longer than necessary, or the field gets repopulated on edit
    (an echo-back by another name).
  recommendation: Specify the credential field as write-only: `type=password`, `autocomplete="off"`, never
    repopulated from stored state, transmitted straight to the service over loopback, and cleared from
    component state after submit. Cosmetic-level but names an inherent renderer-side secret transient.

- [LOW] **Frontend-7 — Accessibility is not addressed at the architecture level (not precluded, but the
  honesty invariants have an a11y dimension).**
  file: .claude/rules/frontend.md (accessibility) ; scope P2 :213-214, EV7 :207-208 ; S2 :188-189
  detail: The architecture does not preclude keyboard nav / focus / SR labels (React can satisfy all of it),
    so this is not a blocker. But the two honesty-critical surfaces — the blocking permission modal (P2) and
    the streaming EV timeline / status (S6/EV7) — carry a11y obligations that should be explicit L5
    acceptance, not assumed.
  recommendation: Make L5 acceptance include: focus-trap + labeled Allow/Deny + return-focus on the
    permission modal, and screen-reader-announced streaming/status/terminal transitions (an SR user must
    also never be told "completed" when it is not — EV7 for assistive tech). No token coalescing/`aria-live`
    strategy is defined; note it so token streaming does not spam SR output. Also fold in the LOW note that
    high-frequency token events need an L5 coalescing strategy to honor "no excessive re-renders."

---

## Deferred to L5 (noted, not worked here)
- Concrete EV event schema + terminal-state set (Frontend-1) and the snapshot/resync endpoint
  (Frontend-2) become implementation + contract-test artifacts.
- Electron hardening checklist + preload channel list as an L5 acceptance gate (Frontend-3).
- Token-streaming coalescing / `aria-live` batching strategy (Frontend-7).

## Gate recommendation
**Advance / freeze L4 with the four MEDIUM items recorded as L4/early-L5 contract-shaping tasks.**
0 Critical / 0 High. From the frontend/desktop-shell lens the architecture honors every load-bearing
invariant — UI is a pure client, Deny blocks on disk, secrets stay out of the renderer, and honest EV
rendering is transport-feasible. **ADR 0002 (Electron): RATIFY**, conditioned on adopting the renderer
hardening checklist (Frontend-3). The residual risk is entirely on the *client-facing contract*
(EV schema + resync + model-pref ownership), not on the shell choice.
