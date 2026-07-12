# Review — Test Engineer (Testability Lens)

Review target: L1-REV-TEST — `docs/product/cowork-ghc-scope-and-acceptance.md`
Reviewer role: test-engineer (independent; did NOT author the document)
Verdict: **PASS_WITH_FINDINGS**

## Scope of this review
Testability of acceptance criteria: every MUST has an observable/falsifiable
criterion; negative/error paths present where they matter; Windows lifecycle
acceptance is Release-Verifier-checkable; scope separation from OpenWork; §8
traceability covers every MUST. Architecture/framework choices explicitly NOT judged.

## What I verified (positive)
- **Every MUST has at least one acceptance criterion.** I mapped all 40 MUST IDs in
  the §3 matrix to a criterion in §4/§5. None is missing (this is the condition that
  would otherwise force a HIGH finding).
- **Core negative/security paths are present and testable**: Deny actually blocks on
  disk incl. UI-bypass (P3), path traversal `..`/absolute/UNC/symlink refused with a
  no-file-touched assertion (F4), invalid key / timeout / HTTP 429 / unavailable each
  mapped with bounded retries (PR7), secret never in log/DOM/state/screenshot/export
  with a scrub test (PR8), no key in browser local storage / frontend state (PR9),
  clean-while-running refused with exit 4 (LC4), stale PID handled (LC3),
  start-before-init prompts + honest NOT READY exit 3 (LC2).
- **Windows lifecycle (§5) is verifiable the way a double-click is**: documented exit
  codes (0/3/4/9), `%~dp0` root independence incl. different-drive launch, clean
  preserve-list with default-No confirmation and `--yes`, stop-only-tracked-PIDs
  honesty. A Release Verifier can execute these without a terminal.
- **Scope separation is clean**: OpenWork's unbuilt features (templates, marketplace,
  memory bank) appear only in the §1 disclaimer. None is smuggled in as a MUST;
  workflow templates (RE4) are explicitly SHOULD and marked "not inherited from
  OpenWork". Marketplace / memory bank are not requirements at all.
- **§8 traceability matches the matrix**: the 40 MUST IDs listed in §8 are exactly the
  MUSTs in §3, and each has a §4/§5 criterion.

## Findings

- [MEDIUM] MUST count and total-capability count are arithmetically wrong (§9)
  file: docs/product/cowork-ghc-scope-and-acceptance.md:400-407
  detail: §9 states "MUST: 41" and "Total capabilities classified: 66", but the IDs
    enumerated in §9 (and independently in the §3 matrix + §8 table) sum to **40 MUSTs**
    and **65 total** (40 MUST + 15 SHOULD + 2 COULD + 5 DEFERRED + 3 OUT_OF_SCOPE).
  failure_scenario: A verifier building a test-coverage checklist from §9 expects 41
    MUST cases, searches for the missing one, and either wastes effort or wrongly
    concludes a MUST criterion was dropped. Undermines confidence in the traceability
    section, which is itself a gating artifact for L1.
  recommendation: Correct §9 to "MUST: 40" and "Total: 65", or, if a 41st MUST was
    intended, add it to the matrix, §4/§5 acceptance, and §8. Prefer deriving the
    counts mechanically so they cannot drift.

- [MEDIUM] Lifecycle negative-path acceptance is incomplete vs the required negative set (§5)
  file: docs/product/cowork-ghc-scope-and-acceptance.md:322-337
  detail: `.claude/rules/testing.md` (Negative tests) lists start-twice / already-
    running, "port taken", "multiple instances", "clean with locked file", "corrupt
    cleanup manifest", and "corrupt runtime state" as required negative cases. §5 does
    not give observable acceptance for any of these: LC2 covers not-ready/start-before-
    init but not a second start while running or a port already in use; LC4 covers
    preserve-list and root-uncertain refusal but not an undeletable/locked target or a
    malformed `cleanup-manifest.json`; nothing covers corrupt `.runtime/` PID/state
    parsing beyond "stale PID handled".
  failure_scenario: A user double-clicks `start.bat` twice, or `start.bat` while the
    port is occupied; or `clean.bat` runs against a locked file or a hand-corrupted
    manifest. Without a stated expected behavior + exit code, the Release Verifier has
    no pass/fail line and the script's behavior is undefined-by-spec.
  recommendation: Add observable criteria: start-while-running is a no-op/refusal with
    a defined code (not a second instance); port-in-use reports a mapped error, not a
    fake launch; `clean.bat` on a locked file reports which path failed and returns
    non-zero without partial silent success; a corrupt manifest or corrupt runtime
    state causes refuse-to-run (root-uncertain style) rather than a dangerous default.

