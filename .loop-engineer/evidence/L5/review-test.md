# L5 Master Plan — Independent Test-Strategy Review

- **Task ID:** L5-REV-TEST
- **Reviewer:** test-engineer (independent; did NOT author the plan)
- **Loop:** L5 (Master Plan / planning). This is a PLANNING review — no test/impl code written.
- **Date:** 2026-07-11
- **Targets:** `docs/product/cowork-ghc-master-plan.md`; `.loop-engineer/state/tasks.yaml` (CGHC-001..028 + CGHC-WEB-001 backlog)
- **Rubric:** `.claude/rules/testing.md`
- **Grounding:** `docs/product/cowork-ghc-scope-and-acceptance.md`, `.loop-engineer/evidence/L4/review-dispositions.md`, `.loop-engineer/evidence/L4/web-readiness-delta.md`

## Outcome: CHANGES_REQUIRED

The plan is structurally testable and unusually strong on the highest-risk seams (real-frame
fixture gate, credential no-key-at-rest, permission Deny-on-disk, value-based redaction intent).
But three security-sensitive/carried acceptance items are not provable by the tests currently
listed on their owning task, and the release E2E task's dependency set is incomplete for the very
critical path it claims to run. These are small, bounded plan edits (add test lines / fix a
dependency list), not a redesign — but they must land before freeze because they are exactly the
carried-L4 items the plan was told to close and the plan's own DoD forbids hollow-green.

---

## 1. REQUIRED unit-test area coverage (testing.md §"Required unit tests")

| Area | Owning task + test line | Verdict |
|---|---|---|
| Domain services | CGHC-013 session, CGHC-010 provider, CGHC-007 workspace | COVERED |
| Workspace validation | CGHC-008 "workspace validation unit test" | COVERED |
| Permission decisions | CGHC-016 "permission round-trip test" | PARTIAL — round-trip only; no unit test of the decision itself (approval-level P4 classification, fail-closed timeout P6) though both are in acceptance (tasks.yaml:405) |
| Provider configuration | CGHC-010 "provider configuration unit test" | COVERED |
| Model selection | CGHC-019 "model selection unit test" | COVERED |
| Secret redaction | CGHC-021 "secret redaction (value-based) unit test"; CGHC-009 "secret redaction / no-key-at-rest" | COVERED |
| Event reducer/state machine | CGHC-012 "EV reducer / state machine unit test" | COVERED |
| Session logic | CGHC-013 "session logic unit test" | COVERED |
| Template logic | CGHC-026 "template logic unit test" | COVERED but SHOULD/MEDIUM ("built if it fits POC budget", tasks.yaml:666) — may not ship |
| Error mapping | CGHC-020 "provider error mapping contract test"; CGHC-021 "error mapping / no-leak test" | COVERED |
| Contract mapping | CGHC-012 SSE→EV map; master-plan:236 lists it on CGHC-013 | COVERED (via CGHC-012) |
| Controller state/fingerprint logic | NONE of CGHC-001..028 | NOT MAPPED — belongs to pre-existing `tools/loop-engineer` (has its own `node --test`); not a product task. LOW. |
| Runtime process identity | CGHC-001 + CGHC-004 identity tests | COVERED |
| Cleanup-manifest validation | CGHC-023 "cleanup-manifest validation test" | COVERED |
| Path allowlist | CGHC-007 "path allowlist unit test"; CGHC-023 | COVERED |
| PID state parsing | CGHC-004 "PID state parsing unit test" | COVERED |
| Start/stop orchestration | CGHC-005 "start/stop orchestration logic test" | COVERED |

**Result:** 15/17 fully mapped. `controller state/fingerprint` is unowned but is pre-existing
tooling (LOW). `permission decisions` maps only to a round-trip test, leaving P4/P6 pure-decision
logic untested (see Finding H2).

## 2. Provider contract suite + hollow-green seam

- **Suite ownership:** CGHC-024 (owner test-engineer, reviewer runtime-llm-engineer — reviewer≠owner OK)
  explicitly names all 9 dimensions: "connect/auth/model/streaming/timeout/cancel/rate-limit/
  error-mapping/redaction" reused across adapters (tasks.yaml:607). STRONG.
- **Hollow-green defense:** captured-real-frame fixtures + re-capture "wired into the ADR 0001
  pin/upgrade gate" (tasks.yaml:605-606) with a "fixture re-capture pin-gate test" (tasks.yaml:610);
  paired with CGHC-001 "pin/upgrade gate test". This directly closes L4 Test-H1. EXCELLENT — the
  plan avoids fictional-frame green.
- **GAP (M1):** the suite is *defined* once, but no task asserts it *runs across all 5 provider
  configs incl. the user-defined OpenAI-compatible*. CGHC-011 tests are unqualified "provider
  contract connect + auth-error test" (tasks.yaml:281); CGHC-010 supports the 5 (tasks.yaml:252) but
  its tests are config + SSRF only. Since all adapters delegate to one OpenCode impl (CGHC-010:251),
  a per-provider-config parametrized run is cheap and should be an explicit assertion so the custom
  endpoint is not silently unexercised.

