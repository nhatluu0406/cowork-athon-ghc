# L2-DR2 — Desktop Shell + Local-Service Transport + Windows Process Lifecycle (Discovery)

- Task: L2-DR2 (Discovery/de-risk), role: repository-researcher (READ-ONLY on all source).
- Purpose: give L3 decision-ready evidence to write (a) a "desktop shell" ADR and
  (b) inform the transport/loopback and Windows process-lifecycle ADRs, without
  re-investigating. This lays out OPTIONS with evidence. It does NOT decide the shell.
- Scope of decision de-risked: W1 (native folder picker), S6/SD2 (runtime status),
  P7 (loopback-only), LC1-LC5 (Windows lifecycle scripts), SD7 (version); plus native
  capabilities tray/auto-update/process-supervision.
- Reference tree: `.loop-engineer/source/openwork/` @ `1897f9f` (read-only, never a build dep).
- Legend: **[confirmed]** = read in code with file:line; **[inferred]** = reasoned from
  code/behaviour; **[external]** = public docs/articles (URLs at bottom).

---

## 1. How the reference does it TODAY (Electron), with citations

### 1.1 The shell is Electron — the L1 "stale Tauri README" is a completed migration, not a live choice
- **[confirmed]** `apps/desktop/package.json:38-40` pins `electron ^35.0.0`,
  `electron-builder ^25.1.8`, `electron-devtools-installer ^4.0.0`; `main` = `electron/main.mjs`
  (`package.json:10`). No `src-tauri/` exists anywhere (glob shows only `.mjs`/`.cjs`;
  L1 already confirmed "NO src-tauri/").
- **[confirmed]** `apps/desktop/electron-builder.yml:1-3` says, verbatim: "appId intentionally
  matches the Tauri shell so both builds share the same ... bundle identifier ... In-place
  migration from Tauri to Electron depends on this." And `:37-39`: the electron-updater feed
  "Matches the existing release workflow target so both Tauri (latest.json) and Electron
  (latest*.yml) can live on the same release assets **during the migration window**."
- **Decision-relevant reading:** the reference did NOT casually leave a stale README. It
  actively migrated **away from Tauri, to Electron**, and kept the old Tauri `appId`/feed
  aliases so installed Tauri users upgrade in place. That is a data point *against* Tauri for
  this exact class of product (a project that shipped both, then chose Electron), though the
  reasons are not documented in-tree (see Open Questions). Do not over-weight: one team choice,
  drivers unknown. **[inferred]**

### 1.2 Native folder picker (W1) — CONFIRMED
- `apps/desktop/electron/main.mjs:1494` `"pickDirectory"` IPC handler ->
  `dialog.showOpenDialog(activeWindowFromEvent(event), { properties: ["openDirectory",
  "createDirectory"(, "multiSelections")] })` (`:1497-1506`). Returns `null` on cancel,
  single path or array otherwise. Sibling handlers `pickFile` (`:1508`), `saveFile` (`:1521`);
  `dialog` imported at `main.mjs:20`. This is the exact W1 mechanism L1 cited.

### 1.3 System tray — NOT present in the reference
- **[confirmed]** Zero `Tray` usages (`grep "Tray"` in `main.mjs` -> no matches). The app uses
  an application **Menu** only (`app-menu.mjs:218` `Menu.buildFromTemplate`; installed at
  `main.mjs:2130`). So "tray" is a Cowork-GHC requirement with **no reference precedent** — L3
  must design it fresh regardless of shell.

