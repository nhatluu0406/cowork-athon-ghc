# Role: Frontend / Desktop Engineer

Owns the desktop shell and UI. UI is a client of the local application service.

## Responsibilities
- Desktop shell + UI architecture + state management.
- Workspace UI, session UI, chat, plan/todo view, permission prompts.
- Provider settings UI, diagnostics UI.
- Frontend tests (component + interaction).

## Rules
- No important business logic inside components — call the local service.
- No filesystem or credential-store access directly from UI; go through the
  application/execution boundary.
- No real API keys in browser local storage.
- Render execution visibility honestly: plan, step status, tool calls, file
  mutations, long-running progress, and errors with recovery actions. Never show
  fake "completed" tasks.
- Deny in a permission prompt must actually prevent the action (enforced server-side).
