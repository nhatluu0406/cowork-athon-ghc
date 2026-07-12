# L4 Independent Design Review — Runtime & LLM-Integration Lens

- **Review target:** `docs/architecture/cowork-ghc-implementation-design.md` + ADRs `0001`, `0003`, `0004`, `0005` (frozen candidates).
- **Reviewer role:** Independent runtime / agent-runtime / LLM-integration design reviewer (did NOT author these docs).
- **Grounding verified against:** `.loop-engineer/reports/discovery-report.md`, `docs/product/cowork-ghc-scope-and-acceptance.md`, and read-only reference `.loop-engineer/source/openwork/` @ `1897f9f`.
- **Task:** L4-REV-RUNTIME.
- **Verdict:** **CHANGES_REQUIRED** (2 HIGH must be resolved or explicitly de-risked before freeze; the design is sound in shape and the two HIGHs are localized, not structural).

## Grounding spot-check (are the ADRs faithful to the reference?)

All load-bearing runtime facts cited in the ADRs were confirmed accurate:

| Claim | Cited loc | Verified |
|---|---|---|
| OpenCode pin `v1.17.11` | `constants.json:2` | ✔ exact |
| `opencode serve` HTTP+SSE, Basic-auth via env user/pass, spawned with arg array | `managed-opencode.ts:71-95` | ✔ (`serve --hostname --port --cors *`, `OPENCODE_SERVER_USERNAME/PASSWORD`) |
| DEFAULT_HOST `127.0.0.1` | `config.ts:48` | ✔ |
| Unix-only orphan sweep (`spawnSync("ps", …)`, then `killProcessId(pid,"SIGTERM")`) | `runtime.mjs:1072` | ✔ — genuinely Unix-only |
| Embedded server in Electron main | `runtime.mjs:1203` `startEmbeddedServer` | ✔ (with EADDRINUSE→OS-port fallback, `:1204-1206`) |
| `findFreePort`/`portAvailable` bind loopback | `runtime.mjs:391-417` | ✔ (`{host,port:0}`) |
| Provider keys written into OpenCode's own auth store | `store.ts:1316` `c.auth.set({…key})` | ✔ — this is the PR9 anti-pattern |
| `env.json` `chmod 0o600` no-op on Windows | `env-file.ts:144-145` | ✔ (comment: "values may still contain secrets") |
| Diagnostics scrubber covers only session/host tokens (+opencodePassword), not provider keys | `diagnostics-bundle.ts:121-130` | ✔ |
| OpenCode SQLite session store, Windows `%APPDATA%/opencode`, overridable `OPENCODE_DB`/`XDG_DATA_HOME` | `opencode-db.ts:6,47-70` | ✔ |

