# L1 — Independent Review Dispositions

Two independent reviewers (neither authored the scope doc — implementer was
product-architect). Full reviews: `review-test-engineer.md`, `review-security.md`.

| Reviewer | Verdict | Crit | High | Med | Low |
|----------|---------|------|------|-----|-----|
| security-reviewer | PASS_WITH_FINDINGS | 0 | 1 | 2 | 1 |
| test-engineer | PASS_WITH_FINDINGS | 0 | 0 | 5 | 3 |

DoD rule: no unresolved Critical/High. Result after dispositions below: **0 unresolved Critical/High**.

## HIGH — fixed now
- **[SEC HIGH-1] Loopback-only binding had no capability id / testable acceptance.**
  FIXED: added MUST **P7** (Area 4) — service binds loopback only (`127.0.0.1`/`::1`),
  non-loopback connection refused (testable), non-loopback needs an L3 ADR. Added to
  matrix §3, acceptance §4, traceability §8, and counts §9. This also reconciled the
  count discrepancy → enumerated 41 MUST / 66 total now matches the §9 header.

## MEDIUM — dispositioned
- **[TEST] §9 counts (41/66 vs enumerated 40/65).** RESOLVED by the P7 addition above
  (enumeration now equals the stated 41/66).
- **[TEST] §5 lifecycle negative coverage incomplete** (start-twice/already-running,
  port-taken, multiple instances, clean-with-locked-file, corrupt manifest, corrupt
  runtime state). DEFERRED to L5 (test plan) / L8 (hardening) — these are the loops that
  own negative-test enumeration per `.claude/rules/testing.md`. Tracked here so they are
  not lost. Requirement intent already covered by the invariants; only per-case acceptance
  is deferred.
- **[TEST] PR1 not runtime-falsifiable** ("no vendor hard-coded"). ACCEPTED for L1; the
  observable (registry/enumeration + structural no-vendor-literal check) is an L3 design
  concern. Noted as input to the provider-abstraction ADR (Open decision #4).
- **[SEC] Command/shell tool execution lacks an explicit approval acceptance** (P3 covers
  file write only). DEFERRED to L3/L5: fold shell-exec under the same execution-boundary
  approval as file ops; add its acceptance when the tool surface is designed.
- **[SEC] No requirement to integrity-verify downloaded runtime/dependency executables.**
  DEFERRED to L2/L3 (dependency/runtime bootstrap design); security rule already forbids
  "unverified downloaded executables" — to be made a concrete acceptance when the runtime
  acquisition path is chosen.

## LOW — accepted (no action in L1)
- **[TEST] RE6 observable collapses to SD7 version display; reuse-vs-build deferred to L3.**
  ACCEPTED — RE6 is intentionally a boundary/decision item for L3; SD7 covers the visible
  part. Reuse-vs-build is Open decision #2.
- **[TEST] SD5 corrupt-config only SHOULD.** ACCEPTED — the "don't crash-loop / fail safe"
  intent is captured; promotion to MUST can be revisited in L8 hardening.
- **[SEC LOW]** Minor wording nits — accepted.

## Conclusion
L1 scope/acceptance passes independent review with the one HIGH fixed and all Mediums/Lows
explicitly dispositioned (fixed, deferred-with-owner, or accepted). No unresolved
Critical/High findings remain.
