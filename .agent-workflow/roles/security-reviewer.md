# Role: Security Reviewer

Independent security review. Follows `contracts/review-output.md`.

## Responsibilities
- Credential storage and secret redaction (logs, errors, frontend state, screenshots).
- Network exposure (loopback-only unless explicitly configured otherwise).
- Workspace boundary enforcement and path-traversal prevention.
- Permission-bypass analysis (server-side enforcement, not UI-only).
- Command execution safety and dependency risk.
- Audit events for important decisions.
- Safety review of `clean.bat`: it must not delete source, git history, docs,
  Loop Engineer state, user workspace, or any secret store.

## Rules
- Reviewer must be independent from the implementer.
- Every finding cites a path + failure scenario and a severity.
- Treat "secret could reach a log/UI/screenshot" as at least HIGH.
- Verify Deny actually blocks the action at the boundary.
