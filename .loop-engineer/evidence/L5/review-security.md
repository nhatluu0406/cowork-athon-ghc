# L5 Master-Plan Security Review — Cowork GHC

Review target: L5 (Master Plan + task graph) / task L5-REV-SEC
Reviewer role: security-reviewer (independent; did NOT author the master plan or tasks.yaml)
Verdict: PASS_WITH_FINDINGS — 0 CRITICAL, 0 HIGH. 4 MEDIUM, 3 LOW. The core security-sensitive
tasks (credentials, permission, redaction, workspace boundary, loopback/token, SSRF, clean.bat,
file-mutation-audit, orphan reaper, renderer hardening) each carry security-reviewer and reviewer
!= owner. Findings are acceptance-line / reviewer-assignment gaps to tighten before or at L6, not
freeze blockers.

Scope read in full: docs/product/cowork-ghc-master-plan.md; .loop-engineer/state/tasks.yaml (28
tasks + CGHC-WEB-001 backlog); .claude/rules/security.md; .claude/rules/architecture.md;
.loop-engineer/evidence/L4/review-security-threatmodel.md; review-dispositions.md;
docs/product/cowork-ghc-scope-and-acceptance.md (P5/PR8/PR9/SD3).

## Per-check verdicts (1-10)

1. CREDENTIALS — PASS. CGHC-009 (owner runtime-llm-engineer, reviewer security-reviewer): single
   OS-backed store via napi-rs/keyring, CredentialRef handle only, per-provider ENV injection into
   the OpenCode child spawn, never writes auth.json/env.json, acceptance = AC1-AC6, negative test
   no-key-at-rest for standard + custom provider. Satisfies SEC-1.

2. REDACTION — PASS. CGHC-021 (security-reviewer): scrubber matches the secret VALUE not env-var
   name; coverage includes the diagnostics bundle AND the execution-metadata record (SEC-2). Value-
   based redaction unit test present.

3. SSRF — PASS_WITH_FINDINGS (see MED-2). CGHC-010 (security-reviewer): production SSRF block plus a
   test-mode loopback allowlist dead-code-eliminated + startup-hard-assert-off in release; SSRF
   release negative test. Both tasked; acceptance under-specifies ranges / DNS-rebinding / service-
   only properties.

4. PERMISSION — PASS. CGHC-016 (security-reviewer): approval originates at the execution boundary
   (P1); Deny never mutates on disk AND sends an explicit deny reply (no strand); direct-service
   bypass blocked; fail-closed timeout (P6); tests = permission round-trip + Deny-leaves-file-
   unchanged-on-disk (F6) + session terminal.

5. WORKSPACE BOUNDARY — PASS_WITH_FINDINGS (see MED-1). CGHC-007 (security-reviewer): resolve at
   boundary; refuse ../ absolute / UNC / symlink + record; traversal negative test. The L4 residual
   runtime-tool confinement is not an explicit acceptance line.

6. LOOPBACK — PASS. CGHC-002 (security-reviewer): binds only 127.0.0.1/::1, non-loopback refused (P7
   negative test); per-launch client token, non-persistent (MED-1), token non-persistence test.
   MED-1 distinctness at the pid-writer noted as LOW-1.

7. clean.bat — PASS. CGHC-023 (security-reviewer): allowlist-only delete; refuse overlap with any
   preserve entry; refuse if root uncertain / traversal / running (exit 4); never deletes
   .git/source/docs/credentials/workspace/.loop-engineer state; tests = cleanup-manifest validation
   (corrupt-manifest refusal) + clean-of-non-allowlisted negative.

8. LOGGING — PASS. Secrets-never-in-logs/errors/frontend/screenshots (PR8/SD3): CGHC-021 (value-
   based scrub, redact-stays-on-when-verbose), plus CGHC-009 (no key in logs), CGHC-011 (no echo),
   CGHC-020 (no leak in error), CGHC-015/EV6 (no leaked secret in UI), CGHC-018 (audit no secret P5).

9. REVIEWER APPROPRIATENESS — PASS_WITH_FINDINGS. All ten primary security-sensitive tasks have
   security-reviewer. Three secondary tasks whose acceptance asserts a secret-could-reach-log/UI
   property (>= HIGH per role rule) lack a security lens: CGHC-011, CGHC-015, CGHC-020 (MED-3).
   CGHC-004 (pid-record writer, MED-1) is code-reviewer (LOW-1).

10. SECURITY MUST WITH NO TASK — none entirely unmapped; all 41 MUSTs appear in >= 1 task
    (master-plan:388-441). One partial-coverage gap: P5 audit scope (approval grant/deny + provider
    change) is mapped only to CGHC-018 file-op audit (MED-4).

