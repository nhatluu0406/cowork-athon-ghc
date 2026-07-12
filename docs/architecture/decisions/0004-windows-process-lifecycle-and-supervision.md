# ADR 0004 — Windows Process Lifecycle & Supervision (LC3)

- Status: **Accepted** — FROZEN in Loop L4 (Architecture Review), 2026-07-11. Ratified after multi-role critique + threat model. Supersedes the L3 Proposed draft.
- Date: 2026-07-11
- Loop: L3 (Architecture Candidates)
- Deciders: product-architect (L3); to be ratified by the L4 critique + freeze.
- Requirement drivers: LC1–LC5 (Windows lifecycle scripts), S6/SD2 (honest runtime status),
  the "one owner/supervisor per child-process lifecycle; `.runtime/` state" invariant.
- Related ADRs: 0001 (runtime), 0002 (shell), 0003 (service placement).

## Context

L2 surfaced a **HIGH cross-cutting Windows supervision gap** (discovery-report §4;
`runtime-candidates.md` §5; `desktop-shell-and-lifecycle.md` §1.5, §4):

- The reference orphan sweep uses `spawnSync("ps", …)` (`runtime.mjs:1072`) — **Unix-only**; it
  does not run on Windows (**DR1/DR2 gap**).
- On Windows, `process.kill(pid,"SIGTERM")` / `child.kill("SIGTERM")` is a hard terminate, **not** a
  catchable graceful signal, and does **not** kill descendant processes (**DR1/DR2 gap**).
- The existing scaffold `tools/loop-engineer/lifecycle.mjs` defines the `.runtime/` layout
  (`RUNTIME_DIRS = pids, logs, state, temp`, `:11`), `parsePidFile` (`:50`), and `runningPids`
  (`:81`) — but **nothing populates `.runtime/pids/` yet** and start/stop are honest stubs
  (`cmdStart` returns exit 3 NOT_READY `:108-114`; `cmdStop` reports tracked count `:116-121`).

L3 must define the PID record writer + schema, stale-PID handling by identity, and the Windows
graceful-then-force stop, aligned with the existing scaffold and with no admin.

## Decision

### Supervision topology — one owner per child

A single supervision chain, each link owning exactly one child (honors the invariant):

```
lifecycle CLI (tools/loop-engineer) ──spawns/stops──► App Shell (Electron)   [role: app-shell]
                                                          │ owns one child
                                                          ▼
                                                      Local Service (Node)   [role: local-service]
                                                          │ owns one child
                                                          ▼
                                                      OpenCode runtime       [role: agent-runtime]
```

- The **App Shell** supervises exactly the **Local Service**; the **Local Service** supervises
  exactly the **OpenCode runtime**. No component supervises a child it did not spawn.
- Each supervised process writes its own `.runtime/pids/<role>.json` record on successful start and
  removes it on clean exit. The record is written by the **parent that spawned it** as soon as the
  PID is known, then completed (port/identity) once the child reports ready.

### `.runtime/pids/*.json` record schema

```jsonc
{
  "schemaVersion": 1,
  "role": "app-shell" | "local-service" | "agent-runtime",
  "pid": 12345,
  "ppidRole": "local-service",        // supervising role; null for app-shell (CLI-owned)
  "host": "127.0.0.1",                // loopback; null for app-shell
  "port": 51763,                      // the port WE assigned via --port; null for app-shell
  "startedAt": "2026-07-11T10:22:00.000Z", // process creation time, for identity re-verification
  "exePath": "C:\\…\\opencode.exe",    // resolved binary/executable for cross-check
  "runtimeVersion": "v1.17.11"        // agent-runtime only; matches the ADR 0001 pin
}
```

`parsePidFile` (`lifecycle.mjs:50`) already parses this shape; `runningPids` already enumerates it.
There is **no `identityToken` field** — see the corrected identity mechanism below.

### Identity verification — never kill by generic name (corrected: no env/CLI token)

The original candidate scheme (`--cowork-identity <token>` on the command line, cross-checked via
`Get-CimInstance Win32_Process` env/CommandLine, plus a runtime `/health` that echoes the token) is
**infeasible** and is dropped:

- `Win32_Process` does **not** expose a process's environment variables, so an env identity token is
  not verifiable from the outside.
- OpenCode exposes **no** pid/instance-id endpoint: `/global/health` returns only
  `{ healthy, version }`, so the runtime cannot echo an identity token either.

**Corrected mechanism — identity from what the supervisor already holds at spawn.** Identity is the
tuple **{ pid, startedAt (process creation time), exePath, assigned port }**:

- The supervisor holds the child **PID directly at spawn** (reference: OpenWork captures `child.pid`
  at `runtime.mjs:134`), plus the **port we assigned** via `--port`, plus the process **start-time**
  and **exePath** it records in the PID file.
- Before signalling any candidate stale process, the supervisor **RE-VERIFIES** it by
  `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"`, asserting the live process's
  **CreationDate == recorded `startedAt`** and **ExecutablePath == recorded `exePath`**. Matching by
  PID **and** creation-time **and** exePath means a reused PID (Windows recycles PIDs) can never be
  mis-killed. The Local Service is additionally reachable on its recorded loopback port for a
  liveness check.
- Only a re-verified-ours process is ever signalled. **Killing by image name (e.g. `node.exe` /
  `opencode.exe`) is forbidden** (LC3).

**Stale-PID handling:** if the record exists but no live process matches on PID + start-time +
exePath (PID dead, or PID reused by an unrelated process), the record is treated as stale — it is
pruned and "nothing running" is a valid `0` result (LC3).

### Per-run data isolation — via child ENV, not a `--data-dir` flag

