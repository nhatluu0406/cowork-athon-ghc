/**
 * Ms365Connector: single reusable entry point composing a TokenProvider, a GraphClient
 * factory, and a small connection state machine. SharePoint (Task 7) and any future MS365
 * service consume this instead of talking to the token provider / graph client directly.
 *
 * Import-direction note: this module deliberately does NOT import the renderer's
 * `MicrosoftConnectionState` from `app/ui/src/integration-slots.ts` — the service must never
 * depend on renderer code. `Ms365ConnectionState` below is declared independently; its
 * string values intentionally match the renderer enum so Task 8's view mapper can translate
 * service state → renderer contract shape without either side importing the other.
 */
import type { AuthSource, TokenProvider } from "./token-provider.js";
import type { GraphClient } from "./graph-client.js";
import type { DeviceCodePrompt } from "./device-code-provider.js";
import { Ms365Error } from "./ms365-errors.js";
import { decodeTokenScopes, decodeTokenIdentity, decodeTokenExpiry, type TokenIdentity } from "./token-scopes.js";

export type Ms365ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "needs_reconnect"
  | "error";

export interface Ms365Connector {
  connectionState(): Ms365ConnectionState;
  connectWithToken(token: string): Promise<void>;
  disconnect(): Promise<void>;
  graph(): GraphClient;
  source(): AuthSource | null;
  lastError(): string | null;
  beginDeviceCode(): Promise<DeviceCodePrompt>;
  pollDeviceCode(): Promise<"pending" | "connected" | "expired">;
  deviceConfigured(): boolean;
  /** The permissions the connected account actually holds (decoded from the token's `scp`/`roles`). Empty when not connected. */
  grantedScopes(): readonly string[];
  /** The connected account's non-secret display identity (name/username), or `null`. */
  accountIdentity(): TokenIdentity | null;
  /** The active token's expiry as epoch milliseconds, or `null` when unknown/not connected. */
  tokenExpiresAtMs(): number | null;
}

export interface Ms365ConnectorDeps {
  manual: {
    provider: TokenProvider;
    connect(token: string): Promise<void>;
  };
  device?: {
    provider: TokenProvider;
    begin(): Promise<DeviceCodePrompt>;
    poll(): Promise<"pending" | "connected">;
  };
  makeGraph: (getToken: () => Promise<string>) => GraphClient;
  /** Defaults to a lightweight `GET /me` probe. Errors propagate to the caller unchanged. */
  verify?: (graph: GraphClient) => Promise<void>;
}

function notConfiguredError(): Ms365Error {
  return new Ms365Error(
    "not_configured",
    "Chưa cấu hình client ID Microsoft.",
    "Nhờ IT cấp app registration rồi đặt CGHC_MS365_CLIENT_ID.",
    false,
  );
}

async function defaultVerify(graph: GraphClient): Promise<void> {
  await graph.json({ method: "GET", path: "/me" });
}

/**
 * Extracts a non-secret message from a thrown value. Never echoes the raw error object or
 * any field that could carry a token — only the `Error.message` string, which by convention
 * in this codebase (see `Ms365Error`) is already user-safe and secret-free.
 */
function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Microsoft 365 connection failed.";
}

