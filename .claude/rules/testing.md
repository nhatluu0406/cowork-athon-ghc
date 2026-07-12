# Testing Rules

## Required unit tests
Domain services, workspace validation, permission decisions, provider configuration,
model selection, secret redaction, event reducer/state machine, session logic,
template logic, error mapping, contract mapping, controller state/fingerprint logic,
runtime process identity, cleanup-manifest validation, path allowlist, PID state
parsing, start/stop orchestration logic.

## Provider contract tests
Connect, auth error, configured model, streaming, timeout, cancellation, rate limit,
provider error mapping, secret redaction. Every provider adapter reuses the same
contract suite where feasible.

## Integration tests
UI↔service, service↔runtime, session lifecycle, streaming lifecycle, permission round
trip, filesystem mutation, credential reference, MCP lifecycle, persistence, restart/
resume, process supervisor, health check, start/stop lifecycle, cleanup manifest.

## E2E critical path
init.bat → deps ready → start.bat → app up → pick workspace → provider settings →
configure → test connection → pick model → new session → prompt → streaming →
plan/todo → permission request → allow/deny → verify file on disk → stop.bat →
processes stopped → reopen → resume session → run template → provider error →
clean.bat (test env) → correct data removed, preserved data intact.

## Negative tests
Invalid/missing key, timeout, HTTP 429, network loss, runtime won't start, port taken,
missing/permission-lost workspace, path traversal, locked file, MCP dead, stream
interrupted, corrupt settings, app closed mid-task, permission Deny, multiple
instances, orphan child, start-before-init, start twice, stop-before-start, stale PID,
dependency download failure, missing toolchain, path with spaces, path with Unicode,
script run from Explorer with a different CWD, clean-while-running, clean with locked
file, clean of a non-allowlisted path, corrupt cleanup manifest, corrupt runtime state.

## Policy
- No hollow global coverage target. Prioritize: credentials, permission, filesystem,
  session state, provider adapters, persistence/migration, process lifecycle, cleanup.
- Never modify implementation to make a failing test pass falsely.
- Live LLM tests are separate, opt-in, bounded (few requests, short prompt, low-cost
  model, no infinite retry, no credential in logs).
