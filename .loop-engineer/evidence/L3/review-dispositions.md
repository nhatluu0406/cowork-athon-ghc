# L3 Architecture Candidates — Review Dispositions

Independent focused review of Loop L3 (reviewer ≠ implementer: the ADRs + implementation design
were authored by the **product-architect**; the review was performed by the **security-reviewer**,
which authored none of them).

- Security review: [review-security.md](review-security.md) — **PASS_WITH_FINDINGS** (0 Critical, 0 High, 2 Medium, 2 Low).
- Scope note: L3 only *drafts* the ADRs. The comprehensive multi-role critique + threat model + architecture **freeze** is **L4**. This review was deliberately scoped to grounding, invariant-compliance, decision-completeness, and no-feature-code; deeper items were flagged "for L4," not fully worked here.

**Gate impact: 0 unresolved Critical/High.** SEC-1 (never persist keys via the runtime's own store) and SEC-2 (scrubber covers provider keys) confirmed **closed** — the L2 PR9 gap is not silently recreated. All invariants (P7 loopback-only + test, Deny enforced on disk at the boundary, workspace/path-traversal, secrets handle-only, single credential store) confirmed clean. All six decisions DECIDED (Status: Proposed). No feature code. All spot-checked L2 citations verified.

## Findings and dispositions

| # | Sev | Finding (source) | Disposition |
|---|-----|------------------|-------------|
| SEC-MED-1 | MEDIUM | Supervision `identityToken` (ADR 0004, in `.runtime/pids/*.json` + on child command line) vs the ADR 0003 per-launch boundary client-token may be the same secret; both are same-user-readable, so "co-resident process can't call the boundary" holds only under a stated single-user trust model. P7 still passes (loopback). | **CARRY TO L4 (threat model).** Captured in-artifact: added an explicit threat-model open item to [ADR 0003 §Open items for L4](../../docs/architecture/decisions/0003-local-service-transport-placement-loopback.md) — L4 decides distinct-secrets (recommended) vs same-value + records the single-user trust boundary. Non-blocking for a single-user POC. |
| SEC-MED-2 | MEDIUM | The user-defined OpenAI-compatible `base_url` (ADR 0005) is an SSRF/exfil surface with no stated scheme/host validation; must have a policy before the D4 gateway is built. | **CARRY TO L4 (threat model) + encoded as a hard prerequisite.** Added a threat-model open item to [ADR 0005 §Open items for L4](../../docs/architecture/decisions/0005-provider-abstraction.md): require `https`, host allowlist/deny of loopback/link-local/RFC-1918 metadata targets; hard prerequisite before D4. Low risk in the single-user POC (self-inflicted). |
| SEC-LOW-1 | LOW | PR2 (add provider credential) is traced in ADRs 0005/0006 but missing from the design §10 MUST traceability table. | **RESOLVED in L3.** Added a PR2 row to [implementation-design §10](../../docs/architecture/cowork-ghc-implementation-design.md) and an explicit PR2 row to [ADR 0005 traceability](../../docs/architecture/decisions/0005-provider-abstraction.md). |
| SEC-LOW-2 | LOW | "bind `:0`" shorthand in ADR 0003 could be misread as all-interfaces. | **RESOLVED in L3.** Reworded [ADR 0003 §Loopback-only](../../docs/architecture/decisions/0003-local-service-transport-placement-loopback.md) to `listen({ host: "127.0.0.1", port: 0 })` — `port: 0` selects a free port and does not widen the interface; host is always loopback, never `0.0.0.0`. Backstopped by the P7 socket-inspection test regardless. |

## Net for L4

The architecture candidates are grounded, internally consistent, invariant-compliant, and complete
enough to freeze. L4's multi-role critique + threat model must, at minimum, resolve the two carried
MEDIUM items (token-scheme distinction; custom-`base_url` SSRF policy) and ratify or override the two
flagged author overrides: **standalone service placement (ADR 0003)** and **5th provider = user-defined
OpenAI-compatible endpoint (ADR 0005)** — plus the closest call, **shell = Electron (ADR 0002)**.

All four are additive/ratification items for L4; none blocks the L3 gate.