Security-sensitive tasks correctly given security-reviewer: CGHC-002 (loopback/token), CGHC-005
(orphan reaper), CGHC-007 (workspace boundary), CGHC-009 (credentials), CGHC-010 (SSRF), CGHC-016
(permission), CGHC-018 (file-mutation-audit), CGHC-021 (redaction), CGHC-023 (clean.bat), CGHC-025
(renderer hardening).

## Findings

- [MEDIUM] MED-1: L4 residual runtime-tool workspace confinement has no explicit acceptance line
  file: tasks.yaml:169-179 (CGHC-007); 450-462 (CGHC-018); 20-23 (CGHC-001)
  detail: review-security-threatmodel.md:65-77 requires validating the resolved target against the
  workspace root on EVERY proxied OpenCode tool-permission event (symlink/real-path re-check at
  execution time) AND spawning OpenCode rooted at the workspace, because the runtime owns the child
  file tools. CGHC-007 only says file ops resolve against the workspace root at the boundary; no task
  states spawn-rooted-at-workspace or re-validate-on-every-proxied-tool-event. Carried at
  review-dispositions.md:65.
  failure_scenario: A runtime file tool auto-approved (allow-all mode) writes to a path escaping the
  workspace via dot-dot or a symlink; the service-pipeline validation never runs, a file lands
  outside the granted workspace, W4/F4 silently violated at L6.
  recommendation: Add to CGHC-007 or CGHC-018 an acceptance that OpenCode is spawned rooted at the
  workspace and the resolved real-path of every proxied tool-permission event is re-validated at
  execution time; add a runtime-tool traversal negative test.

- [MEDIUM] MED-2: CGHC-010 SSRF acceptance under-specifies the frozen production policy + guardrails
  file: tasks.yaml:252-260 (CGHC-010)
  detail: Acceptance reads only production SSRF block plus a test-mode loopback allowlist dead-code-
  eliminated + startup-hard-assert-off in release. It does not enumerate the frozen policy (ADR
  0005:91-97 / review-security-threatmodel.md:176-183): https-only, reject credentials-in-URL, block
  loopback/link-local+metadata/RFC-1918/CGNAT/.local/IPv4-mapped-IPv6, validate the RESOLVED IP and
  connect to that same IP (anti-DNS-rebinding), enforced at the service ProviderPort BEFORE base_url
  reaches the runtime. It omits three of the seven test-mode guardrails: narrowest-scope (only
  explicit loopback), service-only/unreachable-from-renderer, WARN+audit.
  failure_scenario: An L6 implementer ships a hostname-only blocklist with no resolved-IP re-pin; a
  base_url that resolves public at check time and to 169.254.169.254 at connect time bypasses the
  block and the runtime fetches metadata / exfils the injected provider key; terse acceptance passes
  review because the guard was never a checkable criterion.
  recommendation: Expand CGHC-010 acceptance to cite ADR 0005:91-109 ranges, the resolved-IP DNS-
  rebinding guard, the service-side enforcement point, and the test-mode flag service-only +
  narrowest-scope + WARN/audit properties; keep the release negative test.

- [MEDIUM] MED-3: three secondary secret-exposure surfaces lack an independent security reviewer
  file: tasks.yaml:266 (CGHC-011 code-reviewer); 366-368 (CGHC-015 ux-performance-reviewer); 493-494
  (CGHC-020 test-engineer)
  detail: Per the role rule (a secret that could reach a log/UI/screenshot is at least HIGH), three
  tasks whose acceptance asserts a secret-exposure property are reviewed by a non-security lens:
  CGHC-011 the value never echoes to UI/DOM/logs + credential no-echo test (code-reviewer); CGHC-015
  EV6 never a raw stack trace or leaked secret in the render surface (ux-performance-reviewer);
  CGHC-020 no secret leaks into the message or logs (test-engineer). Master-plan section 3 (218-220)
  lists which tasks get security-reviewer but omits these surfaces.
  failure_scenario: CGHC-011 echoes the key into a form field on a validation error, or CGHC-020
  embeds the Authorization header in a mapped error string; the non-security reviewer approves on
  functional grounds and a live key surfaces in a screenshot / error toast — the HIGH class the role
  rule flags.
  recommendation: Assign security-reviewer to CGHC-011, CGHC-015, CGHC-020, or add security-reviewer
  as a required co-lens on the specific secret-exposure acceptance.

