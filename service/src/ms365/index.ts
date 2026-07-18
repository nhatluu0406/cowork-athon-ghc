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
  createOutlookService,
  type OutlookService,
  type OutlookMessageHit,
} from "./outlook-service.js";

export {
  createPlannerService,
  type PlannerService,
  type PlannerPlan,
  type PlannerTask,
} from "./planner-service.js";

export {
  createListsService,
  type ListsService,
  type ListInfo,
  type ListItem,
} from "./lists-service.js";

export {
  createTeamsService,
  type TeamsService,
  type TeamsChat,
  type TeamsTeam,
  type TeamsChannel,
  type TeamsMember,
  type TeamsMessage,
  type MessageTarget,
} from "./teams-service.js";

export {
  createCalendarService,
  type CalendarService,
  type CalendarEvent,
  type CreateEventInput,
} from "./calendar-service.js";

export {
  createOneDriveService,
  type OneDriveService,
  type OneDriveItem,
} from "./onedrive-service.js";

export {
  createCommonService,
  type CommonService,
  type ResolvedUser,
  type Me,
} from "./common-service.js";

export {
  createPowerAutomateService,
  type PowerAutomateService,
} from "./power-automate-service.js";

export {
  createPowerAutomateStore,
  type PowerAutomateStore,
  type PowerAutomatePersistence,
  type PowerAutomateFlow,
} from "./power-automate-store.js";

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
  MS365_DEVICE_BEGIN_PATH,
  MS365_DEVICE_POLL_PATH,
  MS365_DISCONNECT_PATH,
  MS365_SITES_PATH,
  MS365_SITES_TOGGLE_PATH,
  MS365_WRITE_MODE_PATH,
  MS365_SESSION_SCOPE_PATH,
  type Ms365RouterDeps,
} from "./ms365-tool-router.js";

export {
  createMs365SessionScope,
  type Ms365SessionScope,
} from "./ms365-session-scope.js";

export {
  createSiteScopeStore,
  type SiteScopeStore,
  type SiteScopePersistence,
  type SiteEnabledRecord,
} from "./site-scope-store.js";

export {
  createSiteScopeService,
  type SiteScopeService,
  type JoinedSite,
} from "./site-scope-service.js";

export { createSiteScopeFilePersistence } from "./site-scope-file-persistence.js";

export {
  createWriteModeStore,
  type Ms365WriteMode,
  type WriteModePersistence,
  type WriteModeStore,
} from "./write-mode-store.js";
export { createWriteModeFilePersistence } from "./write-mode-file-persistence.js";


/**
 * Pure reader for the device-code auth env vars (Task 3). Returns a config only when
 * `CGHC_MS365_CLIENT_ID` is a non-empty string; `CGHC_MS365_TENANT` defaults to `"common"`
 * when unset or empty. The composition root uses this to decide whether to construct a
 * {@link createDeviceCodeProvider} and pass it into {@link createMs365Connector}'s `device`
 * dep — no device provider is built when this returns `null`.
 */
export function readMs365DeviceConfig(
  env: Record<string, string | undefined>,
): { clientId: string; tenant: string } | null {
  const clientId = env.CGHC_MS365_CLIENT_ID;
  if (clientId === undefined || clientId === "") {
    return null;
  }
  const tenant = env.CGHC_MS365_TENANT;
  return { clientId, tenant: tenant !== undefined && tenant !== "" ? tenant : "common" };
}
