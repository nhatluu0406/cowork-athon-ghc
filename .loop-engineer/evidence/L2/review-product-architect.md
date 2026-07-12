# L2 Discovery — Independent Review (product-architect)

- Reviewer role: product-architect, acting as INDEPENDENT REVIEWER (did NOT author any L2 artifact).
- Review target: Loop L2 (Discovery) — the discovery report + DR1/DR2/DR3 evidence.
- Method: read all four artifacts; opened 9 load-bearing reference citations in
  `.loop-engineer/source/openwork/` @ `1897f9f` to confirm claims are real and not overstated;
  cross-checked against L1 open decisions (§7) and `.agent-workflow/loops.yaml` L2 goal.
- Scope reminder honored: I did NOT modify any reviewed artifact and did NOT make any L3 decision.

## Verdict: PASS_WITH_FINDINGS

Findings by severity: HIGH 0 · MEDIUM 1 · LOW 2.

All four L3 decisions are decision-ready (Q1 passes with zero HIGH). Grounding is strong: every
load-bearing citation I opened checked out exactly (Q2). No file crosses from discovery into
deciding (Q5 clean). One MEDIUM coverage gap (license sweep) and two LOW issues (a mildly
overstated coupling edge; one thinly-covered sub-question) are recorded below. None blocks the L2
gate; all are cheap for L3 to close.

---

## Q1 — Decision-readiness (per ADR). Result: all four READY, no HIGH.

**DR1 Runtime reuse-vs-build (RE6): READY.** Options A/B/C, a scored comparison
(runtime-candidates.md §4), advisory lean, and open questions (§6) are all present. The reuse case
is grounded in verified code (loopback spawn, PID/port capture, SIGTERM→SIGKILL stop,
boundary-enforced permission reply). L3 can write the ADR without re-investigating. The only
residual is the credential-ownership seam, which is *correctly* handed to DR3 as coupling, not a
research hole.

**DR2 Desktop shell: READY.** Electron/Tauri/other trade table
(desktop-shell-and-lifecycle.md §2) with per-criterion evidence and a weak/reversible lean. The one
unknown — *why* the reference migrated Tauri→Electron — is explicitly flagged as unconfirmed and
explicitly de-weighted ("do not assume it applies"). Decision does not depend on resolving it.

**DR3a Provider abstraction shape: READY (contingent).** Two contract sketches, five-API
comparison, and the D4 seam are all present. The contingency on DR1 (thin port vs full adapter) is
legitimate design coupling, not a missing investigation — once DR1 lands, the shape falls out.

**DR3b Credential store (PR9): READY.** Six options scored (provider-and-credentials.md Part C),
lean to `@napi-rs/keyring`, and the PR9 gap confirmed in code. Because the lean is shell-neutral,
this ADR can be written before DR2 — so it is decision-ready today.

No decision forces a "go re-research" — no HIGH finding on decision-readiness.

## Q2 — Grounding spot-check. Result: 9/9 citations verified EXACT.

I personally opened the source files and confirmed each claim (not taken on faith):

1. `constants.json:2` — `"opencodeVersion": "v1.17.11"`. EXACT.
2. `apps/server/src/managed-opencode.ts:67` — `hostname ?? "127.0.0.1"` (loopback default); spawn of
   `["serve","--hostname",...,"--cors","*"]` at `:91`; SIGTERM→1s→SIGKILL at `:140-157`;
   `SECRET_ENV_PATTERN` at `:27`. All EXACT.
3. `apps/server/src/config.ts:48` — `const DEFAULT_HOST = "127.0.0.1"`. EXACT.
4. `apps/server/src/env-file.ts:144-145` — verbatim comment "chmod is a no-op on Windows; values may
   still contain secrets" (present at BOTH `:144` and `:159`, as the evidence cited). EXACT — the
   Windows-plaintext claim is real, not overstated.
5. `apps/app/.../provider-auth/store.ts:1316` — `await c.auth.set({ providerID, auth: { type:"api",
   key: trimmed } })`. EXACT — the "keys go to OpenCode's own auth store" claim is real.