export function createMs365Connector(deps: Ms365ConnectorDeps): Ms365Connector {
  let state: Ms365ConnectionState = "disconnected";
  let activeSource: AuthSource | null = null;
  let error: string | null = null;
  // Permissions the connected account actually holds, decoded from the active token's scp/roles
  // claims after a successful verify. Reset whenever the connection is not established.
  let grantedScopeList: string[] = [];
  let identity: TokenIdentity | null = null;
  let expiresAtMs: number | null = null;

  /** Decode the active provider's token scopes + identity + expiry (never stores/logs the token). */
  async function captureGrantedScopes(): Promise<void> {
    try {
      const token = await activeProvider.getAccessToken();
      grantedScopeList = decodeTokenScopes(token);
      const id = decodeTokenIdentity(token);
      identity = id.name !== undefined || id.username !== undefined ? id : null;
      expiresAtMs = decodeTokenExpiry(token);
    } catch {
      grantedScopeList = [];
      identity = null;
      expiresAtMs = null;
    }
  }

  // Tracks which provider (manual or device) is currently backing `graph()`. Defaults to the
  // manual provider so `graph()` behaves exactly as before when device-code is never used.
  let activeProvider: TokenProvider = deps.manual.provider;

  // Built lazily / on connect, always resolving the token from the active provider so a
  // mid-session token refresh (or re-connect) is picked up transparently on the next call.
  let cachedGraph: GraphClient | null = null;

  function getToken(): Promise<string> {
    return activeProvider.getAccessToken();
  }

  function graph(): GraphClient {
    if (cachedGraph === null) {
      cachedGraph = deps.makeGraph(getToken);
    }
    return cachedGraph;
  }

  const verify = deps.verify ?? defaultVerify;

  return {
    connectionState() {
      return state;
    },

    source() {
      return activeSource;
    },

    lastError() {
      return error;
    },

    graph,

    async connectWithToken(token: string): Promise<void> {
      state = "connecting";
      error = null;
      activeProvider = deps.manual.provider;

      await deps.manual.connect(token);
      // Rebuild the graph client so it is bound to the freshly-connected provider.
      cachedGraph = deps.makeGraph(getToken);

      try {
        await verify(cachedGraph);
        state = "connected";
        activeSource = deps.manual.provider.source;
        error = null;
        await captureGrantedScopes();
      } catch (err) {
        grantedScopeList = [];
        identity = null;
        expiresAtMs = null;
        if (err instanceof Ms365Error && err.kind === "auth_expired") {
          state = "needs_reconnect";
          activeSource = null;
          error = null;
        } else {
          state = "error";
          activeSource = null;
          error = safeErrorMessage(err);
        }
      }
    },

    async disconnect(): Promise<void> {
      await deps.manual.provider.clear();
      if (deps.device !== undefined) await deps.device.provider.clear();
      state = "disconnected";
      activeSource = null;
      error = null;
      cachedGraph = null;
      activeProvider = deps.manual.provider;
      grantedScopeList = [];
      identity = null;
      expiresAtMs = null;
    },

    grantedScopes(): readonly string[] {
      return grantedScopeList;
    },

    accountIdentity(): TokenIdentity | null {
      return identity;
    },

    tokenExpiresAtMs(): number | null {
      return expiresAtMs;
    },

    deviceConfigured(): boolean {
      return deps.device !== undefined;
    },

    async beginDeviceCode(): Promise<DeviceCodePrompt> {
      if (deps.device === undefined) {
        throw notConfiguredError();
      }
      state = "connecting";
      error = null;
      return await deps.device.begin();
    },

    async pollDeviceCode(): Promise<"pending" | "connected" | "expired"> {
      if (deps.device === undefined) {
        throw notConfiguredError();
      }
      const device = deps.device;
      const r = await device.poll();
      if (r === "pending") {
        return "pending";
      }

      // r === "connected": the device-code token exchange succeeded; bind graph() to the
      // device provider and verify it against Graph before declaring the connector connected.
      activeProvider = device.provider;
      cachedGraph = deps.makeGraph(getToken);

      try {
        await verify(cachedGraph);
        state = "connected";
        activeSource = device.provider.source;
        error = null;
        await captureGrantedScopes();
        return "connected";
      } catch (err) {
        grantedScopeList = [];
        identity = null;
        expiresAtMs = null;
        if (err instanceof Ms365Error && err.kind === "auth_expired") {
          state = "disconnected";
          activeSource = null;
          error = null;
          return "expired";
        }
        // Non-auth_expired verify failure (e.g. graph_error, network failure): the connector's
        // state is now "error", so the return value must never claim "connected" — that would
        // let a caller trust a success return while connectionState() disagrees. Throw instead
        // so the caller either gets a valid status or an exception, never both signals at once.
        state = "error";
        activeSource = null;
        error = safeErrorMessage(err);
        throw err;
      }
    },
  };
}
