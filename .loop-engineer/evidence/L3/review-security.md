# L3 Security Review — Architecture Candidates (ADRs 0001-0006 + Implementation Design)

Review target: loop L3 (Architecture Candidates), task L3-A1
Reviewer role: security-reviewer (independent; did NOT author the ADRs/design — product-architect did)
Scope: L3 grounding + invariant-compliance ONLY. The full multi-role critique + threat model + freeze is L4.
Verdict: **PASS_WITH_FINDINGS**

Findings by severity: CRITICAL 0 | HIGH 0 | MEDIUM 2 | LOW 2 (+1 informational strength).
No Critical/High that would make it unsafe to advance to L4. All six decisions are DECIDED
(Status: Proposed), invariants are honored, SEC-1/SEC-2 are correctly encoded, and no feature code exists.

## What I checked and found clean (evidence-based)

### Invariants — actually enforced, not merely mentioned
- **P7 loopback-only.** ADR 0003 section "Loopback-only (P7)" states the service binds `127.0.0.1`/`::1`
  and **never `0.0.0.0`**, calls any non-loopback bind a defect (OOS2), and specifies a
  choice-independent acceptance test: connect from a non-loopback/LAN interface and assert refusal,
  and inspect listening sockets and assert loopback-only. Grounded in `config.ts:48` + `runtime.mjs:391-417`,
  consistent with scope acceptance P7 (scope doc :222-225). ENFORCED + testable. Good.
- **Permission at the execution boundary (P1/P3), Deny blocks on disk.** Design section 5 puts approval
  origin AND enforcement in the Local Service: on Deny the service never forwards the reply / never
  performs the mutation, and a direct-to-service bypass is blocked by service-side reply authorization
  (reference pattern `assertOpencodeProxyAllowed`, `server.ts:634-654`, re-implemented not copied). The
  Deny test asserts the target file is **unchanged on disk** (F6). Matches scope P3 (:215-221). ADR 0005
  also puts `mapError` (PR7) at the boundary, not UI-only. Good.
- **Workspace boundary / path traversal (F4/W4).** Design section 5 resolves all file ops against the
  granted root and refuses `..`, absolute escapes, UNC, and symlink escapes, recording the refusal
  (reference `normalizeWorkspaceRelativePath`/`resolveSafeChildPath`). Matches scope F4/W4. Good.
- **Secrets never in logs/frontend/state (PR8/SD3).** Design section 6 + ADR 0006 SEC-2 keep only a
  `CredentialRef` handle in state, no key bytes in renderer/DOM/localStorage/logs. Good.
- **One credential store (PR9).** ADR 0006 + design sections 4/6: exactly one at-rest store (Windows
  Credential Manager). Good.

### PR9 / SEC-1 (load-bearing) — the L2 gap is correctly closed, not silently recreated
- ADR 0006 "HARD CONSTRAINT — inject-at-launch" mandates: keys resolved ONLY at the execution boundary
  and injected into the OpenCode child at launch/call time; Cowork GHC **never** calls the OpenCode
  `c.auth.set` (`store.ts:1316`) and **never** writes the runtime `auth.json`/`env.json`; app/frontend
  state holds only `CredentialRef = { store:"os", account }`.
- Required negative tests are specified: (1) after configuring a credential and running a session,
  assert no key material in the runtime `auth.json`/`env.json` or any app-state file; (2) assert no key
  in any browser-local-storage / frontend-state snapshot; (3) fake-store contract test in CI + gated
  real-store integration test on a Windows runner. This is the exact SEC-1 disposition from
  `L2/review-dispositions.md` :19, encoded as a hard, testable constraint. ADR 0005 reinforces it:
  `configureCredential(id, ref)` takes a handle, never key bytes. Correctly closes PR9/SEC-1.

### SEC-2 — scrubber covers provider key material
- ADR 0006 SEC-2 + ADR 0005 `ProviderPort.redactionPatterns()` extend the scrubber to provider key
  material once keys reach the boundary (the reference scrubber, `diagnostics-bundle.ts:121-138`, only
  covered session/host tokens). A redaction test asserts a placeholder key is scrubbed in logs, errors,
  diagnostics export, and EV events, and redaction stays on under verbose/dev logging (SD3). Matches the
  SEC-2 disposition (`review-dispositions.md` :20). Good.

