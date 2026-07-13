# Security Rules

- **Secrets never appear** in logs, error messages, frontend state, or screenshots.
  Redact before any log write.
- No real API keys in browser local storage. Store credentials in a secure OS-backed
  store (e.g. Windows Credential Manager) or an equivalent decided by ADR.
- One credential store only. Provider keys are referenced, not embedded in state.
- **Workspace boundary**: file operations are confined to the granted workspace.
  Prevent path traversal (`..`, absolute escapes, symlink escapes, UNC surprises).
- **Permission enforced at the execution boundary**, not the UI. Deny actually blocks.
  Sensitive actions carry an appropriate approval level; log a local audit event for
  important decisions.
- Local service binds loopback only unless an ADR explicitly configures otherwise.
- Command execution is constrained and reviewed; no unverified downloaded executables.
- Dependency risk reviewed (license + maintenance). Pin critical deps.

## Windows scripts
- `.bat` files never require Administrator unless proven necessary, never change
  system execution policy, never silently install system software, never download
  unverified executables, and never fake success.
- `clean.bat` deletes only allowlisted generated/downloaded/runtime-temp paths from
  the cleanup manifest. It must NEVER delete: `.git/`, source code, `docs/`,
  `.claude/`, `.agents/`, `CLAUDE.md`, `AGENTS.md`, user workspace, credentials,
  or user-created config/session data.
- Every path is validated against the allowlist before deletion; refuse to run if the
  project root cannot be determined with certainty; no dangerous wildcards on
  unvalidated paths; no deletion of root/parent directories.
