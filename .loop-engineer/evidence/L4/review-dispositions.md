# L4 — Architecture Review: Findings Dispositions & Freeze Record

Loop: L4 (Architecture Review + freeze). Run: RUN-0005. Date: 2026-07-11.
Reviewer ≠ implementer honored throughout (L3 author = product-architect; L4 critics = five
independent lenses + a reference-verification pass; freeze corrections re-confirmed by the
security lens, which did not author the edits).

## Review panel (all evidence under `.loop-engineer/evidence/L4/`)
| Lens | Agent role | Verdict | Crit | High | Med | Low | Evidence |
|---|---|---|---|---|---|---|---|
| Runtime | runtime-llm-engineer | CHANGES_REQUIRED → resolved | 0 | 2 | 8 | 2 | review-runtime.md |
| Frontend | frontend-desktop-engineer | PASS_WITH_FINDINGS | 0 | 0 | 4 | 3 | review-frontend.md |
| Test | test-engineer | APPROVE-WITH-CONDITIONS → resolved | 0 | 2 | 5 | 2 | review-test.md |
| Security + threat model | security-reviewer | PASS_WITH_FINDINGS → CLOSED | 0 | 2 | 3 | 2 | review-security-threatmodel.md |
| UX / performance | ux-performance-reviewer | PASS_WITH_FINDINGS | 0 | 1 | 3 | 1 | review-ux.md |
| Reference verification | repository-researcher | DONE (facts) | — | — | — | — | reference-verification.md |

**Aggregate after freeze corrections: 0 Critical, 0 unresolved High.** Definition-of-Done gate met.

## The seven HIGH findings — all RESOLVED before freeze
1. **Runtime H1 — credential-injection mechanism unproven.** RESOLVED. Reference verification found
   OpenCode resolves provider keys from the child's process **environment** (`env-file.ts:3-12`,
   `cloud-provider-config.ts:43-66,150`), injected via `buildChildEnv` → `spawn({env})`
   (`runtime.mjs:769-805,1017-1023`). ADR 0006 now names per-launch ENV injection from the keyring
   as the concrete mechanism and FORBIDS writing OpenCode's `auth.json`/`env.json`. SEC-1 intent
   (no cleartext key at rest, never in our logs/state/frontend) is preserved.
2. **Runtime H2 — `--cowork-identity` token infeasible.** RESOLVED. Win32 cannot read a process's
   env; OpenCode exposes no pid/instance-id route (`/global/health` → `{healthy,version}` only).
   ADR 0004 replaced the token with identity by **PID (held at spawn, `runtime.mjs:134`) + assigned
   port + start-time + exePath**, re-verified before any kill. Per-run data isolation via
   `XDG_DATA_HOME`/`OPENCODE_CONFIG_DIR` (no `--data-dir` flag exists).
3. **Security H — redaction keyed off env-var NAME not VALUE.** RESOLVED. ADR 0006 SEC-2 now
   requires VALUE-based scrubbing, coverage extended to the diagnostics bundle and the
   execution-metadata record (design §6). Re-confirmed by the security lens.
4. **Security H — SEC-1 acceptance/negative-test surface incomplete.** RESOLVED. ADR 0006 adds
   AC1–AC6 and negative tests for BOTH a standard and the user-defined custom provider (disk/logs/
   frontend). Re-confirmed: **SEC-1 CLOSED, SEC-2 CLOSED.**
5. **UX H — permission Deny could strand the runtime.** RESOLVED. ADR 0003 + design §5 now specify
   an **explicit deny reply** that unblocks the runtime and returns the session to an actionable
   state (Deny still blocks the action on disk); no silent never-forward.
6. **Test H1 — no captured-real-frame fixture seam (hollow-green risk).** RESOLVED as a locked seam.
   Design §11 mandates contract/integration/EV-reducer tests run against fixtures **captured from
   the real OpenCode SSE boundary**, with re-capture wired to the ADR 0001 pin/upgrade gate.
7. **Test H2 — SSRF ban would block the only deterministic no-live-LLM driver.** RESOLVED. ADR 0005
   defines a **test-mode loopback allowlist escape** (build-time constant + explicit flag,
   dead-code-eliminated + startup hard-assert-off in release, relaxes only explicit loopback,
   WARN+audit, unreachable from the renderer, release negative test) that does not weaken the
   production SSRF posture.

## The three author-flagged overrides — RATIFIED
- **0003 — standalone service placement (not embedded in Electron main).** RATIFIED. Endorsed by
  runtime (two-hop loopback latency negligible), test (headless scriptable surface for integration/
  E2E/negative), frontend, and UX. Locks in the "UI is a client of a local service" invariant.
- **0005 — 5th provider = user-defined OpenAI-compatible endpoint.** RATIFIED, conditioned on the
  now-added production SSRF policy + custom-key ENV path (both specified in ADR 0005/0006).
- **0002 — desktop shell = Electron (the closest call).** RATIFIED, conditioned on the now-added
  renderer-hardening checklist (design §11). Reversible; the Tauri revisit trigger stands.

## Carried to L5/L6 (with acceptance criteria; none are freeze blockers)
- **L6 keyless spike** to confirm exact per-provider env-var names for OPENAI/OPENROUTER/GEMINI,
  gated to the ADR 0001 pin (ADR 0006). Honestly recorded, not a HIGH.
- **Windows orphan reaper** must be built — the reference sweep is Unix-only (`runtime.mjs:1072`).
- Frontend MEDs: shape the full EV event/terminal-state contract; SSE snapshot/resync endpoint;
  model-preference SSOT = service settings store (not localStorage).
- Security MEDs: runtime-tool workspace confinement; boundary-token non-persistence (MED-1).
- UX MEDs: cold-start progressive-readiness contract; two-hop streaming coalescing/backpressure;
  crashed-child recovery UX. Plus assorted LOWs.

## Freeze
All six ADRs + the implementation design flipped **Proposed → Accepted (FROZEN in L4, 2026-07-11)**.
Changing a frozen decision now requires a new/superseding ADR, not an in-place edit. L5 (Master
Plan) may proceed on this frozen architecture.
