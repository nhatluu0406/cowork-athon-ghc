# L4 Security Review + Threat Model — Cowork GHC (frozen-candidate architecture)

Review target: L4 (Architecture Review + freeze) / task L4-REV-SEC
Reviewer role: security-reviewer (independent; did NOT author the design or any ADR)
Verdict: PASS_WITH_FINDINGS — no CRITICAL. Two HIGH findings are freeze-time
acceptance-criteria gaps (nothing is implemented yet in the affected paths); they are
CLOSED by the rulings below IFF the freeze adopts those criteria verbatim. MED-1 and
MED-2 are adjudicated. clean.bat and loopback-bind reviewed and CLEAN.

Scope read in full: docs/architecture/cowork-ghc-implementation-design.md;
ADR 0001-0006 + docs/architecture/decisions/README.md; .claude/rules/security.md;
scripts/clean.bat + scripts/cleanup-manifest.json + tools/loop-engineer/lifecycle.mjs
clean path; reference paths cited below under .loop-engineer/source/openwork/ (READ-ONLY).

---

## Findings

- [HIGH] Secret-redaction keys off env-var NAME, not value — user-defined 5th-provider key can leak
  file: .loop-engineer/source/openwork/apps/server/src/managed-opencode.ts:27,87
  detail: The reference child-launch path records an execution-metadata object listing every injected
  env var; it redacts a value ONLY if the NAME matches
  SECRET_ENV_PATTERN = /(TOKEN|PASSWORD|USERNAME|AUTH|SECRET|KEY|CREDENTIAL)/i (line 27, applied 87).
  Cowork GHC SEC-2 scrubber and the ADR 0006 negative tests (0006:53-58) cover auth.json/env.json and
  the frontend snapshot, but NOT (a) the child execution-metadata record, (b) the diagnostics bundle,
  or (c) a custom provider whose key is injected under a non-matching env name.
  failure_scenario: The user-defined OpenAI-compatible provider (ADR 0005:78-84) is keyed via env var
  MY_LLM_KEY (name lacks any TOKEN/KEY/etc. word). The service injects it at launch; the value is
  written verbatim into the execution-metadata record and surfaces in a diagnostics export or a status
  panel rendering that record. A screenshot/support bundle now contains a live provider key. Per the
  role rule (a secret that could reach a log/UI/screenshot is at least HIGH) this is HIGH.
  recommendation: Redaction MUST match on VALUE (or an explicit provider-key registry the boundary
  owns), not on env-var NAME. Extend the SEC-2 negative test to assert the placeholder key is absent
  from logs, errors, EV events, the diagnostics bundle, AND the child execution-metadata record — for
  BOTH a standard provider and the user-defined 5th provider.

- [HIGH] SEC-1 injection acceptance criteria + negative-test surface incomplete for the freeze
  file: docs/architecture/decisions/0006-credential-store.md:44-58; docs/architecture/cowork-ghc-implementation-design.md:120-131
  detail: ADR 0006 SEC-1 negative tests assert no key in auth.json/env.json / app state / frontend
  snapshot but do not enumerate the diagnostics bundle, the execution-metadata record, or a fallback
  session-scoped auth file. The runtime reviewer H1 claims there is no verified boundary/env injection
  path; that is only PARTLY true — a spawn-env path EXISTS in the reference at
  managed-opencode.ts:65,73-95 and env-file.ts:241-250 (see Ruling H1). The freeze must state
  mechanism-independent acceptance criteria so SEC-1 holds regardless of the runtime key-load path.
  failure_scenario: If the custom provider cannot be keyed via env and the freeze silently falls back
  to writing OpenCode default auth.json, SEC-1 is violated: a cleartext key persists at a stable,
  backup-/sync-prone path (and chmod 0o600 is a documented no-op on Windows — env-file.ts:144-145).
  recommendation: Adopt the AC1-AC6 acceptance criteria in Ruling H1 as the frozen SEC-1 contract.

