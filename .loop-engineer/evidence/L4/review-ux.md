Review target: L4 (Architecture Review + freeze) -- task L4-REV-UX
Reviewer role: ux-performance-reviewer
Reviewer independence: I did not author the design or any ADR under review.
Verdict: PASS_WITH_FINDINGS

Scope reviewed:
- docs/architecture/cowork-ghc-implementation-design.md (whole)
- docs/architecture/decisions/0002-desktop-shell.md
- docs/architecture/decisions/0003-local-service-transport-placement-loopback.md
- docs/architecture/decisions/0004-windows-process-lifecycle-and-supervision.md
Grounding: .loop-engineer/reports/discovery-report.md,
docs/product/cowork-ghc-scope-and-acceptance.md, .claude/rules/frontend.md
Lens: does the frozen-candidate architecture PRECLUDE a good UX or BAKE IN a perf
hazard? No UI exists yet, so this is design-level, not pixel-level.

Summary: The architecture does NOT preclude a good experience. The four-layer split,
the loopback boundary, and the honest-status invariants (S6/SD2/EV6/EV7) are UX-positive,
and accessibility is fully attainable (React-in-Electron DOM). However, four cross-cutting
experience/perf behaviours that are load-bearing for this specific multi-process,
two-loopback-hop topology are left unspecified or ambiguous at the contract level.
None is a redesign-forcing blocker; one (HIGH) must have its decision recorded before freeze.

---

Findings:

- [HIGH] Deny-reply semantics are ambiguous and, read literally, strand the runtime/session
  file: docs/architecture/cowork-ghc-implementation-design.md:108-110 (section 5 Enforcement P3)
  detail: The text says on Deny the Local Service never forwards the reply and never performs
    the file mutation. That is correct for a service-side write-approval (do not mutate), but for
    a PROXIED OpenCode tool-permission event the runtime is BLOCKED waiting for a reply on the
    permission-reply endpoint. If the service never forwards the reply, the runtime tool call
    never resolves and the session hangs with no terminal state. The design never states that a
    Deny must send an explicit deny/reject downstream to UNBLOCK the runtime and return the
    session to a usable state.
  failure_scenario: User denies an agent edit request. Service withholds the reply entirely.
    The OpenCode tool call sits pending indefinitely; the EV timeline shows waiting-for-approval
    forever; no error, no recovery. This is exactly the Deny-leaves-the-session-stuck dead-end
    and it silently violates S6 (honest status) and EV6 (error-with-recovery).
  recommendation: Before freeze, state in ADR 0003 / section 5 that a Deny of a proxied
    tool-permission sends an explicit deny reply to the runtime (unblocking it, so the runtime
    rejects the tool and continues or ends cleanly), distinct from a service-side write-approval
    Deny (never mutate). Require that after any Deny the session returns to a truthful, actionable
    state (continue / retry / cancel), never an indefinite waiting hang. The P6 fail-closed
    timeout path must likewise unblock the runtime, not merely drop the reply.

- [MEDIUM] No cold-start progressive-UX / readiness contract for the multi-process boot
  file: docs/architecture/cowork-ghc-implementation-design.md:39-40 (section 2 transport arrows);
    docs/architecture/decisions/0004-windows-process-lifecycle-and-supervision.md:47-48
  detail: Cold start is shell -> standalone Node service -> supervised OpenCode child, and the
    renderer cannot talk to the service until it has the loopback port plus per-launch token,
    which exist only AFTER the service reports ready (ADR 0004 record completed once the child
    reports ready). The design defines a health signal and PID records but never composes them
    into a staged, user-visible startup UX. There is no cold-start latency budget and no staged
    shell-up / service-starting / runtime-starting / ready progressive-UI contract. SD2 covers
    runtime up/down, not the boot sequence the user actually waits through.
  failure_scenario: On a cold machine the OpenCode child launch plus first SSE handshake takes
    several seconds. With no staged UI contract, the renderer shows a blank/frozen window (or a
    meaningless spinner) until everything is up, and a slow or failed runtime spawn is
    indistinguishable from a hang. This bakes in a poor first-run impression and no honest boot
    state.
  recommendation: Add a startup-state contract (for example shell-starting / service-starting /
    runtime-starting / ready / degraded) surfaced progressively in the renderer from the
    health/readiness signals already designed, with a bounded per-stage timeout that flips to an
    honest still-starting or failed-to-start-retry state. L5/L6 planning item; specify the states
    now.

