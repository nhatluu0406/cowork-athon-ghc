# Coding Rules

## Modularity
- One clear responsibility per module. No God services; no giant `utils`/`helpers`.
- UI must not call filesystem/credential store directly.
- Do not duplicate provider logic, permission logic, or start/stop logic.
- Use port/adapter at real boundaries only.

## File size (production source)
- Target < 250 lines. > 300 triggers a split review. > 400 needs a technical reason a
  reviewer accepts. Do not split mechanically just to hit a number; prefer cohesion.
- Generated files, schemas, fixtures, and migrations may exceed this.
- `.bat` files stay short — entry points only. Move complex logic to a PowerShell/
  Node/Python/Rust CLI or the neutral controller.

## Type safety
- TypeScript: strict mode; avoid `any`; validate at network/IPC/process/persistence
  boundaries; exhaustive state handling; no casts to hide errors.
- Rust/native: explicit error types; no panic on production paths; small native
  boundary; testable.

## Error handling
- Never swallow exceptions; never leave a bare `console.log` as handling.
- Map errors to explicit types; UI errors carry a recovery action when possible.
- Redact secrets before logging; never show raw stack traces to end users.
- Batch scripts propagate child exit codes and never always return 0.

## Dependencies
- Check license and maintenance; don't add a large package for a small need.
- Pin critical dependencies; no out-of-scope major upgrades; ADR for key frameworks.