## 3. E2E critical path

- **Ownership:** CGHC-028 (owner test-engineer, reviewer release-verifier) runs the packaged E2E
  and explicitly forbids dev-server evidence (tasks.yaml:707,715). Chain in acceptance:
  init→start→workspace→provider/model→session→streaming→permission→file-on-disk→stop→resume→clean
  (tasks.yaml:709). Slice narrative VS-01→VS-10 covers the path (master-plan:50-53). STRONG intent.
- **BROKEN LINK (H1):** CGHC-028 `dependencies` = [CGHC-006, CGHC-018, CGHC-023] only
  (tasks.yaml:699-702). The full critical path also requires test-connection (CGHC-011), streaming
  UI (CGHC-015), permission UI (CGHC-017), model pick/switch (CGHC-019), and resume/crash-recovery
  (CGHC-025) — none are in CGHC-028's transitive dependency closure (018→016→012/013→010; 015/011/
  017/019/025 are NOT pulled in). The controller can therefore mark CGHC-028 READY before the
  provider "test connection", "pick model", streaming-UI, and resume features exist, inviting a
  failed or falsely-scoped release run.
- **Minor (M2):** acceptance chain omits testing.md's "run template → provider error" legs
  (testing.md:24). Template is SHOULD (may not ship) but the provider-error leg (CGHC-020) is a MUST
  path and should appear in the E2E chain.

## 4. Negative tests (testing.md §"Negative tests")

Assigned to a task: invalid/missing key (CGHC-020/011), timeout (CGHC-020), 429 (CGHC-020),
network loss (CGHC-020:504), path traversal (CGHC-007), stream interrupted (CGHC-014 resync),
corrupt settings (CGHC-022), Deny (CGHC-016), orphan child (CGHC-005), stale PID (CGHC-004/005),
spaces+Unicode (CGHC-008), clean-while-running (CGHC-023 exit 4), clean non-allowlisted (CGHC-023),
corrupt cleanup manifest (CGHC-023 validation), missing toolchain (CGHC-006 exit 9),
stop-before-start (CGHC-005/006 nothing-running=0).

**Gaps — named in testing.md but with NO owning task test (M3):**
- **port taken** — no task (grep of tasks.yaml: 0 hits); CGHC-002 only tests loopback bind.
- **locked file** / **clean with locked file** — no task; CGHC-018/023 don't test a locked target.
- **multiple instances** — no task.
- **app closed mid-task** — only partially via CGHC-013 restore-after-restart; no mid-task-kill test.
- **start-before-init / start twice** — CGHC-006 acceptance implies it (prompt init) but no explicit test line.
- **dependency download failure** — no task; CGHC-006 covers missing toolchain only.

Master-plan §5 defers "negative tests đầy đủ … port taken … locked file …" to the **L8 hardening
loop** (master-plan:350-353). That is a reasonable staging, but these negatives currently live only
as loop prose, not as a task-owned `tests` entry, so no executable graph node owns them. Acceptable
if L8 spawns them, but the plan should name the owning task(s) to avoid orphaning.

## 5. Acceptance concreteness

Overwhelmingly concrete and disk-real: e.g. CGHC-016 "Deny … never performs the mutation on disk
… explicit deny reply" (tasks.yaml:403), CGHC-009 "no key on disk, in logs, or in any frontend/
local-storage snapshot … standard AND custom provider" (tasks.yaml:225), CGHC-002 "non-loopback
connection is refused" (tasks.yaml:45), CGHC-018 "assert actual on-disk bytes/state" (tasks.yaml:458).
Every MUST maps to ≥1 task (master-plan §8 traceability, self-asserted 41/41; spot-checked W4→007,
P3→016, PR9→009, F6→018, LC4→023 — all hold). No vague acceptance found. GOOD.

## 6. Perf budget

Numeric and measurable: cold-start shell <1.5s / readiness <300ms / full-ready <6s p95; first
token <500ms; hop overhead <50ms p95; coalescing 16–33ms, backpressure >60 ev/s; modal <200ms;
Allow/Deny round-trip <300ms; <5ms/batch, >50fps (master-plan:326-340). **GAP (M4):** no CGHC task
owns perf *measurement* — §4 says only "verify ở L8/L9" (master-plan:322) and CGHC-014/CGHC-025
(the perf-relevant tasks, ux-performance-reviewer) carry NO numeric perf assertion in their `tests`.
Targets without an owning measurement task risk never being executed as a gate.

## 7. Tests too weak to prove acceptance