**One citation is imprecise (see L2):** the design (§5) cites `assertOpencodeProxyAllowed` (`server.ts:634-654`) as the reference pattern for P3 "Deny actually blocks." That function is only a *viewer read-only scope gate*; its own comment (`server.ts:642-648`, issue #1918) shows it was deliberately weakened so collaborators *can* reply. It is not a hold-pending-and-block mechanism. The design says "re-implemented, not copied," so this is not fatal — but the enforcement it describes does **not** exist upstream and must be built fresh.

**Confirmed favorable fact for S3:** OpenCode exposes an explicit session-abort (`abortSession(c, id)` SDK call, used at `actions-store.ts:641-646`) — the correct cancel primitive exists.

---

## Findings

### H1 — Credential-injection seam into OpenCode is unverified and conflicts with "never write auth.json" + PR2/PR5 live changes (HIGH)
- **Where:** design §6 (SEC-1, "the service resolves the key … and injects it into the OpenCode child at launch/call time; Cowork GHC never calls `c.auth.set` and never writes … `auth.json`/`env.json`"); ADR 0001 Consequences ("Cowork GHC must never persist provider keys into OpenCode's `auth.json`/`env.json`"); ADR 0005 §Port (`configureCredential` handle-only).
- **Evidence:** The reference's *only* key-delivery path to OpenCode is `c.auth.set(...)` writing OpenCode's auth store (`store.ts:1316`, `:1374`). There is **no env-injection path anywhere in the reference server** (grep for `ANTHROPIC_API_KEY`/`process.env[...]` key injection in `apps/server/src` returns nothing). `managed-opencode.ts:73-78` passes `...process.env` wholesale to the child, but never provider keys. So "inject at launch via env" is a **new, unproven mechanism**, not a reuse.
- **Failure scenario:** (a) OpenCode reads standard-provider keys from env vars for the 4 named vendors — plausible but unverified for the pinned version. (b) The **user-defined 5th provider** (custom OpenAI-compatible, ADR 0005) has *no* predefined env var name in OpenCode; delivering its `base_url`+key almost certainly requires OpenCode config (`opencode.json`) or `auth.json` — i.e. **the forbidden on-disk path** — or is impossible. (c) `configureCredential` is called at runtime, but env is fixed at spawn: adding/rotating a key for a not-yet-configured provider (PR2) or live-switching to it (PR5) then requires **respawning the OpenCode child**, a lifecycle behavior no ADR specifies. If discovered in L6, this reshapes the provider + credential + lifecycle seams together — the classic freeze-time re-architecture trap.
- **Recommendation:** Before freeze, run a bounded spike (no live provider key needed) proving OpenCode `v1.17.11` accepts a provider key + a custom `base_url` provider via a mechanism that is *not* `auth.json`/`env.json` and survives without it. Specify in ADR 0001/0006 the exact injection channel and an explicit "credential change ⇒ controlled runtime relaunch (session content preserved in SQLite)" rule. If the spike fails for the custom provider, this is CRITICAL and forces re-architecting the "never write auth.json" invariant vs the 5th-provider decision.

### H2 — `agent-runtime` identity verification via command-line token is not implementable against the third-party OpenCode binary (HIGH)
- **Where:** ADR 0004 §"Identity verification" — "`identityToken` … passed to the child on its command line (e.g. `--cowork-identity <token>`)"; the cross-check applies to **all** roles including `agent-runtime`, via `Get-CimInstance Win32_Process` asserting `CommandLine` contains the token.
- **Evidence:** OpenCode is spawned as `opencode serve --hostname … --port … --cors *` (`managed-opencode.ts:71`) — a third-party binary. Cowork GHC cannot inject an arbitrary `--cowork-identity` flag into it: most CLI parsers reject unknown flags (the child would fail to start). `Win32_Process` exposes `CommandLine` and `ExecutablePath` but **not** environment variables, so an env-based token is not observable via the stated WMI check. OpenCode also has no Cowork `/health` returning our token (that fallback in the ADR applies only to the Local Service, our own code).
- **Failure scenario:** The identity scheme works for our own Node processes (app-shell, local-service) but has **no working identity primitive for the OpenCode child**. Result: either OpenCode won't launch (flag rejected), or the stale-PID/reused-PID safety guarantee ("never kill by generic name; token cross-check") silently does not hold for the runtime role — the exact process most likely to orphan.
- **Recommendation:** Define a runtime-specific identity: verify the child by recorded `pid` + `exePath` match + parent-PID = our local-service PID + a probe of its Basic-auth `/health` using the recorded `OPENCODE_SERVER_PASSWORD` secret (which we generate per launch, `managed-opencode.ts:69-78`). Alternatively spawn OpenCode under a thin Cowork-owned launcher that carries the token and owns the child in a Job Object. Update ADR 0004 to stop asserting command-line-token identity for `agent-runtime`.

### M1 — OpenCode data directory not mandated to a Cowork-owned path → shared-store collision + ambiguous clean/SD6 (MEDIUM)
- **Where:** ADR 0001 §2 ("on Windows under `%APPDATA%`, overridable via `OPENCODE_DB`/`XDG_DATA_HOME`") — overridable, but **not required**.
- **Evidence:** `opencode-db.ts:47-70` defaults to `%APPDATA%/opencode`. A user who also runs the standalone `opencode` CLI shares that exact SQLite.
- **Failure scenario:** Session bleed between Cowork GHC and a user's own OpenCode; "one source of truth per state type" is violated by an external writer; `clean.bat`/SD6 "delete local application data" cannot safely target a shared dir, and could delete a user's non-Cowork sessions or fail to isolate.
- **Recommendation:** MANDATE `OPENCODE_DB`/`XDG_DATA_HOME` pointed at a Cowork-GHC-owned subdir under app data; add it to the clean/preserve manifest reasoning. Cheap to fix now, expensive to retrofit.

### M2 — PR7 "bounded retries" not actually bounded: OpenCode retries underneath the port (MEDIUM)
- **Where:** ADR 0005 §PR7 ("Retries are bounded (no infinite loop, PR7)") — bounding is placed at `ProviderPort.mapError`/the boundary.
- **Evidence:** The runtime owns the wire calls (ADR 0005 decision; ADR 0001 §"provider wire calls"). Provider SDKs/OpenCode commonly perform their own internal retry/backoff on 429/5xx, beneath the SSE the port observes.
- **Failure scenario:** The port counts "one attempt" while OpenCode silently retries N times upstream → real upstream call count and latency exceed the stated bound; PR7's "no infinite loop / bounded" acceptance is not truthfully enforceable at the boundary.
- **Recommendation:** In the spike, determine OpenCode's internal retry behavior; either disable it via config or account for it in the PR7 bound and document that the bound is "port-observed attempts, upstream may add K."

### M3 — PR7 error-taxonomy mapping from OpenCode is asserted, not shown (MEDIUM)
- **Where:** ADR 0005 §PR7 ("`mapError` is the canonical mapping, enforced at the … boundary"); open item defers detail to L5.
- **Evidence:** The mapping's input is OpenCode's error *representation over SSE/HTTP*, which is not characterized in the ADR or reference. If OpenCode collapses provider errors into generic tool-error events without preserving status code / provider-error kind, the 5-kind taxonomy (auth_invalid/rate_limited/timeout/unavailable/unknown) is not reconstructable at the boundary.
- **Failure scenario:** Cowork GHC is forced into UI-only heuristic classification — precisely what ADR 0005 forbids — or must fabricate error kinds (violates EV6/EV7 honesty).
- **Recommendation:** Verify (spike) that OpenCode surfaces structured provider errors (HTTP status or typed error) over `/event`/proxy before freezing the "enforced at the boundary" claim; if not, add a documented degradation.

### M4 — Two-hop SSE (renderer→service→OpenCode): flush-through and reconnect gap unspecified (MEDIUM)
- **Where:** design §2 diagram (two loopback hops) + ADR 0003 (SSE baseline). The standalone-service decision adds a **second** SSE proxy hop beyond the reference's single embedded hop (`proxyOpencodeRequest`, `server.ts:887`).
- **Evidence/Failure scenario:** (a) Each Node proxy hop must flush per event (disable compression/response buffering) or EV1–EV4 events batch and S2 streaming stalls/janks. (b) OpenCode `/event` is a live bus; on an SSE drop/service restart there is no specified Last-Event-ID replay, so a **permission request or tool event emitted during the gap can be missed** → the session hangs "waiting" forever (mirrors reference #1918 "stuck in running"), silently violating S6/P-flow honesty.
- **Recommendation:** ADR 0003 should state the flush-through requirement and a reconnect/resync strategy (re-fetch session state on reconnect, reconcile pending permissions) as a POC acceptance item, tested under the headless harness.

### M5 — OpenCode child port allocation has a TOCTOU race with no fallback (MEDIUM)
- **Where:** ADR 0003 addresses `port:0` for the *service*, but is silent on the OpenCode child; the reference child uses find-free-then-pass-concrete (`managed-opencode.ts:47-71`) — bind port 0, close, then `serve --port <concrete>`.
- **Evidence/Failure scenario:** Unlike the embedded server's EADDRINUSE→OS-port fallback (`runtime.mjs:1204-1206`), a concrete `--port` handed to `opencode serve` has **no fallback**: if the port is taken in the race window the child exits and the stdout handshake fails. On a busy machine this is an intermittent start failure with no retry path specified.
- **Recommendation:** Specify the child port strategy in ADR 0003/0004: prefer `--port 0` + authoritative stdout-URL parse if OpenCode supports it, else a bounded retry loop around spawn.

### M6 — Session metadata ↔ OpenCode SQLite reconciliation & cross-pin migration unspecified (MEDIUM)
- **Where:** ADR 0001 §2 split (OpenCode owns content; Cowork owns grouping/pin/order keyed by session id); §Open items.
- **Evidence/Failure scenario:** (a) No reconciliation rule when a session vanishes from OpenCode's DB (external delete, reset, corruption) → dangling app metadata, S1/S5 show ghosts. (b) An OpenCode pin bump may migrate its SQLite schema; the ADR 0001 upgrade gate lists SSE/lifecycle/contract tests but **not** a session-restore (S4) test across the pin change → a bump can silently break restore.
- **Recommendation:** Add startup reconciliation (prune app metadata for sessions absent in OpenCode) and add "S4 session-restore across the new pin" to the ADR 0001 upgrade-test gate.

### M7 — Removing the Unix orphan sweep leaves OpenCode's own descendant tool processes unreaped after an unclean crash (MEDIUM)
- **Where:** ADR 0004 replaces the reference orphan sweep "entirely (no `ps`)"; identity/reap covers the 3 recorded roles only.
- **Evidence/Failure scenario:** OpenCode spawns its own tool subprocesses (shell/pty/etc). `taskkill /PID <pid> /T /F` reaps descendants only if the recorded root PID is still alive at kill time. If the local-service crashes and OpenCode itself later dies but left a runaway tool subprocess, that grandchild has **no `.runtime/pids` record and no identity token** → nothing reaps it. The reference's sweep existed precisely for this (`runtime.mjs:1069-1082`); the ADR removes it without a Windows equivalent for the runtime's *own* descendants.
- **Recommendation:** Commit to the **Win32 Job Object with kill-on-close** (currently "preferred where feasible" / open item) rather than `taskkill /T` alone — it is the only robust Windows guarantee against orphaned grandchildren after an unclean crash. Elevate it from optional to required for the OpenCode child.

### M8 — S3 cancel wording risks an SSE-drop-only implementation (MEDIUM)
- **Where:** ADR 0003 §Transport ("Cancel (S3) is a normal HTTP request … the service aborts the runtime stream"); traceability row S3.
- **Evidence:** The correct primitive exists — `abortSession(c, id)` (`actions-store.ts:641-646`, SDK). "Aborts the runtime stream" is ambiguous and could be read as merely aborting the local fetch/SSE.
- **Failure scenario:** If cancel only drops the SSE, OpenCode's tool loop keeps running and can still apply file mutations — directly violating S3 ("no further file mutations from the cancelled task").
- **Recommendation:** ADR 0003 must explicitly bind S3 cancel to OpenCode's session-abort endpoint, and the acceptance test must assert no post-cancel mutation on disk.

### L1 — stdout-parse startup handshake is brittle (LOW)
- **Where:** reference handshake matches the literal line `opencode server listening on <url>` with a 15s timeout (`managed-opencode.ts:113-127`).
- **Failure scenario:** A future pin whose startup log wording changes silently breaks startup detection. Mitigated by the version pin + upgrade gate, hence LOW.
- **Recommendation:** Prefer polling OpenCode's `/health` (Basic-auth) as the readiness signal over stdout string matching; keep stdout parse only as a URL hint.

### L2 — design §5 mischaracterizes `assertOpencodeProxyAllowed` as the Deny-enforcement pattern (LOW)
- **Where:** design §5 cites `server.ts:634-654` as the P3 enforcement reference pattern.
- **Evidence:** That function is a viewer read-only gate that was deliberately weakened for collaborators (#1918, `server.ts:642-654`); it does not hold a pending action or block a Deny. The design does say "re-implemented, not copied."
- **Recommendation:** Reword to state P3 hold-and-block enforcement is net-new Cowork-GHC logic (intercept the proxied `/permission/:id/reply`; on Deny, send OpenCode a deny reply and never forward an allow; assert file unchanged on disk).

---

## Per-focus-area coverage (what I checked; where nothing is wrong)

1. **OpenCode as pinned supervised child on Win11.** Startup handshake (L1), child port allocation (M5), two-hop SSE flush + reconnect (M4), cancel (M8/confirmed abort primitive exists), and credential injection at launch (H1) all have issues above. **Workable in principle** — loopback latency is negligible, Basic-auth fronting is proven, arg-array spawn is spaces/Unicode-safe (`managed-opencode.ts:91`). The reuse decision itself (ADR 0001) is sound and RE6-compliant; no basis to build new.
2. **ProviderPort thinness vs 5-provider taxonomy.** The seam **does** avoid duplicating provider logic (delegates wire calls to the runtime) — this is real, not hand-wavy, for the delegation shape. The **mapping edge is under-verified**: PR7 taxonomy reconstruction (M3) and retry bounding (M2). The 5th-provider taxonomy is clean *except* for its credential path (H1). D4 seam-only deferral is coherent.
3. **Supervision (ADR 0004).** `taskkill /PID /T /F` and `Get-CimInstance` are available without admin on Win11 — the mechanics are implementable. The gaps are the runtime-role identity primitive (H2) and orphaned grandchildren (M7). Schema, leaf-first stop ordering, graceful-then-force, and stale-record pruning for our own Node processes are correct.
4. **Session-content ownership split.** The split is conceptually correct and preserves one-source-of-truth. Concrete gaps: data-dir isolation (M1) and reconciliation/cross-pin migration (M6). No inherent source-of-truth conflict once M1/M6 are addressed.
5. **Re-architecture risk if frozen as-is.** H1 is the one that can force a coupled provider+credential+lifecycle reshape in L6. H2 and M7 force a supervision rework but localized. Everything else is tunable within the current architecture.

## Override recommendations (author-flagged)

- **ADR 0003 — standalone service placement: RATIFY.** The two-loopback-hop cost is negligible on 127.0.0.1; the headless-testability and single-owner-chain wins are real and directly serve the P3/P7/permission-round-trip test strategy. Condition: adopt the M4 flush-through + reconnect requirement. The embedded fallback remains documented, so this is low-regret.
- **ADR 0005 — 5th provider = user-defined OpenAI-compatible: RATIFY (conditional).** More general than fixed DeepSeek, maps to OpenCode's OpenAI-compatible shape, keeps PR1 extensibility, DeepSeek as preset. **Conditions (both must hold before freeze is meaningful):** (a) resolve H1 for the custom-provider credential path — prove a key + `base_url` reach OpenCode without `auth.json`; (b) the already-flagged SSRF/exfil validation policy (ADR 0005 MED-2: https-only, block loopback/link-local/RFC-1918/metadata) is adopted as a hard prerequisite. If (a) cannot be met, reconsider whether the 5th provider ships in the POC.

## Findings count
- CRITICAL: 0
- HIGH: 2 (H1 credential-injection seam; H2 runtime-role identity)
- MEDIUM: 8 (M1–M8)
- LOW: 2 (L1, L2)
