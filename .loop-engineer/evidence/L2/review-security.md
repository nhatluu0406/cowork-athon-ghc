# L2 Security Review — Discovery (Independent)

Review target: loop L2 (Discovery) — security-relevant claims
Reviewer role: security-reviewer
Independence: Reviewer did NOT author any L2 evidence or the discovery report.
Verdict: PASS_WITH_FINDINGS

Scope reviewed:
- .loop-engineer/reports/discovery-report.md
- .loop-engineer/evidence/L2/provider-and-credentials.md (DR3)
- .loop-engineer/evidence/L2/runtime-candidates.md (DR1) — credential/network parts
- .loop-engineer/evidence/L2/desktop-shell-and-lifecycle.md (DR2) — loopback/P7/lifecycle parts
- Context: docs/product/cowork-ghc-scope-and-acceptance.md (P7, PR7, PR8, PR9, PR10), .claude/rules/security.md

Reference files I personally opened to verify claims (read-only @ 1897f9f):
- apps/server/src/config.ts (P7 loopback default)
- apps/server/src/env-file.ts (chmod no-op on Windows)
- apps/app/src/react-app/domains/connections/provider-auth/store.ts (c.auth.set key path)
- apps/app/src/app/lib/diagnostics-bundle.ts (redaction scope)

---

## Q1 — No secret leakage (PASS, clean)

I scanned all three L2 evidence files and the discovery report for real key material,
tokens, and secret-shaped strings (sk-*, sk-ant-*, AIza*, Bearer <val>, xox*, ghp_*,
AKIA*, PEM blocks).

- The L2 evidence and report contain NO real secret material. Provider auth is written
  only with the literal placeholder KEY (e.g. x-api-key: KEY, Authorization: Bearer KEY,
  provider-and-credentials.md:103) and abstract handle types
  (CredentialRef = { store: os; account }). DR3 states this explicitly at
  provider-and-credentials.md:9 (No secret material anywhere in this file; placeholders only).
- The only secret-shaped strings under .loop-engineer/ (e.g. sk-ant-abc123 in
  env-file.test.ts, PEM CERTIFICATE blocks in test .mjs/.mdx) are all inside the
  READ-ONLY reference tree .loop-engineer/source/openwork/, i.e. the reference-project
  own obviously-fake test fixtures. They are out of L2 authorship scope, are not real
  credentials, and were never written by L2.

No CRITICAL secret-leakage finding.

## Q2 — PR9 credential-store claim integrity (PASS — claims verified TRUE, not overstated)

Verified in code:
- submitProviderApiKey hands the raw trimmed key to the OpenCode SDK via
  c.auth.set({ providerID, auth: { type: api, key: trimmed } }) at store.ts:1316.
  The DR3 claim (provider-and-credentials.md:24-27) is accurate: the key goes to the
  OpenCode-owned auth store, not a Cowork/OS-backed store. Confirmed.
- env-file.ts writes with mode 0o600 (env-file.ts:139) then chmod(...,0o600)
  (env-file.ts:142,157) with the code comment "chmod is a no-op on Windows; values may
  still contain secrets" (env-file.ts:144, 159). resolveDefaultEnvStorePath() returns
  %APPDATA%/openwork/env.json on Windows (env-file.ts:56-66). The DR3 claim
  (provider-and-credentials.md:42-45) that this is a plaintext, unencrypted key file on
  Windows is accurate and NOT overstated. The two-store split (auth.json + env.json) is
  real (also cross-referenced by DR1 runtime-candidates.md:110).
- The 6-option comparison is sound to public fact: node-keytar was archived
  (atom/node-keytar, read-only since 2022) — correct to avoid; Electron safeStorage uses
  DPAPI (per-user) and is Electron-only, with the correct caveat that DPAPI protects
  against other users but NOT other apps in the same user context
  (provider-and-credentials.md:188); @napi-rs/keyring wraps the real OS vault (Windows
  Credential Manager) and is shell-neutral Node. All six options are described as keeping
  only a {service, account} handle in app state, satisfying the PR9 "no key in browser
  local storage" rule (provider-and-credentials.md:200-201). No wrong security claim found.

No HIGH finding on PR9 claim integrity.

## Q3 — P7 loopback claim (PASS — verified TRUE)

- const DEFAULT_HOST = 127.0.0.1 confirmed at config.ts:48
  (DR2 desktop-shell-and-lifecycle.md:83-85). The DR2 statement that non-loopback is
  explicit opt-in (--host) requiring an ADR is accurate.
- The described P7 acceptance test (connect from a non-loopback interface, assert refusal;
  plus inspect listening sockets for loopback-only) matches the scope-doc P7 acceptance at
  scope-and-acceptance.md:222-226 and is sound.
- No transport option in DR2 silently binds 0.0.0.0. DR2 explicitly states "never 0.0.0.0"
  (desktop-shell-and-lifecycle.md:155) for every candidate, and the Electron-IPC and
  named-pipe options are correctly noted to satisfy P7 by construction (no socket) while
  still needing a "no port opened" assertion.

No finding.

## Q4 — PR7/PR8 error taxonomy + redaction at the execution boundary (PASS — gap correctly flagged)

- Verified diagnostics-bundle.ts: collectSecretValues (:121-130) collects ONLY
  session/host/runtime tokens (token, hostToken, clientToken, ownerToken, hostToken,
  opencodePassword) — it does NOT collect provider API keys. The DR3 claim
  (provider-and-credentials.md:71-74) is accurate.
