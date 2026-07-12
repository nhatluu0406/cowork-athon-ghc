# L2-DR1 — Runtime Candidates: Reuse vs Build (Decision-Ready Evidence)

- Task: L2-DR1 (Discovery / de-risk the L3 open decision "Runtime reuse vs build", requirement RE6).
- Role: repository-researcher (READ-ONLY on all source). This is DISCOVERY: options + evidence, NOT a decision. L3 owns the ADR.
- Method: code read of the reference tree .loop-engineer/source/openwork/ @ HEAD 1897f9f; official OpenCode docs + GitHub via WebFetch/WebSearch.
- Citation convention: reference claims cite path:line + symbol; external claims cite a URL. Lines re-verified at 1897f9f where read directly; large-file lines are approximate.
- Supports: S1-S6 (sessions), EV1-EV7 (execution visibility), P1/P3 (permission at execution boundary), F1-F6 (file ops through runtime).

---

## 0. TL;DR (advisory lean — NOT a decision)

Lean: reuse OpenCode as a pinned, single-owner child process, supervised under .runtime/. It provably satisfies the S/EV/P/F requirement families that would otherwise cost months to rebuild: it already exposes an HTTP + SSE surface for sessions, streaming events, tool-permission requests, and file operations; it is MIT-licensed; it ships native Windows x64/arm64 binaries; and OpenWork demonstrates a working supervise-and-proxy pattern we can learn from (not fork). Main residual risks: (a) the OpenWork orphan-cleanup is Unix-only and must be re-implemented for Windows, (b) provider credentials live inside the OpenCode auth store (conflicts with the one-credential-store invariant), (c) OpenCode is a young, fast-moving upstream (835 releases) so pinning + upgrade discipline is mandatory. L3 must still decide — see Open Questions (section 6).

---

## 1. Candidate A — OpenCode reuse (as OpenWork uses it)

### 1.1 Which "OpenCode" this is
Two unrelated projects share the name. OpenWork uses the sst/anomalyco OpenCode (TypeScript/Bun, `opencode serve` HTTP+SSE, @opencode-ai/sdk, opencode.ai/config.json schema, opencode.ai/install) — NOT the older Go opencode-ai/opencode TUI. Confirmed by the SDK dependency "@opencode-ai/sdk": "^1.17.11" (apps/server/package.json:49) and client import createOpencodeClient from @opencode-ai/sdk/v2/client (apps/server/src/server.ts:5, server.ts:865).
- Sources: https://opencode.ai/docs/server/ , https://github.com/sst/opencode .

### 1.2 Pinned version (confirmed)
- Central pin: constants.json:2 -> "opencodeVersion": "v1.17.11".
- Consumed as the SDK version ^1.17.11 (apps/server/package.json:49) and surfaced to clients as OPENCODE_VERSION (apps/server/src/server.ts:91), reported via a health payload field opencodeVersion (apps/server/src/routes/core.ts:44,70,90).
- Install of the pinned binary is scripted from the same constant: pinnedOpencodeInstallCommand() builds `curl -fsSL https://opencode.ai/install | bash -s -- --version <version> --no-modify-path` (apps/desktop/electron/runtime.mjs:1007-1014). NOTE: Unix bash install path; Windows uses a resolved opencode.exe, see 1.7.

### 1.3 Launch / supervision as a child process (confirmed)
Two spawn paths exist.

(a) Server-side managed spawn — createManagedOpencodeServer() (apps/server/src/managed-opencode.ts:58):
- Spawns spawn(bin || "opencode", ["serve","--hostname",hostname,"--port",port,"--cors","*"], {cwd, env, stdio:["ignore","pipe","pipe"]}) (managed-opencode.ts:71-95).
- Host defaults to loopback 127.0.0.1 (managed-opencode.ts:67) — matches the Cowork GHC loopback invariant.
- Free-port allocation with an exclusion set: findFreePort() binds :0 and reads the assigned port (managed-opencode.ts:33-56).
- Per-instance HTTP Basic-Auth secret injected via env OPENCODE_SERVER_USERNAME/OPENCODE_SERVER_PASSWORD (managed-opencode.ts:69-78); env redacted for the execution snapshot via SECRET_ENV_PATTERN (managed-opencode.ts:27,86-89) — feeds the EV debug view.
- Readiness handshake: parses the stdout line "opencode server listening ... on <url>" with a 15s timeout, failing on early exit (managed-opencode.ts:102-127).
- Returns {url, username, password, pid, execution, close} (managed-opencode.ts:129-159) — PID + execution snapshot captured, exactly the state Cowork GHC would track under .runtime/.
- Graceful stop: close() sends SIGTERM, waits 1s, escalates to SIGKILL, waits 0.5s (managed-opencode.ts:140-157).

