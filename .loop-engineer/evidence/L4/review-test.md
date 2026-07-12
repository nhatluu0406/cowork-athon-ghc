# L4 Independent Design Review — Testability / Test-Strategy Lens

- Task: **L4-REV-TEST**
- Reviewer role: Test Engineer (independent; did not author the design/ADRs).
- Scope: Is the frozen-candidate architecture TESTABLE against `.claude/rules/testing.md` before freeze?
- Targets reviewed (fully): `docs/architecture/cowork-ghc-implementation-design.md`;
  `docs/architecture/decisions/0001..0006` + `README.md`.
- Grounding: `.claude/rules/testing.md` (rubric); `docs/product/cowork-ghc-scope-and-acceptance.md`;
  `.loop-engineer/reports/discovery-report.md`; `tools/loop-engineer/lifecycle.mjs` (existing scaffold);
  `scripts/cleanup-manifest.json` (present).
- Constraint honored: no implementation code or test suites written (design loop; no code exists).

## Outcome

**COMPLETE.** Review performed; findings below; verdict rendered.

## Verdict

**APPROVE-WITH-CONDITIONS (conditional pass).** The architecture is broadly testable and locks in
several genuine testability wins (standalone loopback service, single `ProviderPort`, fake credential
store, pure lifecycle/cleanup helpers). But **two HIGH gaps** would, if frozen unaddressed, force
*hollow-green* or *live-LLM-only* tests in exactly the highest-priority areas testing.md names
(providers, permission, execution visibility). Both are **additive seams**, not ADR reversals — the
freeze may proceed only if they are recorded as freeze conditions handed to L5.

## Findings by severity

Counts: **CRITICAL 0 · HIGH 2 · MEDIUM 5 · LOW 2.**

