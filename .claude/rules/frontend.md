# Frontend Rules

- UI is a client of the local application service; no important business logic in
  components.
- No direct filesystem or credential-store access from the UI.
- State management has a single source of truth per state type; avoid duplicating
  server state in ad-hoc component state.
- Render execution visibility honestly: plan/todo, per-step status, tool calls, file
  mutations, long-running progress, and errors with recovery actions. Never render a
  fake "completed" state.
- Permission prompts: Allow/Deny map to real server-side enforcement. A Deny in the UI
  must actually prevent the action.
- Streaming must not block the UI thread; avoid unnecessary re-renders during token
  streaming.
- Accessibility: keyboard navigable, sufficient contrast, focus management, and
  screen-reader labels on interactive controls.
- Secrets are never placed in client state, DOM, or logs.
