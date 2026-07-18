/**
 * ms365-view: builds a plain, secret-free view object matching the renderer's
 * MicrosoftIntegrationView shape from the connector state.
 *
 * Does NOT import renderer types (import-direction rule). Produces a plain object
 * shape declared locally with NO token/secret.
 */

import type { Ms365Connector, Ms365ConnectionState } from "./ms365-connector.js";

export interface Ms365ViewData {
  connectionState: Ms365ConnectionState;
  services: Array<{ id: string; label: string; connected: boolean }>;
  scopes: string[];
  actionHistory: Array<{ label: string; source: string; at?: string }>;
  /** Connected account's non-secret display identity (name/username), when known. */
  account?: { name?: string; username?: string };
  /** Active token expiry as epoch milliseconds, when known (for an honest "hết hạn" state). */
  expiresAtMs?: number;
  error?: string;
}

export function buildMs365View(
  connector: Ms365Connector,
  scopes: readonly string[]
): Ms365ViewData {
  const connectionState = connector.connectionState();
  const lastError = connector.lastError();

  // When connected, show the permissions the account ACTUALLY holds (decoded from the token's
  // scp/roles claims). When not connected, show the static list the app will request.
  const granted = connector.grantedScopes();
  const effectiveScopes =
    connectionState === "connected" && granted.length > 0 ? Array.from(granted) : Array.from(scopes);

  const view: Ms365ViewData = {
    connectionState,
    services: [
      {
        id: "sharepoint",
        label: "SharePoint",
        connected: connectionState === "connected",
      },
    ],
    scopes: effectiveScopes,
    actionHistory: [],
  };

  // Account identity + token expiry (non-secret display claims), only while connected.
  if (connectionState === "connected") {
    const identity = connector.accountIdentity();
    if (identity !== null && (identity.name !== undefined || identity.username !== undefined)) {
      view.account = {
        ...(identity.name !== undefined ? { name: identity.name } : {}),
        ...(identity.username !== undefined ? { username: identity.username } : {}),
      };
    }
    const exp = connector.tokenExpiresAtMs();
    if (exp !== null) view.expiresAtMs = exp;
  }

  // Only include error if it exists (non-null)
  if (lastError !== null) {
    view.error = lastError;
  }

  return view;
}