### Decision-completeness — all six DECIDED (no lingering "options")
0001 reuse OpenCode; 0002 Electron; 0003 HTTP+SSE / standalone / loopback; 0004 one-owner chain +
`.runtime/pids` schema + graceful-then-`taskkill /T`; 0005 thin `ProviderPort`, 5th = user-defined
OpenAI-compatible; 0006 `@napi-rs/keyring`. Each has a single concrete Decision, alternatives, and a
requirements-traceability table. "Status: Proposed (L4 freezes)" is correct per the loop mandate — a
decided draft, not an open menu. The "Open items for L4" sections list confirmations, not undecided
forks. Complete.

### Grounding / traceability spot-checks (verified against L2 evidence, not just asserted)
Verified 5 rationale claims against `provider-and-credentials.md`, `discovery-report.md`, and
`review-dispositions.md`:
1. ADR 0006: `c.auth.set` at `store.ts:1316` + `env.json` chmod-no-op at `env-file.ts:144-145` — matches
   provider-and-credentials.md A.1/A.4 + discovery section 3.4. TRUE.
2. ADR 0005: five providers are HTTPS + header-key + SSE + 429, OpenRouter needs `vendor/` prefix —
   matches provider-and-credentials.md B.1. TRUE.
3. ADR 0001: OpenCode pin `v1.17.11` (`constants.json:2`), owns SQLite (`opencode-db.ts:54-66`),
   boundary reply auth (`server.ts:634-654`) — matches discovery section 3.1. TRUE.
4. ADR 0003: reference embeds server in Electron main (`runtime.mjs:1203`); loopback default
   (`config.ts:48`) — matches discovery section 3.5. TRUE.
5. ADR 0004: reference orphan sweep `ps` Unix-only (`runtime.mjs:1072`); SIGTERM not graceful on Windows
   — matches discovery section 4 (the carried HIGH). TRUE.
Requirement-to-component traceability (design section 10) covers the MUST set (scope :406-407) with one
LOW gap noted below (PR2). SEC-1/SEC-2 and the /ee boundary + PA-3 fold are explicitly encoded. I relied
on the L2 evidence files for the reference `file:line` claims; the L2 security review already verified
9/9 citations against real code (`review-dispositions.md` :7-8), so I did not re-open the read-only
reference source (out of scope).

### No feature code — confirmed
L3 produced only: `docs/architecture/decisions/0001-0006` + `README.md`, the implementation-design doc,
and `.loop-engineer/evidence/L3/architecture-authoring-notes.md` (all mtime 2026-07-11). No `app/`,
`service/`, or `runtime/` directories exist. The only code under `tools/loop-engineer/` + `scripts/` is
the pre-existing scaffold (mtime 2026-07-10, predates L3); L3 did not touch it. No product `.ts`/`.tsx`
files created. Compliant.

## Findings

- [MEDIUM] Supervision identity token vs boundary auth token may be conflated / over-exposed.
  file: docs/architecture/decisions/0004-windows-process-lifecycle-and-supervision.md:60,72 and
        docs/architecture/decisions/0003-local-service-transport-placement-loopback.md:64
  detail: ADR 0004 stores `identityToken` in `.runtime/pids/*.json` (a same-user-readable file) AND
    passes it on the child command line (`--cowork-identity <token>`, readable via
    `Get-CimInstance Win32_Process` by any same-user process). ADR 0003 separately relies on "an
    unpredictable per-launch token" issued to the service own clients so "a co-resident local process
    cannot trivially call the boundary." The two ADRs do not state whether the supervision identity
    token and the client boundary-auth token are the same value or distinct.
  failure_scenario: If they are the same token, a co-resident same-user process reads the pid file (or
    WMI command line), obtains the token, and calls the loopback boundary — defeating the ADR 0003
    "cannot trivially call the boundary" claim while P7 still passes (traffic is loopback). The identity
    check (meant only to avoid mis-killing a reused PID) would double as the auth secret.
  recommendation: In L4, state explicitly that the supervision `identityToken` (kill-safety, may be
    disclosed) and the boundary client-auth token (must stay confidential — not on the command line,
    not in the pid file) are DISTINCT secrets, or record an explicit same-user-trust decision. POC on a
    single-user local PC (the same threat model Windows Credential Manager already accepts), so it does
    not block L4 — but should be resolved in the L4 threat model before L5 implements it.