6. `apps/desktop/electron/runtime.mjs:1072` — `spawnSync("ps", ["-Ao","pid=,command="], ...)`, an
   orphan sweep that is Unix-only; embedded server via `startEmbeddedServer` at `:1203`;
   `spawn(..., { windowsHide: true })` at `:1018-1023`. All EXACT — the load-bearing HIGH Windows
   supervision gap is genuine.
7. `apps/desktop/electron-builder.yml:1-3` — verbatim "In-place migration from Tauri to Electron
   depends on this"; `:37-39` "during the migration window". EXACT — "completed Tauri→Electron
   migration" framing is faithful to the source.
8. `apps/server/src/server.ts:634` — `assertOpencodeProxyAllowed(...)` throws 403 for viewer scope on
   non-GET/HEAD and specifically guards `/permission/:id/reply`. EXACT — boundary enforcement claim
   is real. (Minor: the code has a redundant second guard block; the *evidence claim* is still true.)
9. `apps/app/.../kernel/model-config.ts:148-165` — `readStoredDefaultModel`/`writeStoredDefaultModel`
   use `window.localStorage` under `MODEL_PREF_KEY`. EXACT — the "model refs in localStorage; keys
   must NOT join them" note is grounded.

No citation failed to check out. Evidence quality is high enough to trust for L3.

## Q3 — Coverage vs L2 goal. Result: one MEDIUM gap (license), otherwise adequate.

The goal ("Investigate this repo, OpenWork, OpenCode/runtime candidates, providers, desktop stack,
Windows/process/license") is well covered for repo scaffold (desktop-shell-and-lifecycle.md §4 maps
`lifecycle.mjs` `RUNTIME_DIRS`/`parsePidFile`/`cmdStart` exit-3 honestly), OpenWork, runtime,
providers, desktop stack, and Windows/process. The one under-covered strand is **license posture
across the dependency surface** — see MEDIUM-1.

## Q4 — Coupling / sequencing claim. Result: substantially correct; one edge overstated (LOW-1).

- DR3a→DR1 and DR3b→DR1 couplings are real and correctly reasoned.
- DR3b→DR2 coupling is real but *escapable*, and the report says so ("or write the credential ADR
  shell-neutral"). Not overstated.
- **DR1→DR2 (the §2 diagram arrow) is the weak link** — see LOW-1. Runtime and shell are largely
  orthogonal (both shells supervise a runtime child identically per the verified spawn code), and
  the report's own prose actually recommends deciding DR1 and DR2 *in parallel* ("decide DR1 and
  DR2 first"), not DR1-strictly-before-DR2. The diagram is slightly stronger than the prose.

## Q5 — Overreach (discovery vs deciding). Result: CLEAN — no finding.

I checked every "lean"/table/TL;DR for language that decides rather than advises. All are under
explicit "advisory / NOT a decision" headers, all comparison tables state "NOT a decision," and the
strongest wording (DR3 Part E "`@napi-rs/keyring` is the strongest default") sits under an
"Advisory leans (NOT decisions)" header. The HIGH Windows-supervision item is correctly framed as a
carried-forward risk for L3→L5, not a decision. No file crosses into deciding.

---

## Findings

### MEDIUM-1 — License coverage is spot-checked, not swept, despite "license" being an explicit L2 goal
- Where: `runtime-candidates.md:94` (table row "License | H — MIT [gh]"), `discovery-report.md:61`;
  `provider-and-credentials.md:189-190` (keyring MIT, node-keytar MIT-archived).
- Detail: License is called out by name in the L2 goal (`loops.yaml:55`) and by the coding rule
  ("Check license and maintenance"). The evidence establishes MIT for the OpenCode binary (via
  GitHub) and for the credential-store candidates, which is enough for the *core* reuse question.
  But the broader redistributable dependency surface a reuse-OpenCode + Electron build pulls in is
  not license-verified: `@opencode-ai/sdk` (`apps/server/package.json:49`), `better-sqlite3`,
  `node-pty`, `electron`, `electron-updater`, `electron-builder`. Separately, the reference's own
  `LICENSE` is not pure MIT — it carves out `/ee` under a **Fair Source License** and third-party
  components under their own terms. That `/ee` carve-out is NOT a Cowork GHC dependency (OpenWork is
  research-reference-only, never forked), so it does not block anything — but its absence from the
  evidence shows the license strand was sampled, not swept.
- Failure scenario: L3 writes the reuse ADR asserting a clean permissive posture, then L5/L6
  packaging discovers a copyleft or attribution-required transitive dep (or an OpenCode
  redistribution nuance) that forces rework of the bundle/attribution story late.
- Recommendation: L3 records a one-paragraph dependency-license note in the runtime and shell ADRs
  (SDK + the handful of native deps + Electron), and explicitly states the OpenWork `/ee` Fair
  Source carve-out is out of scope because OpenWork is never forked. Cheap; closes the goal strand.

### LOW-1 — The DR1→DR2 sequencing edge in the §2 diagram is stronger than the evidence supports
- Where: `discovery-report.md:35-46` (dependency diagram, "DR1 Runtime … ▼ DR2 Shell").
- Detail: The diagram implies shell choice depends on runtime choice. The verified spawn/supervision
  code shows both shells host a runtime child the same way; DR2's own trade (stack fit, footprint,
  security) is independent of which runtime DR1 picks. The report's prose (`:48`) already recommends
  deciding DR1 and DR2 *together*, so the strict arrow is an internal inconsistency, not a
  substantive error.