(b) Desktop (Electron) managed spawn — createRuntimeManager() (apps/desktop/electron/runtime.mjs:559):
- spawnManagedChild() spawns with windowsHide:true, pipes stdout/stderr, tracks state.child/state.childExited and an onExit hook (runtime.mjs:1017-1045).
- Binary resolution resolveOpencodeBinary() (runtime.mjs:849-851) -> resolveBinaryInfo("opencode") searches bundled sidecars then well-known paths, using opencode.exe on win32 (runtime.mjs:829-834).
- Capability probe before serving: runs opencode --version and opencode serve --help, records supportsServe (runtime.mjs:967-1006).
- Per-child stop stopChild(): optional cooperative requestShutdown(), then SIGTERM -> 500ms -> SIGKILL (runtime.mjs:1089-1113).
- Lifecycle aggregation stopAllRuntimeChildren() stops in-process server, orchestrator, and engine child, then resets state (runtime.mjs:1418-1434); prepareFreshRuntime() calls it plus cleanupPackagedSidecars() (runtime.mjs:1436-1441); disposed on shutdown via dispose (runtime.mjs:1979).

Single-owner model (confirmed): one createRuntimeManager owns engine/server/orchestrator child state, and lifecycle ops are serialized (runtime.mjs:559,566,572 — "Serialize engine lifecycle operations"). Matches the Cowork GHC "one owner/supervisor per child-process lifecycle" invariant.

### 1.4 API / transport surface (confirmed + external)
- Transport = HTTP + SSE. The server proxies OpenCode transparently via proxyOpencodeRequest() (apps/server/src/server.ts:887): forwards method/body/query to <baseUrl><proxyPath>, strips inbound auth/host/origin headers, injects OpenCode Basic auth + x-opencode-directory workspace header (server.ts:900-917).
- Session command posts are fire-and-forget; results surface through the event stream (server.ts:926-934, isSessionCommandProxyRequest).
- OpenCode server endpoints (external): /session* (create/list/delete/fork/share/permission), /session/:id/message (prompt/history/command/shell), /find + /file/content + VCS status, /event SSE (first event server.connected, then bus events), /config + /provider, /experimental/tool, /mcp, /lsp, OpenAPI at /doc. Flags: --port (default 4096), --hostname (default 127.0.0.1), --cors, --mdns; Basic auth via OPENCODE_SERVER_PASSWORD/_USERNAME. Source: https://opencode.ai/docs/server/ .
- SDK typed client: createOpencodeClient from @opencode-ai/sdk/v2/client (server.ts:5,865; routes/sessions.ts:1,21; session-read-model.ts:10) — a maintained typed contract layer, not hand-rolled HTTP.

### 1.5 Permission + file-mutation events (confirmed) — maps to P1/P3, F1-F6
Tool-permission is emitted by OpenCode and answered by replying to /permission/:requestId/reply through the proxy; the server enforces WHO may reply at the execution boundary: assertOpencodeProxyAllowed() blocks viewer scope from any non-GET/HEAD proxy and specifically from /permission/:id/reply (apps/server/src/server.ts:634-654). Two-layer model: OpenCode tool-permission (proxied) + the OpenWork ApprovalService write-approval queue, fail-closed on timeout (approvals.ts:16,42-45, per L1 research 2.4). File mutations flow through the server (routes/files.ts), never a runtime-to-UI path directly (L1 2.5). Cowork GHC would keep its own execution-boundary enforcement in front of OpenCode identically.

### 1.6 Session / state persistence (confirmed) — maps to S1-S6
- OpenCode owns the real session/message store in its own SQLite DB via better-sqlite3 (apps/server/src/opencode-db.ts:6). DB file names opencode-<channel>.db / opencode.db (opencode-db.ts:61-66); on Windows stored under %APPDATA%/opencode (opencode-db.ts:54-57), overridable via OPENCODE_DB / XDG_DATA_HOME (opencode-db.ts:47-77). OpenWork seeds "blueprint sessions" directly into that DB (opencode-db.ts, L1 2.2).
- OpenWork keeps only light session grouping/pin/order state itself (session-groups.ts, L1 2.2) and proxies reads (routes/sessions.ts). Implication: session content persistence is a runtime capability obtained for free, but the store belongs to OpenCode, not us (one-source-of-truth nuance for L3).