- [MEDIUM] User-defined OpenAI-compatible `base_url` (5th provider) is an SSRF / exfil surface with no
  stated validation.
  file: docs/architecture/decisions/0005-provider-abstraction.md:78-84
  detail: The 5th provider is "a user-defined custom OpenAI-compatible endpoint (`base_url` + key + auth
    header)." The reused OpenCode runtime performs the outbound call to that `base_url`. No scheme/host
    validation (for example https-only, reject link-local/metadata/other-local-service targets) is
    specified.
  failure_scenario: A user (or a future less-trusted config source, for example the D4 gateway routing
    table) sets `base_url` to an internal/metadata address or an attacker-controlled host; the runtime
    then sends the API key + prompt content there. For the current single-user local product this is
    largely self-inflicted, but the seam becomes higher-risk once D4 accepts endpoints from elsewhere.
  recommendation: L4 threat model should decide a `base_url` policy (https-only, basic host allow/deny,
    no obviously-internal targets) and note it as an L5 validation requirement, explicitly before the D4
    gateway is built. Not blocking for L3.

- [LOW] PR2 (add credential) has no home in the design requirement-to-component traceability table.
  file: docs/architecture/cowork-ghc-implementation-design.md:191-208 (section 10 table)
  detail: PR2 is traced in ADR 0006 (:102) and ADR 0005 (`configureCredential`), but the design section
    10 table lists PR9 for the credential component and omits PR2. Minor traceability completeness gap
    (PR2 is a MUST per scope :406-407, :266).
  recommendation: Add a PR2 row (service/credential + service/provider `configureCredential`) to the
    design section 10 table for full MUST coverage. Cosmetic; does not affect the decision.

- [LOW] "bind `:0`" shorthand in ADR 0003 could be misread as an all-interfaces ephemeral bind.
  file: docs/architecture/decisions/0003-local-service-transport-placement-loopback.md:59-61
  detail: The dynamic-port text says "bind `:0`, read the assigned port." Taken alone, `:0` reads as
    "all interfaces, ephemeral port." The same section elsewhere mandates an explicit `127.0.0.1`/`::1`
    bind, so intent is loopback+ephemeral; the phrasing is just loose.
  failure_scenario: An L5 implementer literally binds `0.0.0.0:0`, exposing the boundary off-host.
  recommendation: Reword to "bind loopback with port 0 (`127.0.0.1:0`)." Backstopped by the P7
    socket-inspection acceptance test, so low risk — but that test must be a hard gate in L5.

- [INFO / strength to preserve] SEC-1 negative test must run against the REAL OpenCode runtime.
  file: docs/architecture/decisions/0006-credential-store.md:53-58 + :110 (Open items for L4)
  detail: Injecting keys via env/config to the OpenCode child (the chosen "pattern only" seam) is only
    safe if OpenCode does not auto-persist an env-provided key into its own `auth.json`. ADR 0006
    negative test #1 (assert no key in runtime `auth.json`/`env.json` after a real session) is exactly
    the check that catches this, and the injection mechanism (env vs transient config) is already an
    explicit L4 open item (:110). Correctly specified — flag only so L4/L5 ensure test #1 runs against
    the actual pinned runtime, not a fake, so runtime-side auto-persistence cannot slip through.

## Deferred to L4 (noted, not worked here — per L3 mandate)
- Full multi-role architecture critique + threat model + architecture freeze.
- Distinguish supervision identity token from boundary client-auth token (MEDIUM above); confirm the
  per-launch client-token scheme (ADR 0003 open item) and the identity scheme (ADR 0004 open item).
- `base_url` SSRF/exfil validation policy for the user-defined provider and the future D4 gateway.
- Ratify/override the two flagged divergences from the L2 lean: standalone service placement (ADR 0003)
  and 5th = user-defined OpenAI-compatible (ADR 0005). Neither creates a blocking security problem at
  L3: standalone adds one loopback socket vs the embedded IPC-only model, but P7 is preserved by
  explicit loopback bind + per-launch token + the P7 test; the base_url risk is captured above.
- Confirm the exact key-injection mechanism into OpenCode with ADR 0001, and that SEC-1 test #1 runs
  against the real runtime.
- L5 residual: automated transitive SPDX license scan once an app `package.json` exists (PA-1).

## Gate recommendation
Advance L3 to L4. 0 Critical / 0 High. The six decisions are grounded in L2 evidence, internally
consistent, honor the security/architecture invariants, correctly encode SEC-1 and SEC-2, and contain no
feature code. The 2 MEDIUM items are threat-model refinements that are the proper business of L4; they
do not make it unsafe to proceed.
