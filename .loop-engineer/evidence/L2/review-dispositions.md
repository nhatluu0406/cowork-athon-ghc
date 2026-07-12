# L2 Discovery — Review Dispositions

Consolidates the two independent reviews of Loop L2 (reviewer ≠ implementer: the three
discovery evidence files were authored by repository-researcher agents and the discovery
report by the Lead; neither reviewer authored what they reviewed).

- Decision-readiness + grounding: [review-product-architect.md](review-product-architect.md) — **PASS_WITH_FINDINGS** (0 High, 1 Medium, 2 Low). 9/9 spot-checked reference citations verified against real code.
- Security (PR9/P7/redaction/no-secrets): [review-security.md](review-security.md) — **PASS_WITH_FINDINGS** (0 Critical, 0 High, 1 Medium, 1 Low). No secret material present; PR9/P7 claims verified TRUE and not overstated.

**Gate impact: 0 unresolved Critical/High. Both reviewers explicitly recommend passing the discovery gate.**

## Findings and dispositions

| # | Sev | Finding (source) | Disposition |
|---|-----|------------------|-------------|
| PA-1 | MEDIUM | License sweep sampled, not complete — "license" is a named L2 goal but only OpenCode + credential candidates were license-checked (review-product-architect §MEDIUM-1). | **RESOLVED in L2.** Added [discovery-report §3.6 "License posture"](../../reports/discovery-report.md): verified OpenWork = MIT except `/ee` (Fair Source, = OOS1, not a dependency), and the direct runtime/shell/credential deps are all permissive (MIT/BSD). Automated *transitive* SPDX scan deferred to **L5** (no app `package.json` exists yet); `/ee` boundary flagged for the **L3** runtime ADR. |
| PA-2 | LOW | The §2 DR1→DR2 coupling arrow was stronger than the evidence — runtime and shell are largely orthogonal (both shells spawn a runtime child identically). | **RESOLVED in L2.** Rewrote the §2 diagram + prose to show DR1 and DR2 as parallel roots that can be decided independently; only the DR3 dependencies remain. |
| PA-3 | LOW | Persistence/session-store sub-decision should be folded into the runtime ADR rather than treated separately. | **CARRY TO L3.** Advisory; recorded in the L3 open-questions handoff below. No L2 change needed. |
| SEC-1 | MEDIUM | If L3/L5 implement `configureCredential` via the reference `c.auth.set` path (`store.ts:1316`), OpenCode persists the key into its own plaintext `auth.json`, recreating a second at-rest store and breaking PR9 (review-security §MEDIUM-1). | **CARRY TO L3 (credential-store ADR) as an explicit, testable constraint:** keys are injected into the runtime at launch/call time and **never** persisted via `c.auth.set`; add a negative test asserting no key is written to the runtime's `auth.json`/`env.json` on disk. Already flagged as the anti-pattern in discovery-report §3.4 and DR3 Part D#1; this makes it a hard L3 requirement. |
| SEC-2 | LOW | Once a ProviderPort resolves keys at the execution boundary, provider key material must be added to the log/diagnostics scrubber (PR8) — the reference scrubber (`diagnostics-bundle.ts`) only redacts session/host tokens today. | **CARRY TO L3 (diagnostics/redaction ADR).** DR3's `redactionPatterns()` on the ProviderPort anticipates this; L3 must make the scrubber cover provider keys and L5/L6 must test it. |

## Net for L3 (carry-forward requirements distilled from findings)

1. Runtime ADR: note the `/ee` Fair Source boundary (do not copy `/ee`); fold persistence/session-store into this ADR (PA-3).
2. Credential-store ADR: mandate inject-at-launch, **never** persist keys via the runtime's own auth store; negative-test on disk (SEC-1). Prefer a shell-neutral OS-backed store so the ADR can precede the shell decision.
3. Diagnostics/redaction ADR: scrubber must cover provider key material once keys reach the boundary (SEC-2).
4. L5: add an automated transitive license scan once the app `package.json` exists (PA-1 residual).

All four are additive requirements for later loops; none blocks the L2 gate.