- [MEDIUM] PR1 acceptance is not independently falsifiable as written (§4 Provider)
  file: docs/product/cowork-ghc-scope-and-acceptance.md:243-245
  detail: "adding a provider does not require changing unrelated UI/business code, and
    no single vendor is hard-coded into the core flow" is a design property, not a
    condition a test can assert at runtime. There is no observable artifact
    (registry/enumeration, provider-neutral core path) to check.
  failure_scenario: Two reviewers disagree on whether a hard-coded `if provider ===
    "anthropic"` branch in the core flow violates PR1; the criterion cannot adjudicate.
  recommendation: Give it an observable check, e.g. "providers are enumerated from a
    single registry/adapter list; a static/structural test asserts no vendor literal in
    the core send/stream path; adding the 6th adapter touches only the adapter module +
    one registration point (diff-scoped test)."

- [MEDIUM] RE6 product-level acceptance is largely deferred to L3 (§4 Runtime extension)
  file: docs/product/cowork-ghc-scope-and-acceptance.md:274-276
  detail: RE6's observable content reduces to "runtime version is pinned and shown (see
    SD7)"; the reuse-vs-build substance is an open L3 decision (§7). As stated, the only
    testable part duplicates SD7, so RE6 has no independent falsifiable condition at L1.
  failure_scenario: A build that reimplements an agent loop in-house but still displays
    a version string would pass RE6 as written, defeating the "do not rebuild a runtime"
    invariant the criterion exists to protect.
  recommendation: Add an L3-decision-independent observable, e.g. "the agent/tool
    execution loop is provided by an external, pinned runtime dependency invoked through
    an adapter; no in-house token-generation/tool-dispatch loop exists in the core;
    verified by dependency manifest + adapter seam presence."

- [MEDIUM] Corrupt-config resilience is only SHOULD, though listed as a required negative case
  file: docs/product/cowork-ghc-scope-and-acceptance.md:296-297
  detail: SD5 ("recover from corrupt settings") is SHOULD (non-gating). `testing.md`
    lists "corrupt settings" among required negative tests, and "do not brick on bad
    config" is a resilience expectation. There is no MUST that the app fails safe rather
    than crash-loops on corrupt persisted config or corrupt runtime state.
  failure_scenario: A corrupted settings/session file after an unclean shutdown makes
    the app crash on every launch; because SD5 is non-gating, this passes L1 acceptance.
  recommendation: Consider promoting the minimal safety half ("does not crash / recovers
    to safe default on corrupt config") to MUST, keeping the full reset UX as SHOULD.
    This is a scope call for the requirement owner; flagging the testability gap only.

- [LOW] No acceptance for write atomicity on interrupted/crash-mid-write (§4 File ops)
  file: docs/product/cowork-ghc-scope-and-acceptance.md:227-236
  detail: The §3 matrix cites "atomic temp+rename write" for F1/F6, but F6's acceptance
    only asserts final on-disk bytes for a completed op. No criterion asserts that an
    interrupted write leaves either the prior or the new content and never a truncated/
    corrupt file — relevant to the "app closed mid-task" negative case.
  recommendation: Extend F6 (or S3/S4) with: an interrupted/aborted mutation leaves the
    target file in a consistent state (old or new, never partial); assertable by killing
    mid-write in a test.

- [LOW] "Without blocking the UI" (S2) lacks an observable threshold (§4 Agent session)
  file: docs/product/cowork-ghc-scope-and-acceptance.md:186-188
  detail: "streams incrementally without blocking the UI" is a good intent but has no
    observable indicator (e.g. UI stays interactive / responds to input / can Cancel
    during streaming). Borderline-soft for an automated assertion.
  recommendation: Anchor to something observable, e.g. "the Cancel control and input
    remain responsive during streaming; tokens render progressively (>1 render before
    completion)." Acceptable at L1, but tighten before test authoring.

- [LOW] "No secret in a screenshot" (PR8) is not directly automatable (§4 Provider)
  file: docs/product/cowork-ghc-scope-and-acceptance.md:257-259
  detail: PR8 correctly lists screenshot as a surface, but a screenshot cannot be
    asserted programmatically. The operational, testable equivalent (no secret in
    rendered DOM/text/state) is already implied by PR8/PR9.
  recommendation: State that the screenshot guarantee is discharged by "no secret in
    rendered DOM/visible text/state" (the automatable condition), so the criterion is
    not misread as requiring image inspection.

## Summary
No MUST lacks a testable acceptance criterion, core security/negative paths are
present and falsifiable, and lifecycle acceptance is Release-Verifier-checkable. The
findings are refinements: a count/traceability arithmetic error, gaps in lifecycle
negative-path coverage, and a few criteria that are design-properties rather than
runtime-falsifiable conditions. None blocks DONE; all should be addressed before test
authoring so the coverage checklist is accurate.