### HIGH-1 — No captured-real-frame fixture seam for the OpenCode SSE boundary (hollow-green risk)
- Evidence: `0001:60-64` (SSE treated as external contract, mapped at boundary); `design §4:92`
  ("mapped, not fabricated"); `0005:99-101` ("contract tests run against the port **with a fake
  runtime**"); `0005:44` `mapError(raw: unknown)`; `0001:112` open item leaves SSE re-normalization
  extent unconfirmed.
- Untestable scenario: The provider contract suite (connect/auth-error/streaming/timeout/cancel/429/
  error-mapping) and the EV1–EV7 event reducer (required unit test, testing.md:6) both run against a
  **fake runtime**. Nothing in the design pins WHAT frames that fake emits to REAL OpenCode SSE
  shapes. A test author will invent frames, `mapError`/EV-mapper will be written to match the invented
  frames, and every test goes green while never validating that real OpenCode actually emits `raw` in
  the shape the mapper expects — the definition of a hollow test (testing.md:39 forbids). Per-provider
  error fidelity (does OpenCode preserve enough to distinguish 401→`auth_invalid` from 429→
  `rate_limited` for Gemini vs OpenRouter?) is never asserted end-to-end.
- Required seam: a fake/stub runtime **fed by recorded-real OpenCode SSE fixtures** (error, event,
  stream frames per provider), with fixture **re-capture wired into the ADR 0001 pin/upgrade gate**
  (`0001:40-46`) so an upstream schema change fails the gate instead of silently invalidating the
  green mapper tests.

### HIGH-2 — SSRF/loopback allowlist (0005 MED-2) blocks the only deterministic no-live-LLM test driver
- Evidence: `0005:78-84` (5th provider = **user-defined OpenAI-compatible `base_url`**); `0005:131-135`
  (**threat-model MED-2**: custom `base_url` must reject/allowlist hosts and **block loopback/link-local/
  RFC-1918** targets); testing.md:40-41 (live LLM tests are opt-in/bounded — i.e. NOT the default suite).
- Untestable scenario: The custom OpenAI-compatible endpoint is the *only* seam that lets a test point
  a provider at a **local mock HTTP/SSE server** to exercise, deterministically and without a live key:
  provider contract (connect/429/timeout/stream/cancel/error-mapping), AND — by scripting a mock that
  returns a tool call — the **permission round-trip** (drive OpenCode to a real tool-permission event
  → Deny → assert disk). If the SSRF policy is frozen as a blanket loopback/RFC-1918 ban, the mock
  server (`127.0.0.1`) is unreachable, and all of the above collapse to non-deterministic live-LLM
  tests (disallowed as the default suite). The security ADR and the test strategy are in direct
  conflict and the freeze must reconcile them.
- Required seam: the custom-endpoint validation policy must define an **explicit test-mode / opt-in
  loopback allowlist escape** (e.g. a config-gated "allow-local-endpoints" flag, off by default in
  production) so the deterministic provider + permission driver survives the security policy.

### MEDIUM-3 — Standalone service exposes no documented test-client handshake (ready / port / token)
- Evidence: `0003:38-52` + `design §3:78` claim headless testability, but `0003:59-64` allocates the
  port dynamically (`port: 0`) and `0003:66-68` issues a **per-launch client token to renderer/shell**;
  `0003:111-115` (MED-1) leaves undecided whether that client token is **distinct** from the ADR 0004
  supervision `identityToken`.
- Untestable scenario: A headless integration/E2E/P7 test client must (a) know the service is ready,
  (b) discover the OS-assigned port, (c) obtain the per-launch client token to authenticate. The
  supervision `identityToken` + port are in `.runtime/pids/local-service.json` (`0004:52-64`), but if
  the *client* token is a distinct secret (MED-1), no ADR states where a test reads it. Without a
  documented handshake, integration tests cannot authenticate to the boundary deterministically —
  UI↔service / service↔runtime / permission-round-trip (testing.md:15-17) stall at auth.
- Required seam: a documented, test-readable ready signal + port + client-token discovery (e.g. both
  tokens recorded in the `.runtime/pids` record, or a `/health` that returns readiness + a test-mode
  token path).

### MEDIUM-4 — Credential injection is observable only negatively (hollow-pass risk on inject-at-launch)
- Evidence: `0006:44-52` inject-at-launch via env/config to the spawned child; `0006:53-58` required
  negatives are all **absence** assertions (no key on disk / no key in frontend snapshot) + fake-store
  adapter.
- Untestable scenario: All prescribed tests assert the key is NOT somewhere. None asserts the key **was
  injected transiently into the child**. If injection silently breaks (feature bug), every "no key on
  disk / in state" test still passes green — a hollow pass that hides a broken credential path
  (testing.md:37 prioritizes credentials). The "assert real effect" rule (role:20) is unmet on the
  positive path.
- Required seam: an **injection-observation hook** — a spawn-env spy or a fake runtime that echoes the
  credentials it received over a test-only channel — so "injected transiently" AND "not persisted" are
  both asserted. The fake-store adapter (`0006:58`) is a good, deterministic hook and is credited.

### MEDIUM-5 — Lifecycle identity/liveness verification has no injectable inspector seam
- Evidence: `0004:70-86` hard-codes identity cross-check via `Get-CimInstance Win32_Process` and a live
  `/health` call; the tree-kill (`0004:88-97`) is `taskkill /T /F` **or** a Win32 Job Object, left as an
  open item (`0004:137`). Existing pure helpers `parsePidFile`/`runningPids`/`assessCleanTarget`
  (`lifecycle.mjs:50,81,25`) are testable; the reaper/identity path is not seamed.
- Untestable scenario: testing.md requires unit tests for "runtime process identity" and negatives for
  "stale PID" / "orphan child" (lines 7, 31). With WMI + `/health` + `taskkill` baked directly into the
  reaper, these tests can only be (a) non-deterministic real-process-tree spawns on a Windows runner, or
  (b) hollow. A reused PID mis-kill guard (`0004:84`) cannot be unit-verified without a spy over the
  inspector.
- Required seam: split into a **pure plan/command builder** (unit-testable: given a record + inspector
  result → decide prune/kill/skip and the exact `taskkill` args) and an **effectful executor**
  (integration-tested, Windows-runner-gated). Make the process-inspector injectable.

### MEDIUM-6 — No defined single-instance / start-twice guard mechanism
- Evidence: testing.md negatives require "multiple instances" and "start twice" (line 31); `cmdStart`
  is still a NOT_READY stub (`lifecycle.mjs:108-114`); no ADR names a single-instance lock (Electron
  `requestSingleInstanceLock`, lock file, or a live-verified `.runtime/pids` check).
- Untestable scenario: The "start twice / multiple instances" negatives have no seam to assert against;
  L6-L9 would either skip them or invent a guard ad hoc.
- Required seam: name the single-instance guard (the `.runtime/pids` live-verified record is a natural
  candidate) so the negative is testable.

### MEDIUM-7 — MCP lifecycle / MCP-dead required by testing.md but no boundary seam surfaced
- Evidence: testing.md requires "MCP lifecycle" (integration, line 17) and "MCP dead" (negative, line 30);
  MCP is entirely inside OpenCode (RE2/RE5 are SHOULD, scope §116-125); `design §7:133-146` lists
  deferred ports (Dispatch/Integration/Knowledge/Gateway) but **not MCP** — MCP status is not surfaced
  through the EV or diagnostics boundary.
- Untestable scenario: MCP behavior is hidden inside OpenCode with no Cowork-GHC observation/injection
  point, so an "MCP dead" test has nothing to assert at our boundary → hollow, or needs a live external
  MCP server (non-deterministic).
- Required seam / disposition: either surface MCP add/remove/enable + failed-extension status through
  the diagnostics/EV boundary (RE5), or L4 explicitly scopes MCP tests as OpenCode-internal / out of the
  POC test surface so they are not left as a hollow requirement.

### LOW-8 — "Port taken" negative largely designed out; risks a hollow test
- Evidence: `0003:59-64` binds `port: 0` (OS-assigned) for the service; no fixed port elsewhere.
- Scenario: testing.md lists "port taken" (line 28) but dynamic allocation makes a genuine EADDRINUSE
  hard to force. Not a defect — but L4 should **document "port-taken = N/A for the service (dynamic
  loopback allocation)"** so L6-L9 don't fabricate a passing test that exercises nothing.