### 1.7 Windows-fit lens (mixed — confirmed)
- Native Windows support: YES. OpenCode ships opencode-desktop-windows-x64.exe, Scoop, and Chocolatey; MIT. Source: https://github.com/sst/opencode . OpenWork itself builds Electron desktop on windows-latest and windows-11-arm (.github/workflows/build-electron-desktop.yml:27-30), and resolves opencode.exe on win32 (runtime.mjs:829-834).
- PID/port tracking: available. Managed spawn returns pid and discovered port (managed-opencode.ts:133,68); desktop state persists port, pid, opencodeBinPath, managedOpencodeExecution (runtime.mjs:109-134,171-184). Cowork GHC would persist these under .runtime/.
- Graceful stop: partial. SIGTERM->SIGKILL escalation works cross-platform via Node (managed-opencode.ts:140-157; runtime.mjs:1089-1113), but on Windows process.kill(pid,"SIGTERM") is a hard terminate (no true graceful signal). Maps to stop.bat/LC3 but Cowork GHC likely needs a cooperative shutdown request (like requestShutdown) or a Windows job-object / taskkill /T for process trees. GAP (see section 5).
- Orphan cleanup is Unix-only. GAP (High for Windows). cleanupPackagedSidecars() shells out to `ps -Ao pid=,command=` to find orphaned sidecars (runtime.mjs:1072-1086) — ps does not exist on stock Windows. Cowork GHC must implement Windows orphan reaping (job objects, or tasklist / PID-file validation under .runtime/).
- Paths with spaces + Unicode: spawns pass cwd/args as arrays (no shell string interpolation) (managed-opencode.ts:91-95; runtime.mjs:1018-1023), safe for spaces/Unicode. The bash install path (runtime.mjs:1007-1014) is Unix-only; Windows install uses the .exe/Scoop/Choco path instead. Cowork GHC should validate space/Unicode workspace paths end-to-end (not proven in the reference for Windows).
- No admin required: binaries install to user home ~/.opencode/bin (runtime.mjs:831); loopback bind + high ports need no elevation.

---

## 2. Candidate B — Build a new agent/tool runtime

Rough cost/risk to satisfy S/EV/P/F from scratch. To match what OpenCode gives OpenWork today, a new runtime must implement:
- S (sessions): session lifecycle, message history, forking, durable store (OpenCode = SQLite via better-sqlite3). Build cost: medium-high; correctness + migration risk.
- EV (execution visibility): a streaming event bus + SSE (/event, server.connected + bus events), per-step tool-call + todo/plan timeline, cwd/env/cmd snapshots. Build cost: high; hardest to get honest (EV forbids fake "completed" states).
- P (permission): per-tool permission request/response protocol tied to individual tool invocations, reply routing enforceable at a boundary. Build cost: medium; the value of OpenCode is that this protocol already exists and is battle-tested.
- F (file ops): tool implementations (read/write/edit/find/grep) plus workspace confinement. Build cost: medium — but Cowork GHC keeps its OWN file-mutation boundary regardless (server routes/files.ts pattern), so a chunk of F stays ours either way.
- Provider/LLM plumbing: provider-neutral model routing, streaming, tool-call loop, retries — this is DR3 scope but a build-new runtime inherits ALL of it. Single largest reason to reuse.

Assessment (inferred): Build-new is a multi-engineer, multi-month effort duplicating a 184k-star, 835-release upstream, and directly contradicts RE6 ("reuse ... unless an L3 ADR justifies building"). Justifiable ONLY if a hard blocker in reuse appears (license change, unfixable Windows supervision, or a credential-store conflict that cannot be seamed). Upside of build-new: full control of credential store + event schema (see section 5 credential gap). Downside: cost, risk, reinventing the LLM tool-loop.

## 3. Candidate C — Other reusable runtimes worth an L3 look (brief)
- Go opencode-ai/opencode (the other OpenCode): terminal-first TUI, not designed as an embeddable HTTP/SSE service — why-not: weaker headless server/event surface for a desktop client than sst OpenCode. Source: https://github.com/opencode-ai/opencode .
- Anthropic Claude Agent SDK / Claude Code (headless): mature agent loop + tool + permission model — why-not: provider-coupled (tension with RE6 / provider-neutral invariant; neutrality question belongs to DR3). Worth a one-line L3 mention only.
- Aider / Continue / Cline-style engines: exist and are OSS — why-not: mostly editor/CLI-embedded, fewer expose a stable local HTTP+SSE session/permission service for an external desktop supervisor; would need the same wrap-and-supervise work as OpenCode but with smaller ecosystems. (Inferred; not code-verified — L3 look-if-needed, low priority.)

---

## 4. Comparison table (H/M/L = good/mixed/poor for Cowork GHC; NOT a decision)