- [MEDIUM] Two-hop SSE streaming has no coalescing / backpressure / re-render contract
  file: docs/architecture/decisions/0003-local-service-transport-placement-loopback.md:102
    (S2 SSE streaming without blocking the UI -- asserted, no mechanism);
    docs/architecture/cowork-ghc-implementation-design.md:92 (section 4 EV row: per-event mapping)
  detail: Tokens flow OpenCode SSE -> service EV-mapping -> renderer SSE (two hops, per event).
    The design asserts non-blocking streaming but specifies no mechanism: no batching/coalescing
    of high-rate token deltas, no backpressure policy if the renderer consumes slower than the
    runtime produces, and no renderer state-update strategy to bound per-token re-render cost.
    frontend.md explicitly requires avoiding unnecessary re-renders during token streaming, yet
    the architecture leaves per-token re-render cost entirely to implementation.
  failure_scenario: A fast model emits ~50-100 tokens/s. Each token becomes one mapped SSE event
    through two Node proxies plus one React state commit, so the EV timeline re-renders on every
    token -> visible jank / dropped frames during long generations. Separately, if the renderer
    tab is backgrounded or slow, the service may buffer the upstream SSE unboundedly (SSE has no
    native origin backpressure) -> memory growth. Neither is bounded by the design.
  recommendation: Add an EV-streaming contract: coalesce token deltas at the service boundary
    (time- or size-batched), define renderer append semantics that update a streaming buffer
    without re-rendering the whole timeline per token, and state a backpressure / bounded-buffer
    policy for a slow consumer. L5/L6 planning item; the contract belongs in the design / ADR 0003.

- [MEDIUM] No crashed / unclean-child recovery UX; risk of silent mid-stream hang
  file: docs/architecture/decisions/0004-windows-process-lifecycle-and-supervision.md:47-48
    (record removes it on clean exit -- no unclean-exit path);
    docs/architecture/cowork-ghc-implementation-design.md:92 (EV mapping) and SD2
  detail: ADR 0004 specifies graceful-then-force STOP and stale-PID pruning, but not what the
    user experiences when the OpenCode child (or the service) dies UNEXPECTEDLY mid-session. The
    record is only removed on clean exit; there is no defined detect -> surface -> recover flow
    for a crash. When the upstream SSE closes on a crash, nothing in the design says the service
    maps that to a real runtime-down / error EV state (which is honest reporting, not the
    fabrication EV7 forbids) or offers a restart.
  failure_scenario: OpenCode crashes during a streaming response. The renderer SSE simply stops
    emitting; the last state was working. With no crash-to-EV mapping, the UI hangs on a stale
    working indicator with no error and no recovery -- violating S6 (truthful status) and EV6
    (recovery action).
  recommendation: Define unexpected-exit handling: the supervising owner detects child death,
    emits a real runtime-down / error EV event, marks the session honestly (not working / done),
    and offers a recovery action (restart runtime / retry). State the restart policy (manual vs
    supervised auto-restart with a bound). L5/L6 planning item.

- [LOW] Rapid streaming updates may flood screen-reader announcements (a11y)
  file: .claude/rules/frontend.md (accessibility);
    docs/architecture/cowork-ghc-implementation-design.md:92 (per-event EV stream)
  detail: If streamed tokens/steps are rendered into an aria-live region without the coalescing
    from the MEDIUM streaming finding, a screen reader will be flooded with per-token
    announcements, making the app effectively unusable with assistive tech during generation.
    This is not precluded by the architecture but is enabled by the missing streaming contract.
  failure_scenario: A screen-reader user runs a prompt; the live region announces every token
    fragment, producing an unintelligible stream.
  recommendation: Fold an accessible live-region strategy (announce coalesced step/status
    changes, not raw token deltas) into the EV-streaming contract. L6 UI planning.

---

Areas checked and found CLEAN (not precluded by the architecture):

- Accessibility (focus 5): The shell is Electron with a React DOM renderer (ADR 0002:56-57;
  design section 2). Full keyboard navigation, focus management, ARIA labeling, and contrast
  control are available with standard web tech; there is no canvas / non-DOM UI and no
  architectural choice that removes a11y affordances. The frontend.md a11y requirements are fully
  satisfiable. The only caveat is the LOW streaming-announcement item above. NOT a blocker.

- Permission enforcement correctness (focus 3, enforcement half): The service-as-single-boundary
  model (design section 5, lines 106-118) -- hold-pending-action, Deny blocks the mutation on
  disk, direct-service bypass blocked, fail-closed timeout, on-disk verification (F6) -- is sound
  and UX-honest. The only gap is the Deny-reply / unblock ambiguity (HIGH above), not enforcement.

- Stop cleanliness / no-orphan-no-zombie (focus 4, stop half): Graceful loopback shutdown then
  taskkill /PID /T /F or a Win32 Job Object with kill-on-close, leaf-first ordering, identity-
  verified kills, stale-PID pruning (ADR 0004:88-97, 82-85). This gives a clean stop with no
  orphaned window / zombie tree. Sound. The gap is the CRASH (unclean) path (MEDIUM above), not
  the commanded-stop path.

- Loopback / token bootstrap for the renderer: ADR 0003:65-68 issues a per-launch token and a
  dynamic loopback port recorded in the PID records; the shell can hand port plus token to the
  renderer via the preload bridge. The mechanism is coherent; only its user-visible timing is the
  MEDIUM cold-start item.

---

Verdict rationale: No CRITICAL. No architectural choice PRECLUDES a good UX or a performant
result. One HIGH (Deny-reply semantics) is a specification ambiguity that, per the review
contract, blocks DONE unless an explicit decision is recorded -- it must be resolved in the design
or ADR before freeze, but it is a clarification, not a redesign. The three MEDIUM items are L5/L6
planning contracts the topology REQUIRES (progressive startup, streaming coalescing/backpressure,
crash recovery) and should be named as freeze conditions. Hence PASS_WITH_FINDINGS.
