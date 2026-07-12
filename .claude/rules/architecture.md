# Architecture Rules

- UI is a client of a **local application service** bound to **loopback only**.
- Native shell owns only native capabilities (folder picker, PTY, tray, auto-update).
- Business logic is not in UI components.
- Filesystem mutation flows through the execution/application boundary.
- **Permission is checked at the execution boundary**, not just the UI. Deny blocks.
- **One source of truth per state type.** No two parallel session mechanisms; no two
  credential stores; no API keys in browser local storage.
- Provider abstraction is provider-neutral and screen-independent.
- External integrations go through **port/adapter** seams (future: dispatch/fan-out,
  Microsoft automation, knowledge system, LLM gateway — design the boundary only).
- Do not rebuild an existing agent/tool/provider runtime without a clear ADR benefit.
- One component/supervisor owns each child-process lifecycle. PID/port/runtime state
  is tracked consistently under `.runtime/`.
- Avoid abstractions that carry no value; avoid overengineering.
- Every major decision (framework, runtime, storage, IPC, packaging) needs an ADR
  under `docs/architecture/decisions/`.
