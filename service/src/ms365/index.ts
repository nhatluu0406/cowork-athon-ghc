/**
 * Local barrel for the MS365 unit (SharePoint over Microsoft Graph). Consumers import from
 * this barrel: `../ms365/index.js`. The top-level `service/src/index.ts` orchestrator wires
 * `createMs365Router`'s router onto the CGHC-002 loopback boundary with the token guard —
 * this is an internal service tool reached over loopback HTTP, NOT an MCP server.
 */

export {
  Ms365Error,
  mapGraphStatus,
  type Ms365ErrorKind,
} from "./ms365-errors.js";

export {
  createHttpGraphClient,
  type HttpGraphClient,
  type HttpGraphClientOptions,
  type GraphClient,
  type GraphClientRequest,
} from "./graph-client.js";

export {
  createManualTokenProvider,
  type AuthSource,
  type TokenProvider,
  type ManualTokenDeps,
} from "./token-provider.js";

export {
  createDeviceCodeProvider,
  type DeviceCodePrompt,
  type DeviceCodeConfig,
  type DeviceCodeDeps,
} from "./device-code-provider.js";

export {
  createMs365Connector,
  type Ms365Connector,
  type Ms365ConnectorDeps,
  type Ms365ConnectionState,
} from "./ms365-connector.js";

export {
  createSharePointService,
  type SharePointService,
  type SharePointHit,
  type LocalFileReader,
  type SharePointServiceDeps,
} from "./sharepoint-service.js";

export { buildMs365View, type Ms365ViewData } from "./ms365-view.js";

export {
  handleToolCall,
  type ToolCall,
  type ToolResult,
  type ToolDeps,
  type Ms365ToolName,
} from "./ms365-tools.js";

export {
  createMs365Router,
  Ms365RouterRequestError,
  MS365_TOOL_CALL_PATH,
  MS365_CONNECT_PATH,
  MS365_VIEW_PATH,
  type Ms365RouterDeps,
} from "./ms365-tool-router.js";

/**
 * Feature-flag gate for the whole MS365 unit (Task 11). OFF (`false`) unless the env var is
 * EXACTLY `"1"` or `"true"` — every other value, including `undefined`, `"0"`, `"false"`, or
 * any other string, is OFF. This is the ONLY switch the composition root reads to decide
 * whether to construct the connector and mount {@link createMs365Router}; default-OFF keeps
 * the baseline service byte-for-byte unaffected when the var is unset.
 */
export function isMs365Enabled(env: Record<string, string | undefined>): boolean {
  return env.CGHC_MS365_ENABLED === "1" || env.CGHC_MS365_ENABLED === "true";
}
