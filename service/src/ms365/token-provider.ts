/**
 * TokenProvider seam. Two adapters (manual paste here; device code in a later module) satisfy
 * the SAME interface so the connector is auth-source agnostic. The manual token is held in
 * memory for the session AND persisted via the credential store so a relaunch can retry it;
 * a stale token surfaces as a Graph 401, which the connector maps to needs_reconnect.
 */
import type { CredentialService } from "../credential/index.js";

export type AuthSource = "manual_token" | "device_code";

export interface TokenProvider {
  readonly source: AuthSource;
  getAccessToken(): Promise<string>;
  isValid(): Promise<boolean>;
  clear(): Promise<void>;
}

const MS365_ACCOUNT = "ms365";

export interface ManualTokenDeps {
  readonly credentials: CredentialService;
  readonly account?: string;
}

export function createManualTokenProvider(deps: ManualTokenDeps): {
  provider: TokenProvider;
  connect(accessToken: string): Promise<void>;
} {
  const providerId = deps.account ?? MS365_ACCOUNT;
  let token: string | null = null;
  let ref = null as Awaited<ReturnType<CredentialService["store"]>> | null;

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
      if (ref !== null) await deps.credentials.remove(ref);
      token = null;
      ref = null;
    },
  };

  return {
    provider,
    async connect(accessToken: string) {
      if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
        throw new Error("Access token must be a non-empty string.");
      }
      token = accessToken.trim();
      ref = await deps.credentials.store({ providerId, secret: token });
    },
  };
}
