/**
 * Decode the granted permissions from a Microsoft Graph access token for DISPLAY only.
 *
 * A Graph access token is a JWT whose payload carries the delegated scopes in the `scp` claim
 * (a space-separated string) and any app-role permissions in the `roles` claim (a string array).
 * This reads those claims so the UI can show the permissions the connected account actually holds,
 * rather than the static list the app requests.
 *
 * SECURITY / discipline:
 *  - The signature is NOT verified here — the token was already accepted by Graph at the connect
 *    verify step (`GET /me`); this decode is purely to surface non-secret scope strings.
 *  - The token itself is never logged or returned; only the extracted scope strings leave here.
 *  - Any malformed/non-JWT input yields `[]` rather than throwing, so a surprising token shape can
 *    never break the connect flow.
 */

function decodePayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (payload === undefined || payload.length === 0) return null;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extract the granted scopes (`scp` delegated + `roles` app permissions) from a Graph token. */
export function decodeTokenScopes(accessToken: string): string[] {
  const payload = decodePayload(accessToken);
  if (payload === null) return [];

  const scopes: string[] = [];

  const scp = payload["scp"];
  if (typeof scp === "string") {
    for (const s of scp.split(" ")) {
      if (s.length > 0) scopes.push(s);
    }
  }

  const roles = payload["roles"];
  if (Array.isArray(roles)) {
    for (const r of roles) {
      if (typeof r === "string" && r.length > 0) scopes.push(r);
    }
  }

  return scopes;
}