- [MEDIUM] SSRF policy (MED-2) names the ranges but not the enforcement point or DNS-rebinding defense
  file: docs/architecture/decisions/0005-provider-abstraction.md:131-135
  detail: The base_url policy lists https-only + block loopback/link-local/RFC-1918/metadata, but (1)
  does not fix WHERE it is enforced, and (2) validating a hostname once then letting the runtime
  connect allows DNS rebinding / TOCTOU (name resolves public at check time, to 169.254.169.254 at
  connect time). Because OpenCode owns the wire call (ADR 0005), once base_url reaches the runtime the
  service can no longer intercept the request.
  failure_scenario: A social-engineered config sets base_url to a hostname that resolves to
  169.254.169.254; the runtime fetches instance metadata and the response (or the injected provider
  key on the outbound request) reaches an attacker-controlled endpoint. Self-inflicted and low-impact
  in the single-user POC; becomes HIGH the moment the D4 gateway (shared key pool) is built.
  recommendation: Enforce at the service ProviderPort config path BEFORE base_url is handed to the
  runtime; resolve the host, validate the RESOLVED IP, then pin/connect to that same IP. Default-deny
  private/link-local/metadata + IPv4-mapped-IPv6 (::ffff:127.0.0.1) and .local. HARD prereq before D4.

- [MEDIUM] Workspace confinement must be enforced on the RUNTIME own file tools, not just the service pipeline
  file: docs/architecture/cowork-ghc-implementation-design.md:113-118; docs/architecture/decisions/0001-agent-tool-runtime-and-persistence.md:106
  detail: OpenCode is the tool runtime and executes file ops in the child process. The design enforces
  confinement (W4/F4) and permission in the service own file pipeline and via the proxied
  tool-permission event. If a runtime tool op is auto-approved or does not raise a permission event,
  the service path validation never runs and confinement rests on OpenCode cwd/root alone.
  failure_scenario: A runtime file tool writes to a path escaping the workspace via .. or a symlink
  under an allow-all mode; the service never validated the target because it only validates its own
  pipeline, so a file lands outside the granted workspace.
  recommendation: Validate the resolved target against the workspace root on EVERY proxied
  tool-permission event (symlink/real-path re-check at execution time), and spawn OpenCode rooted at
  the workspace. A Deny/traversal test asserts the on-disk target outside the workspace is unchanged
  (extends the F6 Deny-blocks-on-disk test in design section 5).

