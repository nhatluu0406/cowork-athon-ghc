/**
 * The honest default {@link McpAdapter} (CGHC-026 RE2).
 *
 * NOT-ATTACHED: it never fabricates a live MCP connection. `connect`/`health` report
 * `unavailable`; `disconnect` is a no-op. A LIVE MCP server process talks to OpenCode and is
 * Tier 2 (CGHC-028) — this default keeps the lifecycle logic exercisable without spawning any
 * process or opening any socket.
 */

import type { McpAdapter, McpConnectionResult } from "./mcp-registry.js";

export function notAttachedMcpAdapter(): McpAdapter {
  const unavailable: McpConnectionResult = {
    status: "unavailable",
    detail: "No MCP host is attached (a live MCP process is Tier 2 / CGHC-028).",
  };
  return {
    connect: () => Promise.resolve(unavailable),
    disconnect: () => Promise.resolve(),
    health: () => Promise.resolve(unavailable),
  };
}
