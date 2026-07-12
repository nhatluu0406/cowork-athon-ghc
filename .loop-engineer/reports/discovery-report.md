# Cowork GHC — Discovery Report (Loop L2)

> Status: L2 Discovery. This report **de-risks** the four open L3 decisions and the
> lifecycle/transport questions that hang off them. It lays out **options with evidence**;
> it does **not** decide anything. Every ADR is written in L3. L2 investigates; L3 chooses.
>
> Source evidence (read-only research, all cited to reference `file:line` + symbol or public URL):
> - Runtime: [runtime-candidates.md](../evidence/L2/runtime-candidates.md) (L2-DR1)
> - Desktop shell + transport + lifecycle: [desktop-shell-and-lifecycle.md](../evidence/L2/desktop-shell-and-lifecycle.md) (L2-DR2)
> - Providers + credential store: [provider-and-credentials.md](../evidence/L2/provider-and-credentials.md) (L2-DR3)
>
> Reference tree investigated: `.loop-engineer/source/openwork/` @ `1897f9f` (never modified, never a build dependency).
> Inputs: [cowork-ghc-scope-and-acceptance.md](../../docs/product/cowork-ghc-scope-and-acceptance.md) (L1), [openwork-research.md](../evidence/L1/openwork-research.md) (L1).

## 1. What L2 set out to answer

The L1 baseline closed the *requirements* question and handed L3 four open **decisions** plus
several coupled sub-questions. L2's job was to gather enough grounded evidence that L3 can write
each ADR **without re-investigating**. The four decisions:

1. **Runtime reuse vs build** (requirement RE6) — reuse OpenCode, reuse another runtime, or build one.
2. **Desktop shell** — Electron vs Tauri (vs other) for the Windows 11 native shell.
3. **Provider abstraction shape** (PR1/PR10, room for D4) — the provider-neutral port/adapter contract.
4. **Credential store mechanism** (PR9) — the single OS-backed store for provider keys on Windows.

Coupled sub-questions surfaced by L1 and confirmed here: local-service **transport** (loopback, P7),
**service placement** (embedded-in-shell vs standalone), and **Windows process lifecycle** (single-owner
supervision, `.runtime/` PID/port, graceful stop — LC3).

## 2. Headline finding — the four decisions are coupled, and there is a decision order

The single most important discovery result is that **these are not four independent ADRs**. They form
a dependency chain L3 should sequence:

```
  DR1 Runtime ──┐ (reuse OpenCode vs build)
                │   → whether provider adapters already exist  (⇒ provider port shape, DR3a)
                │   → whether keys must reach a runtime store   (⇒ credential seam, DR3b)
  DR2 Shell ────┤ (Electron vs Tauri)
                │   → service placement + transport (P7) + who supervises processes
                │   → gates shell-bound credential options (safeStorage=Electron; Stronghold/keyring=Tauri)
                ▼
  DR3a Provider abstraction shape   ← depends on DR1
  DR3b Credential store mechanism   ← depends on DR1 (seam) + DR2 (shell-bound options)
```

**DR1 and DR2 are largely orthogonal to each other** (both shells supervise a runtime child through the
same Node `spawn` pattern — verified in review), so they can be decided **in parallel**; the real coupling
is that both feed the two DR3 decisions. **Recommended L3 sequencing (advisory):** settle DR1 (runtime)
and DR2 (shell) — in either order or together — before finalizing DR3a (provider shape) and DR3b
(credential mechanism); or write the credential ADR **shell-neutral** (the leaned `@napi-rs/keyring` is
shell-independent, so DR3b can even precede DR2). Each researcher independently reached this coupling
conclusion.

## 3. Decision-ready summaries (options + advisory leans — NOT decisions)

### 3.1 Runtime reuse vs build (RE6) — evidence: DR1