### LOW-9 — Corrupt cleanup-manifest error mapping unconfirmed
- Evidence: `lifecycle.mjs:71-75` `loadManifest` does a raw `JSON.parse` that throws; testing.md requires
  a "corrupt cleanup manifest" negative (line 34). `assessCleanTarget`/`resolveCleanTargets` themselves
  are pure and well-seamed (credited).
- Scenario: a corrupt manifest currently throws an uncaught error; confirm it maps to an **honest
  non-zero exit** (not swallowed / misread as "nothing to clean"). Testable once the mapping is defined.

## Checked and found testable / clean (evidence)

- **Standalone service = headless test surface (advantage — lock it in).** `0003:44-49`, `design §3:78`:
  UI/shell/tests are equal loopback HTTP clients; boundary tests run under Node `--test` with no GUI.
  This is a real, freeze-worthy testability win over the reference's embedded model (`runtime.mjs:1203`).
- **P7 loopback test is choice-independent and concrete.** `0003:70-74`: connect from non-loopback →
  refused; inspect sockets → loopback-only. Directly satisfies P7 acceptance (scope:222-226).
- **Single `ProviderPort` seam for the contract suite.** `0005:36-46`, `0005:97-98`: all 9 contract
  behaviors map to port methods (`testConnection`, `streamChat`, `cancel`, `mapError`,
  `redactionPatterns`); PR7 taxonomy is centralized at ONE boundary (`0005:60-74`), reused across all 5
  providers. Testable in principle — subject to HIGH-1 (fixtures) and HIGH-2 (mock driver).
- **Deny-blocks-on-disk observation point exists.** `design §5:105-118` + scope P3 (215-218): service
  holds the pending action, never forwards on Deny; test asserts file unchanged on disk (F6) + audit
  event; direct-service bypass also blocked. Observation is real (disk + audit) — the remaining gap is
  the deterministic *driver* to reach the pending state (see HIGH-2).
- **Fake credential-store adapter for CI + gated real-store integration test.** `0006:58` — a clean,
  deterministic hook for the negative-on-disk / frontend-snapshot tests (positive path gap = MEDIUM-4).
- **Persistence / restart-resume is deterministic.** `0001:50-58` OpenCode data dir overridable via
  `OPENCODE_DB`/`XDG_DATA_HOME` — a temp data dir makes session-content + restart/resume integration
  tests (testing.md:16) deterministic and isolated.
- **Cleanup-manifest allowlist is the strongest-tested area.** `lifecycle.mjs:15-48` pure
  `normRel`/`assessCleanTarget`/`resolveCleanTargets` (root/traversal/overlap refusal);
  `cmdClean` refuses while running (`:126`); `scripts/cleanup-manifest.json` present. Path-allowlist +
  clean-of-non-allowlisted + clean-while-running negatives (testing.md:33-34) are directly testable.
- **stop-before-start is honest today.** `lifecycle.mjs:116-121`: "nothing to stop" → exit 0.

## Top 3 test seams the freeze MUST guarantee (hand to L5)

1. **Captured-real-frame fake-runtime fixtures + re-capture gate** (resolves HIGH-1): a stub runtime
   fed recorded real OpenCode SSE error/event/stream frames per provider, with fixture re-capture wired
   into the ADR 0001 pin/upgrade gate. Enables non-hollow provider-contract, `mapError`, and EV-reducer
   tests.
2. **Loopback mock-provider driver via the custom OpenAI-compatible endpoint** (resolves HIGH-2): an
   explicit, config-gated test-mode allowlist escape to the SSRF policy so a provider can be pointed at
   `127.0.0.1`. Single deterministic, no-live-key driver for provider streaming/cancel/429/timeout AND
   the permission round-trip (scripted tool call → Deny → assert disk).
3. **Test-readable service handshake + injectable process/spawn inspector** (resolves MEDIUM-3/4/5):
   documented ready signal + port + client-token discovery so headless clients authenticate; plus an
   injectable process-inspector and spawn-env observation hook so lifecycle identity/stale-PID and
   credential inject-at-launch are asserted deterministically (real effect, both positive and negative).

## Single biggest testability risk if frozen as-is

The three highest-priority areas in testing.md — **providers, permission, and execution visibility** —
would be validated **only against invented frames on a fake runtime** (no captured-real-shape gate,
HIGH-1) while the **one deterministic real-behavior driver** (a loopback mock reached through the custom
OpenAI-compatible endpoint) is **forbidden by the proposed SSRF loopback ban** (HIGH-2). The net result:
these areas ship with **green-but-hollow** tests and no non-live path to real behavior — precisely the
outcome testing.md:37-39 exists to prevent. Both fixes are additive seams; freezing without recording
them as L5 conditions is the risk.
