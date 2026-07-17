/**
 * Local barrel for the MCP Phase 1 slice (Wave 2B): persistence-aware HTTP router + the
 * reachability-probe live adapter. The lifecycle itself (add/enable/disable/remove/health,
 * SSRF-guarded URL validation, RE5 isolation) stays in `service/src/extensions/mcp-registry.ts`;
 * this module adds relaunch persistence + the boundary router on top of it.
 */

export {
  createMcpRouter,
  McpRequestError,
  MCP_SERVERS_PATH,
  MCP_SERVER_ITEM_PATH,
  MCP_SERVER_ENABLE_PATH,
  MCP_SERVER_DISABLE_PATH,
  MCP_SERVER_HEALTH_PATH,
  type McpRouterDeps,
} from "./router.js";

export {
  assertValidMcpId,
  mcpHeaderSecretAccount,
  InvalidMcpIdError,
  type McpServerWireView,
} from "./types.js";

export { createProcessMcpAdapter, type ProcessMcpAdapterOptions } from "./process-adapter.js";

export { loadMcpServersFromStore } from "./boot-load.js";