- **Candidate A — reuse OpenCode** (the sst/anomalyco TypeScript OpenCode, `opencode serve` HTTP+SSE,
  `@opencode-ai/sdk`, pinned `v1.17.11` at `constants.json:2`). Provably satisfies the S/EV/P/F
  requirement families: sessions + message store (its own SQLite via `better-sqlite3`), streaming
  events + tool-permission over `/event` SSE and `/permission/:id/reply`, boundary-enforceable reply
  auth (`server.ts:634-654`), a proven supervise-and-proxy pattern (`managed-opencode.ts:58-159`,
  `runtime.mjs:559`). **MIT**, native Windows x64/arm64 binary + Scoop/Choco/npm SDK, 184k★/835 releases.
- **Candidate B — build new.** Multi-engineer/multi-month effort duplicating a mature upstream; inherits
  ALL provider/LLM tool-loop plumbing; directly contradicts RE6. Justified only if a hard blocker in
  reuse appears (license change, unfixable Windows supervision, unseamable credential conflict).
- **Candidate C — other runtimes** (Go OpenCode TUI; provider-coupled agent SDKs; Aider/Continue/Cline).
  Each weaker on a stable embeddable local HTTP+SSE session/permission service; one-line L3 mention only.
- **Advisory lean:** reuse OpenCode as a pinned, single-owner child process supervised under `.runtime/`.
  **Residual risks L3 must weigh:** (a) Windows orphan-reap is Unix-only — see §4; (b) provider keys live
  in OpenCode's own auth store — see §3.4; (c) fast-moving upstream needs a pin + upgrade-test policy.

### 3.2 Desktop shell — Electron vs Tauri (vs other) — evidence: DR2

- **Reference reality (data point, not a mandate):** the "stale Tauri README" from L1 is actually a
  **completed Tauri→Electron migration** — `electron-builder.yml:1-3,37-39` keeps old Tauri appId/feed
  aliases "during the migration window." So the closest comparable product shipped both and **chose
  Electron**; drivers are undocumented in-tree (plausibly the Node-native deps `node-pty`,
  `better-sqlite3`). Do not over-weight one team's choice.
- **Trade, reframed for a Windows-11-only target:** Tauri's classic downsides largely vanish (WebView2 is
  preinstalled on Win11; single-WebView means no cross-platform inconsistency). The real trade becomes:
  - **Electron** wins on Node/TS stack homogeneity, testability with the existing Node `--test` harness,
    ecosystem maturity, and battle-tested `electron-updater` + NSIS.
  - **Tauri** wins decisively on bundle size / idle RAM / cold start and default-deny security posture,
    at the cost of a **Rust** native layer + toolchain and a documented sidecar orphan-cleanup problem.