| Criterion | A: OpenCode reuse | B: Build new | C: Other (Go OpenCode / provider-coupled) |
|---|---|---|---|
| License | H — MIT [gh] | H — ours | M — varies (MIT / vendor terms) |
| Windows-11 fit | M — native win-x64/arm64 binary [gh], but our supervisor must add Windows orphan-reap + true graceful stop (1.7) | M — full control but must build+test Windows from zero | L/M — Go TUI weak headless fit; provider SDKs vary |
| Packaging / distribution | H — install script, Scoop, Choco, npm SDK, standalone .exe [gh]; pin via constants.json:2 | L — nothing exists; we own build+release | M |
| Supervision / lifecycle | M — proven spawn/PID/port/stop pattern (managed-opencode.ts:58-159) but Unix-only orphan cleanup (runtime.mjs:1072-1086) | M — clean-slate, but all effort ours | L/M |
| Event / permission surface | H — HTTP+SSE /event, tool-permission /permission/:id/reply, boundary-enforceable (server.ts:634-654,887) [docs] | L — must design + build EV/P from scratch | M — provider SDKs have loops but different event shapes |
| Testability | H — typed SDK contract (@opencode-ai/sdk/v2/client), serve --help probe (runtime.mjs:983-1006), stable HTTP to mock | M — we define contracts but write all suites | M |
| Maturity | H — 184k stars, 835 releases, latest ~v1.17.18 vs pinned v1.17.11 [gh] | L — none | M (Go OpenCode) / H (vendor SDKs) |
| Risk | M — young fast-moving upstream (3.6k open issues), credential-store conflict (5), pin/upgrade discipline needed | H — cost + reinvention + RE6 conflict | M-H |

[gh]=https://github.com/sst/opencode ; [docs]=https://opencode.ai/docs/server/ .

---

## 5. Open findings by severity

- High — Windows orphan-process cleanup is Unix-only. cleanupPackagedSidecars() uses ps (runtime.mjs:1072-1086); no Windows equivalent in the reuse path. Cowork GHC must build Windows-safe orphan reaping (Job Objects / PID-file validation under .runtime/) or risk stranded opencode.exe after an unclean quit. Affects LC3 / stop.bat.
- High — Credential-store conflict. Provider API keys live in the OpenCode auth store (auth.json in the OpenCode config dir), not an OpenWork-owned single store (L1 section 4; provider calls made by OpenCode, openwork-runtime-config.ts). Conflicts with the Cowork GHC "one credential store / no keys in browser storage / Windows Credential Manager" invariant. L3 must decide how to seam this (e.g. Cowork GHC owns keys in Credential Manager and injects into OpenCode per-launch via env/config file, never persisting them in the OpenCode store).
- Medium — Graceful stop on Windows is a hard kill. SIGTERM maps to terminate on Windows; no cooperative shutdown for the OpenCode child in the reuse path (managed-opencode.ts:140-157). May drop in-flight session writes to the OpenCode SQLite. Consider a cooperative shutdown request + timeout.
- Medium — Upstream velocity / pin drift. 835 releases; pinned v1.17.11 vs latest ~v1.17.18 [gh]. Reuse mandates a pinned-version policy + upgrade-test gate. SSE/endpoint schema could shift between minors.
- Low — Install path Unix bias. The pinned installer is a bash curl script (runtime.mjs:1007-1014); Windows must use the .exe/Scoop/Choco/bundled-sidecar path (already resolved at runtime.mjs:829-834). Cowork GHC should not depend on bash on Windows.
- Low — Line-number drift. Large files (server.ts, runtime.mjs) may shift; symbols are stable, exact lines approximate.

## 6. Open questions L3 must resolve (not answered here)
1. Reuse OpenCode vs build — the RE6 ADR decision itself (this doc only lays out options).
2. Credential ownership seam: how does Cowork GHC keep "one credential store" while OpenCode expects its own auth store? (Injection at launch? Proxy the provider? Accept the OpenCode store as the single store?) — intersects DR3.
3. Embedding mode: OpenWork often runs its server in-process in Electron main and spawns only OpenCode as a child (L1 3.6). Does Cowork GHC want server-in-process or a separate supervised server process? Affects .runtime/ ownership + shell choice (DR2).
4. Windows supervision design: Job Objects vs PID-file reaping vs taskkill /T for the OpenCode process tree; where PID/port live under .runtime/.
5. Version pin + upgrade policy for OpenCode (single constants.json-style pin, upgrade-test gate).
6. How much of the OpenCode SSE event schema Cowork GHC treats as its own EV contract vs re-normalizes (avoid leaking upstream schema churn into the UI).
7. Whether to depend on the typed @opencode-ai/sdk or a thin internal client (coupling vs convenience).

## 7. Evidence source paths (read-only)
- Reference tree: .loop-engineer/source/openwork/ @ 1897f9f.
- Key files cited: constants.json; apps/server/src/managed-opencode.ts; apps/server/src/opencode-db.ts; apps/server/src/server.ts; apps/server/src/routes/core.ts, routes/sessions.ts; apps/server/package.json; apps/desktop/electron/runtime.mjs; .github/workflows/build-electron-desktop.yml.
- Prior loop input: .loop-engineer/evidence/L1/openwork-research.md.
- External: https://github.com/sst/opencode , https://opencode.ai/docs/server/ , https://opencode.ai/docs/cli/ , https://github.com/opencode-ai/opencode .