- Failure scenario: L3 needlessly serializes DR2 behind DR1, delaying the shell ADR that could be
  drafted in parallel.
- Recommendation: L3 treats DR1 and DR2 as parallel (as the prose already says); no re-research
  needed. Optionally soften the diagram arrow to "decided together."

### LOW-2 — Persistence / session-store sub-decision is the thinnest-covered coupled question
- Where: `runtime-candidates.md:58-60` (§1.6); L1 flags it at
  `docs/product/cowork-ghc-scope-and-acceptance.md:382-384`.
- Detail: L1 §7 lists "persistence/session-store choice" as a downstream sub-decision. L2 covers
  transport and lifecycle as their own option sets, but persistence is handled only as a note that
  OpenCode owns its SQLite store — no option framing (adopt-OpenCode-store vs Cowork-owned
  session-index vs both). This is acceptable because it is contingent on DR1, but it is materially
  thinner than transport/lifecycle.
- Failure scenario: L3 reaches the "one source of truth per state type" invariant for session
  content and has to reason from scratch about whether the OpenCode SQLite store counts as the
  single source or needs a Cowork-owned index.
- Recommendation: L3 addresses persistence explicitly inside the runtime ADR (the §1.6 nuance is
  enough seed material); no new L2 discovery required.

---

## Areas checked where I found nothing wrong (stated explicitly)
- Decision-readiness of all four ADRs: no HIGH; each has options + cited evidence + comparison +
  open questions + advisory lean.
- Grounding: 9/9 opened citations exact; the two load-bearing "gap" claims (Windows orphan sweep is
  Unix-only; provider keys land in OpenCode's own store / plaintext env.json on Windows) are both
  confirmed in real code, not overstated.
- Overreach: no artifact decides; leans are consistently and correctly labelled advisory.
- Loopback/P7 grounding: `config.ts:48` and `managed-opencode.ts:67` both confirm `127.0.0.1`
  default — the P7 story is real.
- Coupling: the runtime-drives-provider-shape and runtime-drives-credential-seam couplings are
  correct (only the DR1→DR2 edge is soft, LOW-1).

## Suggested next step
Proceed to the L2 gate. The three findings are advisory-for-L3, not blockers: none requires
re-opening L2 discovery. L3 should (a) add a short dependency-license note to the runtime + shell
ADRs (MEDIUM-1), (b) treat DR1/DR2 as parallel (LOW-1), and (c) fold the persistence sub-decision
into the runtime ADR (LOW-2).