- L2 correctly flags this as a PR8 gap L3 must close: the ProviderPort sketch adds
  redactionPatterns() to feed the scrubber (provider-and-credentials.md:142) and both DR3
  and the report insist the PR7 error taxonomy be enforced at the EXECUTION BOUNDARY, not
  UI-only (provider-and-credentials.md:150-152, discovery-report.md:105). This is consistent
  with .claude/rules/security.md (Redact before any log write) and the architecture
  invariant that enforcement lives at the execution boundary. The reference
  describeProviderError (store.ts:927) is correctly characterised as UI-side formatting,
  not a boundary contract.

No finding — the gap is identified honestly, not glossed.

## Q5 — Dangerous advice check

No advisory, if taken, forces a security hole as the RECOMMENDED path:
- All credential leans keep CredentialRef a handle and resolve/inject the key only at the
  server/shell execution boundary; none routes plaintext to the renderer.
- The "accept the runtime own store as the single store" option is explicitly flagged as
  RISKING the PR9 OS-backed wording (provider-and-credentials.md:213, Part D q1), i.e. it is
  called out as a hazard, not recommended.
- Every transport candidate is loopback-enforceable; the strongest-P7 option (Electron-IPC)
  is correctly bounded to the Electron+embedded case.

One forward-looking hazard worth recording for L3 (see MEDIUM finding below).

---

## Findings

- [MEDIUM] Thin-port delegate-credential-to-runtime could reintroduce an at-rest plaintext copy
  file: .loop-engineer/evidence/L2/provider-and-credentials.md:135-149 (ProviderPort sketch 1
        configureCredential) with reference store.ts:1316
  detail: The DR3 Sketch-1 advisory (the runtime does the wire calls, key handed to runtime)
        is correct in principle, but if L3/L5 naively wire configureCredential to the
        reference path c.auth.set(...) (store.ts:1316), OpenCode persists the key into its
        own auth.json — recreating a second, plaintext-at-rest credential store and breaking
        both PR9 (one OS-backed store) and the one-source-of-truth invariant. The evidence
        DOES flag the seam (provider-and-credentials.md:196-199, Part D q1; runtime-candidates.md:110)
        and recommends per-launch env/config injection, never persisting keys in the OpenCode
        store — this finding only asks that the L3 credential ADR make that constraint explicit
        and testable, not implicit.
  failure_scenario: L3 picks reuse-OpenCode + thin management port; implementer maps
        configureCredential to c.auth.set; user adds a real key; the key lands unencrypted
        in %APPDATA%/opencode/auth.json. A diagnostics bundle or a support screenshot of that
        file now leaks a live provider key even though the OS-vault store also holds it.
  recommendation: In the L3 credential ADR, require env/config injection at spawn/call time and
        forbid the SDK c.auth.set persistence path; add a negative test asserting no provider
        key is written to the runtime own auth store on disk.

- [LOW] Diagnostics-scrubber gap is no-op today but must-not-be-later
  file: .loop-engineer/evidence/L2/provider-and-credentials.md:71-74 with
        reference diagnostics-bundle.ts:121-130
  detail: DR3 correctly notes provider keys do not reach the current scrubber because they live
        in the OpenCode store outside app process state. Accurate for the reference, but once
        the Cowork GHC ProviderPort resolves keys at the boundary (as designed), provider keys
        WILL transit the server/shell process and MUST be added to the scrubber collected-secrets
        set (PR8). The evidence anticipates this via redactionPatterns() (line 142); recording
        as LOW so L3 does not treat "keys never enter diagnostics" as a permanent property.
  failure_scenario: L3 builds the boundary key-injection path but leaves collectSecretValues
        token-scoped; a resolved provider key appears in a perf/developer log captured into the
        diagnostics bundle and is not redacted.
  recommendation: L3 diagnostics/redaction ADR must extend the scrubber secret set to include
        resolved provider key material at the execution boundary, with a redaction unit test.

## What I checked and found clean (explicit)

- Secret leakage across all L2 evidence and report: none (placeholders only). CLEAN.
- P7 loopback default 127.0.0.1 at config.ts:48 and acceptance-test soundness. CLEAN.
- PR9 two-store gap (auth.json via c.auth.set; env.json plaintext-on-Windows chmod no-op):
  claims verified TRUE in code, not overstated. CLEAN.
- 6-option credential comparison (keytar archived, safeStorage=DPAPI/Electron-only,
  @napi-rs/keyring=OS-vault shell-neutral, all handle-only in app state): sound. CLEAN.
- Diagnostics scrubber token-scope (diagnostics-bundle.ts:121-130) and the PR8 gap being
  correctly flagged for L3. CLEAN.
- No transport option silently binds 0.0.0.0; non-loopback is explicit ADR-gated opt-in. CLEAN.
- No advisory leaks a key to the renderer or accepts a design that fails PR9 as its
  recommendation (the runtime-store-as-single-store option is flagged as a hazard). CLEAN.

Note: clean.bat safety and workspace path-traversal enforcement are NOT part of L2 (Discovery)
scope — no cleanup manifest or file-op boundary code is authored yet — so they are out of scope
for this review and carried to the implementation-loop security review.

## Blocking status
No unresolved CRITICAL or HIGH findings. L2 discovery evidence is accurate, honestly scoped,
and safe to pass the discovery gate. The two findings are forward-looking constraints for the
L3 ADRs, not defects in the L2 artifacts.