- **H3 — CGHC-025 renderer hardening (security-sensitive, carried L4 UX-MED/frontend-MED-3):**
  acceptance lists the full checklist "restrictive CSP, sandbox true, nodeIntegration false,
  contextIsolation true, navigation lockdown, no generic IPC passthrough" (tasks.yaml:633) but its
  two tests are "health check / progressive-readiness" and "restart / resume after crash"
  (tasks.yaml:635-636). NOTHING asserts the hardening flags. A carried security item with an
  untested checklist is hollow.
- **H2 — CGHC-016 permission P4/P6:** acceptance asserts "approval timeout fails closed (P6)" and
  "approval levels (P4)" (tasks.yaml:405) but tests are round-trip + Deny-on-disk only
  (tasks.yaml:407-408). Fail-closed-timeout and level classification are unproven.
- **M5 — value-based redaction end-to-end:** CGHC-021 acceptance covers "the diagnostics bundle and
  the execution-metadata record" (tasks.yaml:527) but its tests are a unit scrubber + no-leak test;
  the VS-09 demo "export diagnostics bundle → grep secret → 0 hit" (master-plan:150) has no owning
  test. CGHC-022 owns the SD4 export (tasks.yaml:555) yet its tests are corrupt-settings +
  persistence only — no bundle-scrub grep. The strongest real-effect test for the carried L4
  Security-H (value-based redaction) is missing.
- **M6 — CGHC-013 S4 restore:** acceptance "history restorable after restart" (tasks.yaml:329) has
  no restart test (restart/resume is deferred to L7 integration — acceptable, noted).

Well-covered (called out per instructions): CGHC-024 real-frame contract seam; CGHC-009 credential
no-key-at-rest for standard+custom; CGHC-018 on-disk-bytes; CGHC-007 traversal negatives; CGHC-003
import-direction lint; CGHC-028 packaged-only evidence. These are model test plans.

---

## Findings by severity

**HIGH**
- **H1 (CGHC-028):** release E2E dependency set incomplete for its own critical path — missing
  CGHC-011, CGHC-015, CGHC-017, CGHC-019, CGHC-025 in the dependency closure; can be marked READY
  before test-connection / streaming-UI / model-pick / permission-UI / resume exist.
- **H2 (CGHC-016):** fail-closed approval timeout (P6) and approval-level (P4) in acceptance but no
  test proves them.
- **H3 (CGHC-025):** renderer-hardening checklist (carried L4 security item) in acceptance but no
  test asserts CSP/sandbox/contextIsolation/nav-lockdown.

**MEDIUM**
- **M1 (CGHC-024/011):** contract suite not asserted to run across all 5 provider configs incl. the
  user-defined OpenAI-compatible.
- **M2 (CGHC-028):** E2E chain omits the provider-error (and template) legs.
- **M3 (unowned):** port-taken, locked-file, multiple-instances, app-closed-mid-task, start-twice,
  dependency-download-failure negatives have no task-owned test (only L8 loop prose).
- **M4 (perf):** numeric perf budget has no owning measurement task.
- **M5 (CGHC-021/022):** diagnostics-bundle scrub ("grep → 0 hit") — carried L4 Security-H — has no
  end-to-end test.
- **M6 (CGHC-013):** S4 restore-after-restart untested (acceptably deferred to L7).

**LOW**
- **L1:** controller state/fingerprint required-unit-area unowned by CGHC (covered by pre-existing
  `tools/loop-engineer` tests).
- **L2:** template-logic test (CGHC-026) is on an all-SHOULD task that may not ship.

## Verdict

**CHANGES_REQUIRED.** The task graph, slices, traceability, contract-suite design, and hollow-green
defense are strong and largely testable. But before freeze the plan must (cheaply) close three
carried/security-sensitive gaps where the listed tests cannot prove the acceptance (H1 dependency
closure, H2 P4/P6 permission tests, H3 renderer-hardening test), plus wire the value-based-redaction
bundle test (M5). None require redesign — each is a `tests`/`dependencies` line edit in tasks.yaml.

## Top 3 test-coverage gaps to close before L6

1. **Renderer-hardening checklist untested** → add a hardening-assertion test (CSP/sandbox/
   contextIsolation/nodeIntegration/nav-lockdown) to **CGHC-025**. (Carried L4 security item.)
2. **Release E2E cannot actually run its path** → extend **CGHC-028** `dependencies` to include
   CGHC-011, CGHC-015, CGHC-017, CGHC-019, CGHC-025 and add the provider-error leg to its chain.
3. **Value-based redaction not proven end-to-end** → add a "export diagnostics bundle → grep secret
   → 0 hit" real-effect test to **CGHC-021** (and reuse redaction assertion in CGHC-022's SD4 export).

## One line

Structurally testable and strong on the riskiest seams, but not yet freeze-ready: three small
tasks.yaml edits (H1/H2/H3 + M5) must land so the carried-L4 security items and the release E2E are
actually provable, not merely asserted.