- **No MUST forces the choice** — W1, S6, P7, SD2, SD7, LC1–LC5 are all satisfiable by either.
- **Advisory lean:** **weak, reversible** lean to Electron (stack fit + testability + proven update/packaging,
  and it matches the reference's post-Tauri landing). Tauri is legitimate and stronger if footprint/security
  are first-order POC goals.

### 3.3 Provider abstraction shape (PR1/PR10, room for D4) — evidence: DR3

- **Five-target API reality:** all of Anthropic / OpenAI / Google Gemini / OpenRouter / OpenAI-compatible
  are HTTPS + header-key auth, all stream via SSE, all cancel by aborting the HTTP stream, all signal rate
  limits with HTTP 429. Differences the port must absorb: auth header name, model naming (OpenRouter needs
  a `vendor/` prefix), streaming endpoint/param quirks (Gemini `streamGenerateContent`), and per-provider
  error bodies behind the shared status codes.
- **Critical constraint:** if DR1 reuses a runtime, that runtime **already owns** the provider adapters
  (auth/stream/cancel/model calls). Re-implementing HTTP clients would violate the "no duplicate provider
  logic" coding rule.
- **Two candidate shapes:** (1) a **thin Provider Management Port** — config + credential-ref orchestration,
  the runtime does the wire calls (lean if DR1 reuses OpenCode); (2) **full Provider Adapters** owning the
  HTTP/SSE per provider (only if DR1 builds/owns the client). Both keep `CredentialRef` a handle and
  `ModelRef` logical, so **D4 (future gateway)** slots in as another `ProviderPort` implementation + routing
  table — a seam, not a core reshape.
- **Advisory lean:** Sketch 1 (thin management port), contingent on DR1 reusing a runtime with built-in
  adapters. Enforce PR7's error taxonomy at the execution boundary, not just in UI formatting.

### 3.4 Credential store mechanism (PR9) — evidence: DR3

- **PR9 gap CONFIRMED in code:** the reference stores provider keys in two places, **neither Windows-secure**:
  OpenCode's own `auth.json` (via SDK `c.auth.set`, `store.ts:1316`) and a plaintext
  `%APPDATA%/openwork/env.json` whose `chmod 0o600` is a code-acknowledged **no-op on Windows**
  (`env-file.ts:144-145`). The diagnostics scrubber only redacts session/host tokens, not provider keys.
  So PR9 ("one OS-backed store; state holds only a reference; no keys in browser local storage") is a
  **genuine additive layer**, not a port of existing behaviour.
- **Options (6, scored in DR3):** Electron `safeStorage` (DPAPI; Electron-only; zero extra native dep);
  **`@napi-rs/keyring`** (real Windows Credential Manager, shell-neutral Node, maintained, MIT,
  keytar-compatible); `node-keytar` (**archived — avoid**); direct WinCred/DPAPI shim (highest custom cost);
  Tauri Stronghold (self-managed vault + master-password UX; Tauri-only); Tauri keyring plugin (Tauri-only).
- **Cross-cutting invariant:** "one credential store" means the chosen store must also feed the runtime —
  or the app injects the resolved key into the runtime at spawn/call time — so there is **no second parallel
  store** (the reference's `auth.json` + `env.json` split is exactly the anti-pattern to avoid).
- **Advisory lean:** `@napi-rs/keyring` if the product stays shell-neutral or wants the most literal PR9
  fit; Electron `safeStorage` a clean second **if** DR2 picks Electron. Avoid `node-keytar`.

### 3.5 Coupled sub-decisions (transport / placement / lifecycle) — evidence: DR2

- **Transport (P7):** HTTP + SSE is the reference-proven, loopback-bindable, testable baseline; WebSocket
  adds bidirectional control (useful for S3 cancel); Electron-IPC-only removes the socket entirely (strongest
  P7 story) but couples the service to the shell and complicates headless testing. P7 is enforceable and
  testable in every option (bind `127.0.0.1`/`::1`, never `0.0.0.0`; test = connect from a non-loopback
  interface and assert refusal).
- **Service placement:** the reference **embeds the server in the Electron main process** and spawns only
  the OpenCode/orchestrator sidecars as children (`runtime.mjs:1203`). Embedded = strongest P7, shell-coupled;
  standalone = cleaner boundary + easier headless test, one more supervised process. Decides transport +
  lifecycle ownership together.

### 3.6 License posture (the L2 goal's "license" strand) — evidence: reference `LICENSE`/`package.json`

Verified against the reference tree @ `1897f9f`:

- **OpenWork reference itself:** root `LICENSE` is **MIT** for everything *except* `/ee`, which is a
  **Fair Source License** (`ee/LICENSE`). This confirms `/ee` (OOS1) is a genuine **license boundary** —
  but it is irrelevant to Cowork GHC as a *dependency*, because Cowork GHC never forks OpenWork and OOS1 is
  out of scope. It matters only as a warning: do not copy `/ee` code.
- **Redistributable runtime/shell dependencies** (names+versions confirmed in `apps/desktop/package.json`,
  `apps/server/package.json`): `@opencode-ai/sdk ^1.17.11` and OpenCode itself (**MIT**, per DR1),
  `electron ^35`, `electron-updater ^6.3.9`, `electron-builder ^25` (all MIT), `better-sqlite3 ^11.10`
  (MIT), `node-pty` via `npm:@lydell/node-pty@1.2.0-beta.12` (MIT). Credential-store candidate
  `@napi-rs/keyring` is MIT (DR3). All are **permissive (MIT / BSD-family)** — no copyleft or source-available
  surprise in the likely dependency set.
- **Not yet done (carry-forward, not blocking):** a *formal, automated* license scan of the full transitive
  tree (e.g. `license-checker`/SPDX) cannot run until Cowork GHC has its own `package.json` (none exists yet).
  L5 should add a license-scan task once the app manifest lands; L3 should note the `/ee` Fair Source boundary
  in the runtime ADR. The strand is now **covered at the direct-dependency level**; only the automated
  transitive sweep is deferred.

## 4. Cross-cutting risk carried forward (shell- and runtime-independent)

**Windows process supervision gap (HIGH).** Surfaced independently by DR1 and DR2. The reference's orphan
sweep uses `spawnSync("ps", …)` (`runtime.mjs:1072`) — **Unix-only**, does not run on Windows — and on
Windows `process.kill(pid,"SIGTERM")` is a hard terminate that does **not** kill descendants. **Regardless of
which runtime and which shell L3 picks**, Cowork GHC must build Windows-safe supervision: an app-level
shutdown request (loopback HTTP) → then `taskkill /PID <pid> /T /F` (process tree) or a Win32 **Job Object**,
plus a durable, identity-verified PID/port record under `.runtime/pids/`. This maps directly to **LC3 / stop.bat**
and must be specified in L3 and built in L5/L6. The existing scaffold (`lifecycle.mjs`) defines the `.runtime/`
layout and `parsePidFile`/`runningPids` but **nothing populates it yet** — L3 must define the writer, the
schema (pid, port, role, startedAt, verifiable identity token), and stale-PID handling.

## 5. Consolidated open questions for L3 (grouped; sourced in the evidence files)

**Runtime (DR1 §6):** the RE6 reuse-vs-build decision itself; credential-ownership seam; embedding mode
(server-in-process vs standalone); Windows supervision design (Job Object vs `taskkill /T` vs PID-file reap);
OpenCode version-pin + upgrade-test policy; how much of OpenCode's SSE schema to treat as our own EV contract
vs re-normalize; typed `@opencode-ai/sdk` vs a thin internal client.

**Shell / transport / lifecycle (DR2 §5):** why the reference migrated Tauri→Electron (unconfirmed — do not
assume it applies); service placement; transport (HTTP+SSE vs +WebSocket vs IPC); if Tauri, accept a Rust
layer + own the sidecar orphan problem; tray + auto-update scope (tray has **no reference precedent**);
the Windows graceful-stop mechanism (LC3).

**Providers / credentials (DR3 Part D):** store-vs-runtime ownership (couples to DR1); shell dependency of
credential options (couples to DR2 — favours shell-neutral `@napi-rs/keyring` if written before DR2); provider
port shape (couples to DR1); PR7 error-taxonomy location (execution boundary vs UI); OpenAI-compatible provider
identity (fixed DeepSeek vs user-defined endpoint); how a Windows-CI contract test asserts "no key in frontend
state / key in OS store by handle" without a live key (fake store adapter + gated real-store integration test).

## 6. What L2 did NOT do (by design)

- **No decisions.** All ADRs (runtime, shell, provider shape, credential store, transport, lifecycle) are L3.
- **No feature code, no product build/tests, no live LLM/provider calls, no secrets** (placeholders only).
- **No reference-source modification.** All reference reads were read-only @ `1897f9f`.

## 7. Discovery gate readiness

Every one of the four L3 decisions now has: candidate options, evidence cited to `file:line`+symbol or public
URL, a scored comparison, explicit open questions, and an advisory (non-binding) lean. The coupling/ordering
between decisions is mapped (§2). One HIGH cross-cutting risk (Windows supervision, §4) is captured for L3→L5.
L2 is ready for independent review, then the L2 gate.
