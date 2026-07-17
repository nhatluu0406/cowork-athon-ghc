/**
 * TokenProvider seam. Two adapters (manual paste here; device code in a later module) satisfy
 * the SAME interface so the connector is auth-source agnostic.
 *
 * The manual token is held IN MEMORY for the session only — it is deliberately NOT persisted to
 * the OS credential store. A real Microsoft Graph access token is a JWT of ~2–5 KB, which exceeds
 * the Windows Credential Manager blob limit (~2560 bytes); persisting it there fails the write.
 * Manual tokens are short-lived (~1h) and relaunch-reuse is out of scope, so keeping the token in
 * memory (never on disk, never in the renderer/logs) is both correct and simpler. A stale/expired
 * token surfaces as a Graph 401, which the connector maps to needs_reconnect.
 */

export type AuthSource = "manual_token" | "device_code";

export interface TokenProvider {
  readonly source: AuthSource;
  getAccessToken(): Promise<string>;
  isValid(): Promise<boolean>;
  clear(): Promise<void>;
}

export interface ManualTokenDeps {
  /** Optional account label; unused for storage (in-memory only) but kept for symmetry/telemetry. */
  readonly account?: string;
}

export function createManualTokenProvider(_deps: ManualTokenDeps = {}): {
  provider: TokenProvider;
  connect(accessToken: string): Promise<void>;
} {
  let token: string | null = null;

  const provider: TokenProvider = {
    source: "manual_token",
    async getAccessToken() {
      if (token === null) throw new Error("No MS365 token; connect first.");
      return token;
    },
    async isValid() {
      return token !== null;
    },
    async clear() {
      token = null;
    },
  };

  return {
    provider,
    async connect(accessToken: string) {
      if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
        throw new Error("Access token must be a non-empty string.");
      }
      // In-memory only — no OS credential store write (Windows CredWrite blob-size limit).
      token = accessToken.trim();
    },
  };
}
