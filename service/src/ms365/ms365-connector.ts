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
import { Ms365Error } from "./ms365-errors.js";

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
}

export interface Ms365ConnectorDeps {
  manual: {
    provider: TokenProvider;
    connect(token: string): Promise<void>;
  };
  makeGraph: (getToken: () => Promise<string>) => GraphClient;
  /** Defaults to a lightweight `GET /me` probe. Errors propagate to the caller unchanged. */
  verify?: (graph: GraphClient) => Promise<void>;
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

  // Built lazily / on connect, always resolving the token from the active provider so a
  // mid-session token refresh (or re-connect) is picked up transparently on the next call.
  let cachedGraph: GraphClient | null = null;

  function getToken(): Promise<string> {
    return deps.manual.provider.getAccessToken();
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

      await deps.manual.connect(token);
      // Rebuild the graph client so it is bound to the freshly-connected provider.
      cachedGraph = deps.makeGraph(getToken);

      try {
        await verify(cachedGraph);
        state = "connected";
        activeSource = deps.manual.provider.source;
        error = null;
      } catch (err) {
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
      state = "disconnected";
      activeSource = null;
      error = null;
      cachedGraph = null;
    },
  };
}
