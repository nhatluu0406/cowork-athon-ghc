# Security Review — L1 Scope & Acceptance

Review target: L1-REV-SEC (docs/product/cowork-ghc-scope-and-acceptance.md)
Reviewer role: security-reviewer (independent; did not author the document)
Scope: security-requirements lens on an L1 requirements/acceptance doc (no code exists yet)
Verdict: PASS_WITH_FINDINGS

## Summary of what was checked
- Secret redaction requirement (logs / errors / frontend state / DOM / screenshots / diagnostics): PRESENT and testable — PR8, SD3, EV6, PR7.
- Single OS-backed credential store + no keys in browser local storage + L3 ADR gap flag: PRESENT and testable — PR9, Open decision §7.1. Not deferred away; requirement fixed now.
- Permission enforced at execution boundary, Deny blocks server-side, direct-service bypass blocked: PRESENT and testable — P1, P3 (load-bearing), P5 audit.
- Workspace boundary / path traversal (.. / absolute / UNC / symlink): PRESENT and testable — W4, F4.
- Loopback-only network exposure: STATED as invariant/out-of-scope but NOT a testable acceptance criterion (see [HIGH-1]).
- clean.bat protected-path safety: PRESENT and testable — LC4; cross-checked against scripts/cleanup-manifest.json (preserve list + empty user-data/credential categories confirmed).

## Findings

- [HIGH] Loopback-only binding is asserted as an invariant but has no testable acceptance criterion / gating capability ID
  file: docs/product/cowork-ghc-scope-and-acceptance.md:157 (OOS2), :163 (§4 intro parenthetical), :354, :376-377
  detail: The doc states "the local service is loopback-only per invariant" (OOS2) and describes the service as "loopback only" in the §4 preamble, and defers "loopback binding" to L3 (§7). But unlike every other security invariant in this doc (secrets PR8, credential store PR9, Deny P3, traversal F4), loopback binding has NO capability row in the §3 matrix and NO numbered, observable acceptance criterion in §4/§5. Nothing gates a regression. This is the one CLAUDE.md security invariant left as prose only.
  failure_scenario: An implementer binds the local application service to 0.0.0.0 (or a LAN interface) "for convenience" during dev and it ships. The entire permission/approval and file-mutation API (P1-P5, F1-F6) is then reachable from other hosts on the network with no test failing, effectively exposing the execution boundary remotely — a permission-bypass vector. Because remote-access is OOS2, no test ever asserts the bound socket is 127.0.0.1/::1.
  recommendation: Add a testable MUST (e.g. new capability N1 / criterion) such as: "The local application service binds only to a loopback address (127.0.0.1/::1). A test asserts the listening socket is not reachable from a non-loopback interface. Any non-loopback binding requires an explicit L3 ADR." Keep OOS2 as-is; this just makes the invariant gating.

- [MEDIUM] No explicit, testable approval requirement for agent command/shell execution (only file write is exercised)
  file: docs/product/cowork-ghc-scope-and-acceptance.md:210-217 (P1-P3), :72 (EV3)
  detail: The agent/tool runtime can run shell/command tools (EV3 "show tool calls"). Permission is covered generically by P1 ("every request originates from the execution boundary") and P3, but P3's concrete acceptance test targets a file write only. Command execution is the highest-blast-radius tool (e.g. an agent tool that runs `curl … | sh` or deletes files outside the workspace) and the security rule requires it to be "constrained and reviewed."
  failure_scenario: A runtime command tool executes without traversing the same approval path as file writes; a Deny (or timeout fail-closed, P6) is honored for file writes but a shell command still runs, mutating state the workspace/traversal guards (F4) never see. No acceptance criterion would catch this.
  recommendation: Add an explicit MUST (or extend P3) that command/shell tool execution by the agent goes through the same server-side approval boundary and that a Deny blocks the command from running; add a test asserting a denied command produces no side effect.

- [MEDIUM] No requirement to verify integrity/authenticity of downloaded runtime/dependency executables
  file: docs/product/cowork-ghc-scope-and-acceptance.md:124 (RE6 pinned runtime), :330 (downloaded-library category), :318 (LC1 init)
  detail: The doc requires reuse of an external pinned agent runtime (RE6, OpenCode v-pinned in reference) and init.bat downloads dependencies into `.tools`/`.cache` (cleanup manifest "downloaded-library"). The security rule states "no unverified downloaded executables," but no acceptance criterion requires checksum/signature verification of the downloaded runtime binary or install-time integrity checks. Running an unverified downloaded binary is arbitrary code execution.
  failure_scenario: The pinned runtime is fetched over the network; a compromised mirror or MITM serves a tampered binary; init/start runs it with the user's provider keys and workspace access. Nothing in acceptance would have required verification.
  recommendation: Add a MUST that any downloaded runtime/dependency executable is integrity-verified (pinned checksum or signature) before execution, mechanism to be chosen by an L3 ADR (requirement fixed now, like PR9).

- [LOW] "Redact before any log write" ordering is implied by outcome tests but not stated as a criterion
  file: docs/product/cowork-ghc-scope-and-acceptance.md:257-259 (PR8), :291-292 (SD3)
  detail: PR8/SD3 assert the observable outcome (a known secret never appears in any log/sink), which is the important, testable property. The security rule's stronger phrasing "redact before any log write" (no transient window where a secret is written then scrubbed) is not an explicit acceptance criterion. The outcome test largely covers this, so severity is LOW.
  recommendation: Optional: note that redaction must occur before the value reaches any sink/transport (not scrub-after-write), so async log shippers or crash dumps cannot capture a pre-scrub value.

## Positive confirmations (no finding)
- PR9 (credential store) is present as a fixed MUST with an L3 ADR flag (§7.1) — the OpenWork research gap ("OpenWork does NOT own a single credential store; keys sit in OpenCode auth") is explicitly captured. Not a CRITICAL: requirement is present, only the mechanism is deferred.
- PR8 makes secret redaction testable across logs/errors/frontend/DOM/screenshots/diagnostics — meets the "at least HIGH if secret could leak" bar by closing it.
- P3 is load-bearing and explicitly requires the direct-service (UI-bypass) path to also be blocked, with an on-disk assertion.
- F4 covers .., absolute-escape, UNC, and symlink traversal with a "no file outside workspace touched" assertion.
- LC4 + cleanup-manifest.json: preserve list covers .git, docs, .agent-workflow, .claude, .agents, CLAUDE.md, AGENTS.md, tools, scripts, .loop-engineer/state|checkpoints|evidence|reports|source; user-data and credential categories are empty and documented as never cleaned; cleanable_categories limited to generated/downloaded-library/runtime-temporary; refuses on uncertain root, traversal, or app-running (exit 4).

## Note on HIGH and DONE
Per review-output contract, the [HIGH] loopback finding blocks L1 DONE unless an explicit decision is recorded. Recommended resolution is small (add one testable MUST); the rest of the security-requirements surface is strong.