- [MEDIUM] MED-4: P5 audit coverage is partial — approval grant/deny + provider-change audit untasked
  file: docs/product/cowork-ghc-scope-and-acceptance.md:219-221 (P5); tasks.yaml:460 (CGHC-018),
  387-411 (CGHC-016), 478-488 (CGHC-019)
  detail: P5 MUST requires a local audit event for approval grant/deny, sensitive file op, provider
  change. Traceability (master-plan:409) maps P5 to CGHC-018 only, whose audit acceptance is scoped
  to file operations. CGHC-016 (permission Allow/Deny) has no audit-event acceptance; CGHC-019
  (provider/model switch) has no audit acceptance for a provider change.
  failure_scenario: A user Denies a destructive action or switches provider; no audit record is
  written because no task acceptance mandates it, so the important-decisions-auditable invariant
  (security.md) is unmet for the two most security-relevant decision types while traceability reports
  P5 as covered.
  recommendation: Add an audit-event acceptance to CGHC-016 (record Allow/Deny, no secret, reuse
  CGHC-021 redaction) and CGHC-019 (record provider change); update the P5 row to cite CGHC-016/018/
  019.

- [LOW] LOW-1: MED-1 boundary-token non-persistence not bound to the pid-record writer (CGHC-004)
  file: tasks.yaml:93-96 (CGHC-004, reviewer code-reviewer); 46 (CGHC-002)
  detail: MED-1 (review-security-threatmodel.md:79-90) requires the boundary client token NEVER be
  written to the .runtime/pids records or a command line. CGHC-004 is the pid-record writer, reviewed
  by code-reviewer; its acceptance does not state that the boundary token must not be co-located and
  that identity/pid records are non-secret. CGHC-002 references MED-1 but the enforcement point is
  CGHC-004.
  failure_scenario: CGHC-004 records the boundary token alongside role/pid/port; a same-user process
  reads the local-service pid record and drives the execution boundary, collapsing the ADR 0003
  cannot-trivially-call-the-boundary claim.
  recommendation: Add a CGHC-004 acceptance that the pid records and the child command line carry
  ONLY the non-secret supervision identity and the boundary client token is never persisted there;
  consider a security-reviewer co-check on CGHC-004.

- [LOW] LOW-2: CGHC-009 negative-test surface does not enumerate diagnostics bundle + exec-metadata
  file: tasks.yaml:229 (CGHC-009 test line)
  detail: AC5 (review-security-threatmodel.md:223-225) requires the credential negative test to
  assert no key material in the diagnostics bundle and the execution-metadata record for BOTH
  providers. CGHC-009 test line covers disk/logs/frontend/local-storage but not those two surfaces by
  name (covered indirectly by CGHC-021). Since acceptance says AC1-AC6, AC5 is incorporated by
  reference; enumerating would make the test checkable.
  recommendation: Extend the CGHC-009 negative test to assert absence in the diagnostics bundle and
  execution-metadata record for standard + custom provider.

- [LOW] LOW-3: manifest absolute/UNC/drive-letter entry rejection (L4 LOW) not added to CGHC-023
  file: tasks.yaml:578-585 (CGHC-023); review-security-threatmodel.md:99-104
  detail: The L4 LOW recommends rejecting any cleanup-manifest entry that is absolute or carries a
  drive letter/UNC prefix (defense-in-depth for a future editable manifest). CGHC-023 covers
  preserve-overlap + traversal + root-uncertainty refusal but not an explicit absolute/UNC reject.
  recommendation: Add reject any absolute or drive-lettered/UNC manifest entry to CGHC-023 acceptance
  and the manifest-validation test.

## Clean / confirmed areas (explicitly checked, no finding)
- ONE credential store, per-provider ENV injection, no auth.json/env.json: CGHC-009 faithful to
  SEC-1 / AC1-AC6.
- Value-based redaction over diagnostics bundle + execution-metadata: CGHC-021 (SEC-2).
- Deny-blocks-on-disk at the execution boundary + explicit deny reply + round-trip test: CGHC-016.
- clean.bat allowlist-only, protected paths never deleted, corrupt-manifest + running refusal:
  CGHC-023 (consistent with L4 CONFIRMED-CLEAN clean path).
- Loopback-only bind + non-loopback-refused test; per-launch non-persistent boundary token: CGHC-002.
- Windows orphan reaper never kills by image name; identity-verified; security-reviewer: CGHC-005.
- Renderer hardening (CSP/sandbox/nodeIntegration off/contextIsolation/nav lockdown/no generic IPC):
  CGHC-025, security-reviewer.
- reviewer != owner holds for all 28 tasks.

## Freeze recommendation
Security coverage is sufficient to freeze for L6, conditioned on scheduling the 4 MEDIUM findings as
L6 acceptance-tightening (runtime-tool confinement acceptance; SSRF acceptance enumeration;
security-reviewer on CGHC-011/015/020; P5 approval/provider-change audit). No CRITICAL or HIGH; no
security MUST is entirely without a task.