### 1.4 Auto-update — CONFIRMED (electron-updater)
- `apps/desktop/package.json:29` `electron-updater ^6.3.9`. Wiring in `updater.mjs`: dynamic
  `import("electron-updater")` (`:239`), `autoDownload = false` (`:242`),
  `autoInstallOnAppQuit = true` (`:243`), `disableDifferentialDownload = true` (`:249`),
  `setFeedURL({ provider: "generic"|github })` (`:160-161`). Packaged-only ("dev builds skip
  this", `:216-219`). Feed: `electron-builder.yml:40-44` github (owner `different-ai`).

### 1.5 Child-process supervision (maps to start/stop/LC3) — CONFIRMED, with a Windows caveat
- The **server runs embedded in the Electron main process**, not as a child: `runtime.mjs:1203`
  `const { startEmbeddedServer } = await import(embeddedServerImportUrl(embeddedPath))` (bundle
  resolved from `server/dist/embedded.js`, `:1191-1201`). Only **OpenCode / orchestrator
  sidecars** are child processes. **[confirmed]**
- Spawn: `runtime.mjs:1017` `spawnManagedChild(state, program, args)` ->
  `spawn(program, args, { cwd, env, stdio:["ignore","pipe","pipe"], windowsHide:true })`
  (`:1018-1023`), tracks `state.child`, wires `exit`/`error`. **[confirmed]**
- Graceful->force stop: `runtime.mjs:1089` `stopChild()` — optional `requestShutdown()` HTTP ask
  first, then `child.kill("SIGTERM")` -> wait 500 ms -> `child.kill("SIGKILL")` (`:1106-1112`).
  Orphan sweep `cleanupPackagedSidecars()` (`:1060`) uses `process.kill(pid, "SIGTERM")` then
  `SIGKILL` (`killProcessId` `:1051-1058`, called `:1082-1085`).
- **Windows caveat [inferred, load-bearing for LC3]:** the orphan sweep enumerates processes
  with `spawnSync("ps", ...)` (`runtime.mjs:1072`) — `ps` is **Unix-only**; this cleanup path
  does not run on Windows. And on Windows the Node `process.kill(pid,"SIGTERM")` /
  `child.kill("SIGTERM")` does not deliver a catchable graceful signal — it terminates roughly
  like SIGKILL and does **not** kill the child own descendants. Graceful stop on Windows must be
  app-level (the `requestShutdown` HTTP call the reference already does, `:1066/1095-1104`) and
  force-kill of a tree needs `taskkill /PID <pid> /T /F` or a Win32 Job Object. Real gap the
  Cowork-GHC lifecycle must close on **either** shell.
- Port/loopback allocation: `findFreePort(host="127.0.0.1")` and `portAvailable(host,port)` bind
  on `127.0.0.1` via `net.createServer().listen({host,port})` (`runtime.mjs:391-417`).
- **Runtime-state ownership:** the reference tracks live runtime state in an in-process,
  persisted **registry inside the embedded server** (`runtime.mjs:1174`), NOT in a
  `.runtime/pids` layout. The Cowork-GHC `.runtime/` PID/port scheme is our own scaffold
  convention (see section 4), with no reference precedent to copy.

### 1.6 Loopback default (P7) — CONFIRMED at the server
- `apps/server/src/config.ts:48` `const DEFAULT_HOST = "127.0.0.1"`; resolved host `:313`
  (`cli.host ?? OPENWORK_HOST ?? fileConfig.host ?? DEFAULT_HOST`). Non-loopback is explicit
  opt-in (`--host`, `:182`), which for Cowork GHC is OOS2 / requires an ADR. **[confirmed]**

### 1.7 Windows packaging — CONFIRMED (NSIS)
- `electron-builder.yml:93-109` `win: { icon: ...ico, target: [nsis] }`, sidecars shipped as
  `extraResources` (`opencode*.exe`, `openwork-orchestrator*.exe`, `versions.json`). `asar: true`
  with `asarUnpack` for `node-pty` native (`:30-33`). `artifactName`
  `openwork-${os}-${arch}-${version}.${ext}` (`:110`). **[confirmed]**

---

## 2. Electron vs Tauri (vs other) for THIS product on Windows 11

Context that changes the usual tradeoff: **Cowork GHC targets Windows 11 only, local PC.** That
neutralises the biggest classic Tauri downside (cross-platform WebView inconsistency —
irrelevant when only WebView2 matters) **[external]** and the runtime-dependency downside
(WebView2 ships **preinstalled on Windows 11**; older Windows would need the bootstrapper, out
of our target) **[external]**. It also raises the weight of "fit with a Node/TS stack": our whole
existing tooling (controller `tools/loop-engineer/*`, `lifecycle.mjs`, planned server) is Node/TS,
and the Tauri native/back-end layer is **Rust**.

Scores: 5 = clear advantage, 3 = adequate/tie, 1 = notable friction. Advisory weighting only.

| Criterion | Electron | Tauri v2 | Notes / evidence |
|---|---|---|---|
| Native folder picker (W1) | 5 | 5 | Both expose an OS folder dialog. Reference proves Electron path `main.mjs:1494`. Tauri = `@tauri-apps/plugin-dialog`. **[external]** |
| System tray | 5 | 4 | Electron `Tray` mature/ubiquitous; Tauri v2 tray API is younger. Neither used in reference (1.3). **[external]** |
| Auto-update | 5 | 4 | Electron `electron-updater` battle-tested (reference 1.4). Tauri updater plugin needs signing keys; fewer years in field. **[external]** |
| Child-process supervision (LC3) | 4 | 3 | Electron = Node `child_process`, full control, but Windows graceful-stop/tree-kill is manual (1.5). Tauri sidecars have documented **orphan-on-exit** bugs (GH #5611, disc #3273); descendant processes survive. Both need explicit Job-Object/taskkill discipline; Electron uses the Node APIs our stack already has. **[external]/[confirmed caveat]** |
| Windows packaging/installer | 5 | 5 | Electron NSIS via electron-builder (reference yml). Tauri NSIS/MSI via bundler. Both first-class on Windows. **[external]** |
| Bundle size / perf / RAM | 2 | 5 | Electron ships Chromium+Node: installers ~80-150 MB, idle RAM ~150-300 MB. Tauri reuses WebView2: installers often <10-15 MB, idle RAM ~30-85 MB, faster cold start. Big Tauri win. **[external]** |
| Runtime / webview dependency | 4 | 4 | Electron bundles its engine (no external dep, bigger). Tauri needs WebView2 — **preinstalled on Win11** so a tie for our target; differs only on older Windows. **[external]** |
| Security posture (isolation/capabilities) | 3 | 5 | Electron contextIsolation on by default but full lockdown is an opt-in checklist. Tauri WebView has zero native access by default; all system access via explicitly granted capabilities, type-checked in Rust. Aligns with our "permission at the execution boundary" invariant (though our boundary is the local service, not the shell). **[external]** |
| Testability | 4 | 3 | Electron main-process logic is plain Node — reference unit-tests it directly (`runtime.test.mjs`, `updater.test.mjs`, `workspace-store.test.mjs`; `package.json:23`), matching our Node `--test` harness. Tauri back-end tests are Rust (`cargo test`) — a second toolchain. **[confirmed]/[inferred]** |
| Fit with Node/TS stack | 5 | 2 | Existing toolchain + planned server is Node/TS. Electron is Node/TS end-to-end. Tauri forces a **Rust** native layer + build toolchain for custom native/supervision work, splitting the stack and skill surface. **[inferred/external]** |
| Maturity / ecosystem | 5 | 4 | Electron: largest desktop ecosystem, proven update/packaging, the stack the reference validated on Windows. Tauri v2 production-ready and growing but younger, thinner plugin ecosystem. **[external]** |

**Other / lighter options (brief, [inferred/external]):** Wails (Go back-end — wrong stack),
Neutralino (light but immature, weak native supervision), plain Node + system-browser or a raw
WebView2 host (loses packaging/auto-update/picker niceties, more to build). None clearly beat the
Electron/Tauri pair for a Node/TS team on Windows 11; treat as fallbacks only.

**Net picture:** Tauri wins decisively on **bundle/RAM/perf** and **default security posture**;
Electron wins decisively on **Node/TS fit, testability with our harness, ecosystem maturity, and
battle-tested auto-update** — and is the stack the closest comparable product landed on *after*
trying Tauri. For a Windows-11-only local product the usual Tauri portability/runtime penalties
largely vanish, so the real trade is "lean+secure (Tauri, +Rust)" vs "stack-homogeneous+proven
(Electron, +heft)".

---

## 3. Local-service transport (loopback only, P7)

- **Reference approach [confirmed via L1 + config]:** UI (React/Vite, `apps/app`) is a pure
  client of the local **HTTP** application service; realtime is **Server-Sent Events (SSE)**
  proxied transparently from the runtime (`proxyOpencodeRequest`, L1 section 3.3; server binds
  `127.0.0.1`, `config.ts:48`). Native-only calls go through an Electron preload bridge
  (`apps/app/src/app/lib/desktop.ts`), never business logic in the renderer.
- **Candidates for Cowork GHC (L3 decides):**
  - **HTTP + SSE (reference-proven):** simplest, uni-directional stream fits token/step
    streaming, trivially loopback-bindable and testable, framework-agnostic. Recommended
    baseline unless bidirectional/real-time control is needed. **[inferred]**
  - **HTTP + WebSocket:** bidirectional (useful for cancel/interactive control S3), more moving
    parts; still loopback-bindable. **[external]**
  - **Electron IPC only (no local HTTP server):** possible **only** with an Electron shell and
    an embedded-in-main service (as reference embeds its server, 1.5). Removes the socket
    (strongest P7 story — nothing to bind) but couples service to shell and complicates the
    "UI is a client of a local service" invariant + headless testing. **[inferred]**
  - **Named pipes / UDS:** strong non-network isolation, but Windows named-pipe ergonomics +
    tooling are heavier and less test-friendly than a loopback HTTP port. **[inferred]**
- **P7 enforcement + testability (choice-independent):** bind explicitly to `127.0.0.1` (and/or
  `::1`); never `0.0.0.0`. Acceptance test = connect from a non-loopback interface (host LAN IP)
  and assert refusal, plus inspect listening sockets (`netstat` / `Get-NetTCPConnection`) show
  only loopback. The reference `listen({host,port})` pattern (`runtime.mjs:396/407`) is reusable.
  An embedded/IPC design satisfies P7 by construction (no socket) but still needs a test
  asserting no port is opened.

---

## 4. Windows process lifecycle, tied to the existing scaffold

Current scaffold (`tools/loop-engineer/lifecycle.mjs`, driven by thin `scripts/*.bat`):
- **Single owner + `.runtime/` layout:** `RUNTIME_DIRS` = pids, logs, state, temp
  (`lifecycle.mjs:11`), created by `ensureRuntimeDirs` (`:77`). Tracked processes read from
  `.runtime/pids/*.json` via `runningPids` (`:81`) + `parsePidFile` (`:50`).
- **start/stop are honest stubs today:** `cmdStart` returns exit **3** NOT_READY until a runtime
  exists (`:108-114`; `start.bat` maps 3 -> "NOT READY"). `cmdStop` reports tracked count and
  "graceful shutdown not implemented until runtime exists" (`:116-121`). `.bat` files
  self-locate root via `%~dp0` (`start.bat:4` etc.) and propagate exit codes (`exit /b %RC%`),
  satisfying LC5 root-independence + honest-exit-code rules.
- **What L3 must define (gaps the scaffold intentionally leaves open):**
  1. **Who writes `.runtime/pids/*.json`** and the schema (pid, port, role, startedAt, a
     verifiable identity token). `parsePidFile` exists but nothing populates it yet.
  2. **Stale-PID handling (LC3):** on stop/status, verify the PID is alive **and is ours**
     before acting (identity check, not name match) — the reference relies on an in-process
     registry (1.5) the CLI-driven `.bat` model lacks; needs a durable, verifiable record. LC3
     forbids killing by generic name (e.g. `node.exe`).
  3. **Graceful vs force on Windows (LC3):** SIGTERM is not graceful on Windows (1.5). Use an
     app-level shutdown request (HTTP to the loopback service, as reference at `runtime.mjs:1066`)
     -> then `taskkill /PID <pid> /T /F` (tree) or a Win32 Job Object so descendants (e.g. the
     agent runtime) do not orphan. Use `spawn(..., {windowsHide:true})` as `runtime.mjs:1022`.
  4. **Paths with spaces + Unicode (W3, LC5):** `.bat` already quotes `"%ROOT%"`; the CLI must
     quote/normalize all spawned-child and workspace paths (W3 target `C:\Users\<unicode>\My
     Projects (test)`).
  5. **No-admin:** all of the above must work without elevation (security rule); NSIS per-user
     install (electron-builder default) supports this; avoid machine-wide services.
- **Shell interaction:** if the service is embedded in the shell (Electron pattern 1.5), the
  `.bat` scripts supervise **one** process (the shell) and the shell owns the runtime child; if
  the service is standalone, the CLI supervises it directly. This ownership question is
  downstream of sections 2/3 and must be settled together.

---

## 5. Open questions for L3 (explicit)

1. **Why did the reference migrate Tauri -> Electron?** Not documented in-tree (only the yml
   migration comments). Drivers (native modules like `node-pty`/`better-sqlite3`, Rust-team
   friction, ecosystem?) unknown — do not assume they apply here. `node-pty`/`better-sqlite3`
   (`apps/desktop/package.json:27,32`) are Node-native deps trivial under Electron that would
   need Rust equivalents or a Node sidecar under Tauri — a plausible but unconfirmed driver.
2. **Service placement:** embedded-in-shell (reference model, strongest P7, shell-coupled) vs
   standalone loopback service (cleaner boundary, easier headless test, one more supervised
   process)? Decides section 3 transport and section 4 ownership together.
3. **Transport:** HTTP+SSE (reference-proven baseline) vs +WebSocket (S3 cancel/interactive) vs
   Electron-IPC-only (Electron-only).
4. **If Tauri:** accept a Rust native layer + `cargo` toolchain in an otherwise Node/TS repo, and
   own the documented sidecar orphan-cleanup problem explicitly (Job Object / kill-tree)?
5. **Tray + auto-update:** both are Cowork-GHC requirements with **no reference precedent for
   tray**; auto-update has a proven Electron path but a signing-key + plugin story under Tauri.
   Confirm both are in POC scope or deferred.
6. **Windows graceful-stop mechanism** for LC3 (app-level shutdown endpoint + taskkill /T /F or
   Job Object) — must be specified regardless of shell.

---

## 6. Advisory lean (NOT a decision — L3 owns the ADR)

A mild lean toward **Electron** for the Cowork GHC POC, for reasons specific to *this* project:
- The entire existing stack (controller, `lifecycle.mjs`, planned server, Node `--test` harness)
  is Node/TS; Electron keeps one language/toolchain and makes main-process supervision + IPC
  logic unit-testable exactly as the reference tests it (`runtime.test.mjs` etc.). Tauri injects
  a Rust build layer for any custom native/supervision work.
- It is the stack the closest comparable product validated on Windows *after* trying Tauri,
  including the native deps (`node-pty`, `better-sqlite3`) we are likely to want.
- Auto-update and NSIS packaging are proven end-to-end in the reference and reusable.

This lean is **weak and reversible**. **Tauri is a legitimate choice** and the *stronger* pick if
bundle size / idle RAM / cold-start / default-deny security posture are first-order POC goals —
and its usual Windows downsides (WebView inconsistency, runtime download) are largely moot on a
Windows-11-only target. The decisive question for L3 is the weighting of **stack homogeneity +
proven tooling (Electron)** vs **footprint + security posture, at the cost of a Rust layer
(Tauri)**. Either can satisfy every MUST (W1, S6, P7, SD2, SD7, LC1-LC5); no acceptance criterion
forces the choice.

---

## Evidence source paths
- Reference (read-only) @ `1897f9f`: `apps/desktop/package.json`,
  `apps/desktop/electron-builder.yml`,
  `apps/desktop/electron/{main.mjs,runtime.mjs,updater.mjs,app-menu.mjs}`,
  `apps/server/src/config.ts`.
- Repo scaffold: `tools/loop-engineer/lifecycle.mjs`, `scripts/{init,start,stop,clean}.bat`.
- Inputs: `docs/product/cowork-ghc-scope-and-acceptance.md` (Areas 1,8,9),
  `.loop-engineer/evidence/L1/openwork-research.md`.
- External (public docs/articles, fetched 2026-07-11):
  - Tauri v2 distribution/WebView2/updater — https://v2.tauri.app/distribute/ ,
    https://v2.tauri.app/reference/webview-versions/
  - Tauri sidecars — https://v2.tauri.app/learn/sidecar-nodejs/
  - Tauri sidecar orphan-on-exit — https://github.com/tauri-apps/tauri/issues/5611 ,
    https://github.com/tauri-apps/tauri/discussions/3273
  - Comparisons (bundle/RAM/security/WebView2) — https://www.gethopp.app/blog/tauri-vs-electron ,
    https://www.pkgpulse.com/guides/electron-vs-tauri-2026 ,
    https://softwarelogic.co/en/blog/how-to-choose-electron-or-tauri-for-modern-desktop-apps