- [MEDIUM] MED-1 residual: the boundary client token must never be persisted where the identity token lives
  file: docs/architecture/decisions/0003-local-service-transport-placement-loopback.md:66,111-115; docs/architecture/decisions/0004-windows-process-lifecycle-and-supervision.md:60,71-72
  detail: Ruling MED-1 requires two DISTINCT secrets. The supervision identityToken is deliberately on
  the child COMMAND LINE (--cowork-identity) and in .runtime/pids/*.json — both readable by any
  same-user process (Get-CimInstance / file read). Reusing that value as, or co-locating it with, the
  boundary client token leaks boundary auth to every same-user process via WMI.
  failure_scenario: Implementation writes the boundary client token into
  .runtime/pids/local-service.json or onto a command line; a co-resident process reads it and drives
  the execution boundary — collapsing the ADR 0003 co-resident-cannot-trivially-call-the-boundary claim.
  recommendation: Keep them distinct (Ruling MED-1). NEVER place the boundary client token on a
  command line or in a .runtime/pids record; hand it to the renderer/shell in-process at launch only.
  Record that the identity token and pid records are NON-secret within the session.

- [LOW] chmod 0o600 fallback is a no-op on Windows — do not inherit it for any session-scoped key file
  file: .loop-engineer/source/openwork/apps/server/src/env-file.ts:144-145,157-160
  detail: If Ruling H1 mechanism 3 (session-scoped auth file) is ever used, POSIX chmod gives NO
  protection on Windows; access restriction must use a Windows ACL / DPAPI, not chmod.
  recommendation: For any on-disk key fallback, set a user-only Windows ACL (or DPAPI-encrypt); assert
  it in a Windows-gated test.

- [LOW] Manifest entries are not explicitly rejected if absolute/drive-lettered (defense-in-depth)
  file: tools/loop-engineer/lifecycle.mjs:25-33,136
  detail: assessCleanTarget rejects root, .., and preserve-overlap but not an absolute or C:/-prefixed
  entry. Currently harmless because path.join(root, t.path) neutralizes it under root and entries are
  author-controlled, but an explicit reject hardens a future editable manifest.
  recommendation: Reject any manifest entry that is absolute or carries a drive letter / UNC prefix.

---

## Clean areas (explicitly checked, no finding)

- Loopback-only bind (P7): ADR 0003:56-64 binds 127.0.0.1/::1 with port:0, never 0.0.0.0; the P7
  acceptance test (non-loopback refused + loopback-only socket) is defined. CLEAN.
- Single OS-backed credential store: ADR 0006 — one store (WinCred via @napi-rs/keyring), handle-only
  CredentialRef in state, no key bytes in renderer/DOM/localStorage. CLEAN (subject to the HIGH
  redaction/injection ACs). The protects-vs-other-users-not-same-user-context limit is correctly
  stated (0006:80) and consistent with the single-user model.
- Permission enforced at execution boundary, Deny blocks on disk: design section 5 (P1/P3/F6) — the
  service holds the pending action, never forwards the reply / never mutates on Deny, and
  re-authorizes the reply path (assertOpencodeProxyAllowed pattern re-impl); the F6 test asserts the
  file is unchanged on disk. CLEAN at design level (one gap: runtime-tool confinement MEDIUM above).
- clean.bat cannot delete protected paths: scripts/clean.bat + cleanup-manifest.json +
  tools/loop-engineer/lifecycle.mjs:19-48,124-139. Deletes ONLY cleanable_categories (generated /
  downloaded-library / runtime-temporary); refuses project root and .; refuses .. traversal; refuses
  any path overlapping a preserve entry bidirectionally (.git, docs, .agent-workflow, .claude,
  CLAUDE.md/AGENTS.md, tools, scripts, .loop-engineer/state|checkpoints|evidence|reports|source);
  refuses to run while the app is running (exit 4); rmSync targets are join(root, allowlisted) only.
  user-data and credential categories are empty and WinCred lives outside the tree, so
  sessions/history and credentials are structurally untouchable. Honest exit codes (9 no-node, 4
  running). CONFIRMED CLEAN.

---

# ======================= THREAT MODEL =======================

## Trust model (STATED EXPLICITLY)
Single-user, single-machine. All Cowork GHC processes (shell, service, OpenCode child) run in ONE
Windows user session and are mutually trusted. Intra-session isolation is NOT a security boundary on
Windows: any same-user process can read another process command line and env (Get-CimInstance
Win32_Process / NtQueryInformationProcess), open its files, and read .runtime/pids/*.json. Adversary
model in scope: (1) remote/LAN network attackers, (2) OTHER OS users, (3) apps OUTSIDE the user
context, (4) a malicious/compromised cloud provider or attacker-supplied base_url, (5) accidental
disclosure via logs / diagnostics bundles / screenshots the user shares. OUT of scope: a hostile
process already running as the same user — game-over regardless; per-launch tokens raise the bar as
defense-in-depth but are not a boundary against it.

## Trust boundaries
- TB1 renderer -> local service (loopback HTTP+SSE). Control: loopback bind + per-launch boundary
  client token. STRIDE: Spoofing (co-resident process calling the boundary) mitigated by token +
  single-user model; Elevation (UI bypass) mitigated by server-side permission enforcement.
- TB2 service -> OpenCode child (loopback HTTP+SSE). Control: per-instance Basic-auth
  (managed-opencode.ts:69-78), never exposed to the renderer. STRIDE: Spoofing/Tampering of the reply
  path mitigated by Basic-auth + reply-path authorization.
- TB3 OpenCode -> cloud provider APIs (HTTPS). THE REAL EXTERNAL BOUNDARY — data + provider key leave
  the machine. STRIDE: Information disclosure (SSRF/exfil via user-defined base_url — MED-2),
  Tampering (MITM mitigated by https-only).
- TB4 service/shell -> Windows Credential Manager. One store; resolve-at-boundary only. STRIDE:
  Information disclosure (key at rest) mitigated by OS vault + inject-at-launch (SEC-1).
- TB5 file pipeline -> filesystem. Control: workspace-root confinement; .., absolute, UNC, symlink
  refusal. STRIDE: Tampering/Elevation (write outside workspace) — see runtime-tool MEDIUM.

## MED-1 — supervision identity token vs boundary client token (RESOLVED: two distinct secrets)

| Aspect | Supervision identity token | Boundary client token |
|---|---|---|
| Purpose | Prove this PID is my child before a kill (ADR 0004:71-72) | Authenticate renderer/shell -> service HTTP calls (ADR 0003:66) |
| Lives in | .runtime/pids/*.json + child COMMAND LINE (--cowork-identity) | service memory; handed to its own clients in-process at launch |
| Verifier | supervisor/stop path (Get-CimInstance cross-check + /health) | the local service, per request |
| Leakage cost | LOW — lets a same-user process spoof I-am-a-cowork-child (confuse the reaper); grants NO boundary access, exposes NO secret | HIGHER — lets a local process drive the execution boundary (still bounded by permission prompts + single-user trust) |

Ruling: MUST be two distinct secrets. The identity token is intentionally world-readable within the
session (it is on the command line), so unifying them would leak boundary auth to any same-user
process via WMI, collapsing the ADR 0003 cannot-trivially-call-the-boundary claim. Both are readable
by a same-user process, so neither is a boundary against a hostile same-user process — they are
defense-in-depth over the real boundary (OS user account + loopback bind). Note a THIRD secret, the
OpenCode Basic-auth pair (TB2, managed-opencode.ts:69-78), which must never reach the renderer.

## MED-2 — user-defined base_url validation (production policy)
Enforced at the service ProviderPort config path, BEFORE base_url reaches the runtime: scheme MUST be
https; reject credentials-in-URL; resolve host and DENY loopback (127.0.0.0/8, ::1), link-local +
cloud metadata (169.254.0.0/16 incl. 169.254.169.254, fe80::/10), RFC-1918 (10/8, 172.16/12,
192.168/16), CGNAT (100.64/10), .local/mDNS, and IPv4-mapped-IPv6 (::ffff:*); validate the RESOLVED
IP and connect to that same IP (anti-DNS-rebinding). Configurable host allow/deny with default-deny
of the above. HARD prerequisite before the D4 gateway. See PART B #2 for the test-mode loopback
escape that keeps this posture intact in release builds.

## Invariant coverage summary
Loopback-only (P7) OK; secrets-never-in-logs/frontend/screenshots OK WITH the two HIGH ACs; single
OS-backed store OK; permission-at-boundary / Deny-blocks OK WITH the runtime-tool MEDIUM; workspace
boundary / path-traversal OK WITH the runtime-tool MEDIUM.

---

# =================== PART B — ADJUDICATIONS ===================

## Ruling H1 — SEC-1 key-injection mechanism (acceptance criteria, mechanism-independent)
Evidence correction: a per-launch spawn-ENV injection path DOES exist in the reference pattern —
createManagedOpencodeServer accepts options.env and merges it into the spawned child env
(managed-opencode.ts:65,73-95), fed by EnvService.readForInjection (env-file.ts:241-250). So the
runtime reviewer no-verified-injection-path claim is only partly true: standard providers CAN be
keyed via env; the open question (repo-researcher verifying) is only whether the CUSTOM
OpenAI-compatible provider can be keyed via env or requires config/auth.json.

Mechanisms ranked by risk (best first):
1. Per-launch env var on the child, from the keyring, never logged — LOWEST risk satisfying SEC-1; no
   cleartext at rest; dies with the process. (A same-user process can read child env — accepted under
   the trust model.)
2. In-memory / per-request injection — lowest at-rest exposure but generally infeasible with the
   reused runtime LLM loop; acceptable if feasible.
3. Session-scoped auth file in an ISOLATED per-run data dir, ACL-restricted, shredded on stop —
   HIGHER risk (cleartext at rest for the session); acceptable ONLY if 1 and 2 are infeasible for the
   custom provider AND all AC2 protections hold. chmod is a Windows no-op — use a Windows ACL/DPAPI.
4. Writing OpenCode DEFAULT auth.json/env.json — FORBIDDEN (exactly what SEC-1 bans).

Acceptance criteria the freeze MUST adopt (hold regardless of chosen mechanism):
- AC1 Plaintext key resolved from the single OS store ONLY in the service process, ONLY at launch/call time.
- AC2 Key NEVER written to a stable/persistent location: not OpenCode default auth.json/env.json, not
  app state, not .runtime/logs, not the diagnostics bundle, not any clean.bat preserve path or backup.
  Any on-disk key = isolated per-run dir, Windows-ACL/DPAPI restricted (NOT chmod), shredded on stop
  AND on next startup (crash recovery).
- AC3 Key never crosses TB1 to the renderer (no frontend state / localStorage / DOM).
- AC4 Key redacted everywhere it could surface — logs, errors, EV events, diagnostics export, AND the
  child execution-metadata record — matching on VALUE or an explicit key registry, NOT env-var name
  (closes the HIGH managed-opencode.ts:87 gap).
- AC5 Negative test asserts no key material in: OpenCode default auth paths, any app-state file, a
  frontend snapshot, the diagnostics bundle, and the execution-metadata record — for BOTH a standard
  provider AND the user-defined 5th provider.
- AC6 DEFAULT to mechanism 1 (env); use 3 ONLY for a provider the runtime cannot key via env, recorded
  in the ADR with the AC2 protections.

## Ruling B#2 — TEST-MODE loopback SSRF escape (guardrails; production posture unchanged)
PERMITTED so the deterministic no-live-LLM mock provider on 127.0.0.1 can run, under ALL of:
1. Compile-out in release: gated by a build-time constant (__TEST_BUILD__ / NODE_ENV===test) AND an
   explicit launch flag; the production build dead-code-eliminates the relaxation and, if the flag is
   nonetheless set, the service HARD-ASSERTS it off and REFUSES to start (fail-closed).
2. Never the default: absence of the flag = full production SSRF policy.
3. Narrowest scope: relaxes ONLY explicit loopback (127.0.0.1/::1). Link-local/metadata
   (169.254.169.254) and RFC-1918 stay BLOCKED even in test mode (tests never need them).
4. http allowed only for loopback and only under the flag (the mock is local http); everything else
   stays https-only.
5. Loud + audited: prominent startup WARN banner + an audit event on every provider config using a
   loopback base_url while the escape is active.
6. Release negative test: with a production build, setting the env flag does NOT relax the policy —
   asserted as a required test.
7. Service-only: the flag is a service-process launch-time flag; NOT readable/settable from the
   renderer or the boundary API.
The escape touches only MED-2 (SSRF), never redaction — so SEC-2 is untouched, and with 1-7 the
production SSRF posture is unchanged.

## SEC-1 / SEC-2 status after these rulings
- SEC-1 (no key persisted to the runtime store; inject-at-launch): remains CLOSED IFF the freeze
  adopts AC1-AC6. Currently AT-RISK on test/redaction surface (diagnostics bundle + execution-metadata
  record + custom-provider name-based redaction not yet covered by ADR 0006:53-58). Adopt the two HIGH
  recommendations to close it fully.
- SEC-2 (scrubber covers provider key material): CLOSED as designed (ADR 0006:60-66; design section 6),
  subject to AC4 extending coverage to the diagnostics bundle + execution-metadata record and to
  VALUE-based (not name-based) matching. The test-mode SSRF escape does not weaken SEC-2.

---

## Re-confirmation (post-edit) — independent read-only verification

A product-architect (not the reviewer) edited the ADRs to encode the L4 rulings. Re-read
ADR 0006, ADR 0005, and design §6. No files edited by the reviewer.

- HIGH #1 (redaction keyed off env-var NAME not VALUE): **RESOLVED** — ADR 0006:95-108 mandates
  VALUE-based scrubbing with coverage extended to the diagnostics bundle AND the execution-metadata
  record; design §6:143-147 mirrors it.
- HIGH #2 (SEC-1 acceptance criteria + negative-test surface incomplete): **RESOLVED** — ADR
  0006:72-93 adopts AC1-AC6 verbatim; negative tests cover disk/logs/frontend for BOTH a standard and
  the custom provider (AC5, tests 1-2). Concrete mechanism = per-provider ENV injection from the
  keyring into the child spawn env (0006:46-58); writing OpenCode default auth.json is FORBIDDEN
  (0006:56). localStorage claim corrected to the service settings store (0006:40-44).
- MED-2 SSRF: production policy (https, block RFC-1918/link-local/loopback/metadata, resolved-IP
  DNS-rebinding guard, service-enforced) at ADR 0005:91-97; test-mode escape with all 7 guardrails at
  0005:99-109. Faithful.
- New pin-gated L6 prerequisite (confirm exact per-provider env var names via a keyless spike,
  0006:65-70,167-170): honestly recorded and gated to the ADR 0001 pin; NOT a freeze blocker.

SEC-1: **CLOSED.** SEC-2: **CLOSED.** No new Critical/High introduced. Residual pre-existing MEDIUMs
(runtime-tool workspace confinement; MED-1 boundary-token non-persistence) and LOWs remain as
L5/L6 implementation criteria. Recommendation: **SAFE-TO-FREEZE.**
