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

/** Non-secret account identity decoded from a Graph token for display (never the token itself). */
export interface TokenIdentity {
  readonly name?: string;
  readonly username?: string;
}

/**
 * Decode the connected account's display identity (`name` + `preferred_username`/`upn`) from a
 * Graph token. These are the user's OWN non-secret identity claims (shown as "Đã kết nối: …"),
 * never a credential. Malformed input → `{}`.
 */
export function decodeTokenIdentity(accessToken: string): TokenIdentity {
  const payload = decodePayload(accessToken);
  if (payload === null) return {};
  const name = typeof payload["name"] === "string" ? payload["name"] : undefined;
  const usernameClaim = ["preferred_username", "upn", "unique_name", "email"].find(
    (claim) => typeof payload[claim] === "string" && (payload[claim] as string).length > 0,
  );
  const username = usernameClaim !== undefined ? (payload[usernameClaim] as string) : undefined;
  return {
    ...(name !== undefined ? { name } : {}),
    ...(username !== undefined ? { username } : {}),
  };
}

/** Decode the token's expiry (`exp`, seconds) as epoch milliseconds; `null` when absent/malformed. */
export function decodeTokenExpiry(accessToken: string): number | null {
  const payload = decodePayload(accessToken);
  if (payload === null) return null;
  const exp = payload["exp"];
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
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