The OpenCode CLI accepts `--hostname` / `--port` / `--cors` but has **no `--data-dir` flag**
(reference: `runtime.mjs:1388` — args are `serve --hostname 127.0.0.1 --port <port> --cors *`).
Per-run data isolation is therefore done through the **child's environment**: the supervisor sets
`XDG_DATA_HOME` and `OPENCODE_CONFIG_DIR` in the spawn env to point OpenCode at a Cowork-GHC-owned
per-run directory (reference: env injection into every spawned child, `cli.ts:2666-2703`;
`runtime.mjs:751-767`). This keeps runtime state under Cowork GHC's control without relying on a
flag OpenCode does not provide.

### Supervision identity vs boundary client token (MED-1)

Two distinct notions must not be conflated:

- **Supervision identity** (this ADR): the local `{ pid, startedAt, exePath, port }` tuple used only
  by the supervisor/stop path to avoid killing an unrelated process. It is **not a secret**, is
  derived from OS-observable facts, and **never leaves the machine**.
- **Boundary client token** (ADR 0003): a per-launch **secret** that authenticates the
  renderer/shell to the local service across the loopback hop.

These are separate concerns with separate values. The trust boundary is explicitly **single-user,
single-machine**: any same-user process can already read `.runtime/` files and enumerate processes,
so supervision identity defends against accidental collision (reused PID / stray image name), not
against a hostile local user — consistent with the single-user POC threat model (see ADR 0003 MED-1).

### Graceful-then-force stop (Windows-correct)

`stop.bat` → lifecycle CLI, in order, per role, leaf-first (runtime, then service, then shell):

1. **App-level graceful shutdown request** over loopback HTTP to the Local Service (which asks the
   OpenCode child to shut down cooperatively), with a bounded timeout. SIGTERM is **not** used as a
   graceful mechanism on Windows (it is not catchable there — DR1/DR2).
2. If still alive after the timeout, **force-kill the process tree** with
   `taskkill /PID <pid> /T /F` (kills descendants; `/T`) — or, preferred where feasible, launch each
   supervised child inside a **Win32 Job Object** with kill-on-close so descendants cannot orphan.
3. Re-verify the record is gone; prune `.runtime/pids/<role>.json`.

**The Windows orphan reaper MUST be built by us.** The reference sweep `cleanupPackagedSidecars`
is **Unix-only** — it shells out to `spawnSync("ps", ["-Ao", "pid=,command="])` (`runtime.mjs:1072`)
with **no Windows branch** — so it does not run here and cannot be reused. Our reaper is the
graceful loopback shutdown above, then `taskkill /PID <pid> /T /F` or a Win32 Job Object, gated by
the PID + start-time + exePath re-verification. Children are spawned with `{ windowsHide: true }`
and argument arrays (spaces/Unicode-safe, W3/LC5).

### No admin / packaging

All supervision works **without elevation**: per-user NSIS install (Electron default, ADR 0002),
loopback + high ports need no elevation, no machine-wide Windows service. `.bat` files remain thin
`%~dp0`-rooted entry points that call the CLI and propagate honest exit codes (`start` = 3 when not
ready, `clean` = 4 when running, `9` when Node missing — existing scaffold contract).

## Consequences

- Positive: closes the HIGH Windows supervision gap; durable, identity-verified PID records make
  LC3 correct and stale-PID-safe; single-owner chain is auditable.
- Negative: Job Object integration is native-ish work (via an Electron/Node addon or `taskkill /T`
  fallback); the CLI must depend on `Get-CimInstance`/`wmic` availability (present on Win11).
- The lifecycle CLI graduates from honest stubs to a real writer/reaper in L5/L6; the schema +
  identity check above are the contract those loops implement and test.

## Alternatives considered

- **Reuse the reference `ps` orphan sweep** — rejected: Unix-only, does not run on Windows.
- **SIGTERM as graceful stop** — rejected: not catchable on Windows and does not kill descendants.
- **Kill by image name** — rejected: violates LC3; would kill unrelated `node.exe`/`opencode.exe`.
- **In-process registry only (reference model)** — rejected for the CLI-driven `.bat` model: not
  durable across a crashed shell; `.runtime/pids/` records are the durable source of truth.

## Requirements traceability

| Requirement | How this ADR satisfies it |
|---|---|
| LC3 | Graceful-then-force stop; identity-verified; never by generic name; stale PID handled; only own processes. |
| LC1/LC2/LC5 | Aligns with `%~dp0`-rooted thin `.bat` + CLI, honest exit codes, no admin, spaces/Unicode-safe spawns. |
| S6/SD2 | `.runtime/pids/` records + `/health` give truthful runtime status. |
| One-owner invariant | Explicit shell→service→runtime chain; `.runtime/` PID/port/identity per role. |

## Resolved at L4

- **Identity mechanism (runtime H2 / security MED-1):** the env/CLI `identityToken` scheme is
  dropped (Win32_Process exposes no env; OpenCode `/global/health` returns only `{healthy,version}`).
  Identity = PID (held at spawn) + start-time + exePath + our assigned port, re-verified before any
  kill. Supervision identity (local, non-secret) is distinguished from the ADR 0003 boundary client
  token (a per-launch secret); single-user/single-machine trust boundary stated.
- **Per-run isolation:** via child ENV (`XDG_DATA_HOME` + `OPENCODE_CONFIG_DIR`) — OpenCode has no
  `--data-dir` flag.
- **Orphan reaper:** built by us (reference sweep is Unix-only); graceful loopback shutdown then
  `taskkill /PID <pid> /T /F` or a Win32 Job Object.

## Open items carried to L5/L6

- Confirm Win32 Job Object (preferred) vs `taskkill /T /F` (fallback), or both.
- Confirm the leaf-first stop ordering and per-role graceful timeouts.
