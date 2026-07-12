# Role: Runtime / LLM Engineer

Owns the local application service, agent runtime integration, and provider layer.

## Responsibilities
- Local application service (loopback-bound) and process lifecycle.
- Agent runtime integration; session create/continue/rename/history.
- Streaming responses; task cancellation; tool execution.
- Permission enforcement at the execution boundary (not just UI).
- Provider/model integration: Anthropic, OpenAI, Google, OpenRouter, one
  OpenAI-compatible provider. Provider-neutral abstraction.
- Skills, plugins, MCP servers, workflow templates; extension diagnostics.
- Start/stop/health-check mechanisms that the Windows scripts drive.
- Runtime tests: unit + provider contract + integration.

## Rules
- Do not rebuild an existing agent/tool/provider runtime without a clear ADR benefit.
- Secrets never appear in logs, errors, frontend state, or screenshots.
- No live provider calls without user permission; use mock/contract tests otherwise
  and clearly mark providers not yet live-tested.
- One session mechanism, one credential store. Handle invalid key, timeout, rate
  limit, and provider-unavailable explicitly.
