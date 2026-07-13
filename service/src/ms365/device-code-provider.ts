/**
 * Device-code OAuth 2.0 adapter for Microsoft identity (login.microsoftonline.com).
 * Implements the same TokenProvider seam as the manual-token adapter (Task 4) so the
 * connector is auth-source agnostic. This module is CODED but GATED behind a feature
 * flag at composition time (Task 11) until a real Azure app registration exists.
 *
 * No fake "connected" state: `poll()` only returns "connected" after Microsoft's token
 * endpoint returns a real access/refresh token pair. No client secret is used (device
 * code is a public-client flow) and no token/secret is ever logged.
 */
import type { SsrfPolicy } from "../provider/index.js";
import type { TokenProvider, AuthSource } from "./token-provider.js";
import { Ms365Error } from "./ms365-errors.js";

export interface DeviceCodePrompt {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresInSec: number;
}

export interface DeviceCodeConfig {
  readonly clientId: string;
  readonly tenant?: string;
  readonly scopes: readonly string[];
}

export interface DeviceCodeDeps {
  readonly ssrf: SsrfPolicy;
  readonly fetchFn?: typeof fetch;
  readonly config: DeviceCodeConfig;
  readonly now?: () => number;
}

interface DeviceCodeTokenResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly error?: string;
}

interface DeviceCodeBeginResponse {
  readonly user_code?: string;
  readonly verification_uri?: string;
  readonly expires_in?: number;
  readonly device_code?: string;
}

const SOURCE: AuthSource = "device_code";
const REFRESH_WINDOW_MS = 60_000;

async function postForm(
  ssrf: SsrfPolicy,
  fetchFn: typeof fetch,
  url: string,
  params: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  await ssrf.assertAllowed(url);
  const body = new URLSearchParams(params).toString();
  const res = await fetchFn(url, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

export function createDeviceCodeProvider(deps: DeviceCodeDeps): {
  provider: TokenProvider;
  begin(): Promise<DeviceCodePrompt>;
  poll(): Promise<"pending" | "connected">;
} {
  const tenant = deps.config.tenant ?? "common";
  const authBase = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  const now = deps.now ?? (() => Date.now());
  const doFetch = deps.fetchFn ?? fetch;
  const scope = deps.config.scopes.join(" ");

  let deviceCode: string | null = null;
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  let expiresAt: number | null = null;

  function hasUsableToken(): boolean {
    return accessToken !== null && refreshToken !== null && expiresAt !== null;
  }

  async function refresh(): Promise<void> {
    if (refreshToken === null) {
      throw new Ms365Error(
        "auth_expired",
        "Microsoft 365 device-code session has no refresh token.",
        "Kết nối lại Microsoft 365.",
        false,
      );
    }
    let result: { status: number; body: unknown };
    try {
      result = await postForm(deps.ssrf, doFetch, `${authBase}/token`, {
        grant_type: "refresh_token",
        client_id: deps.config.clientId,
        refresh_token: refreshToken,
        scope,
      });
    } catch {
      throw new Ms365Error(
        "auth_expired",
        "Failed to refresh Microsoft 365 device-code token.",
        "Kết nối lại Microsoft 365.",
        false,
      );
    }
    const body = result.body as DeviceCodeTokenResponse;
    if (result.status !== 200 || typeof body.access_token !== "string" || typeof body.refresh_token !== "string" || typeof body.expires_in !== "number") {
      accessToken = null;
      refreshToken = null;
      expiresAt = null;
      throw new Ms365Error(
        "auth_expired",
        "Microsoft 365 device-code refresh was rejected.",
        "Kết nối lại Microsoft 365.",
        false,
      );
    }
    accessToken = body.access_token;
    refreshToken = body.refresh_token;
    expiresAt = now() + body.expires_in * 1000;
  }

  const provider: TokenProvider = {
    source: SOURCE,
    async getAccessToken() {
      if (!hasUsableToken()) {
        throw new Error("No MS365 device-code token; complete device-code sign-in first.");
      }
      if (expiresAt !== null && now() >= expiresAt - REFRESH_WINDOW_MS) {
        await refresh();
      }
      if (accessToken === null) {
        throw new Ms365Error(
          "auth_expired",
          "Microsoft 365 device-code token is unavailable after refresh.",
          "Kết nối lại Microsoft 365.",
          false,
        );
      }
      return accessToken;
    },
    async isValid() {
      if (!hasUsableToken()) return false;
      if (expiresAt !== null && now() >= expiresAt - REFRESH_WINDOW_MS) {
        return refreshToken !== null;
      }
      return true;
    },
    async clear() {
      deviceCode = null;
      accessToken = null;
      refreshToken = null;
      expiresAt = null;
    },
  };

  return {
    provider,
    async begin(): Promise<DeviceCodePrompt> {
      const url = `${authBase}/devicecode`;
      await deps.ssrf.assertAllowed(url);
      const res = await doFetch(url, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: deps.config.clientId, scope }).toString(),
      });
      const body = (await res.json()) as DeviceCodeBeginResponse;
      if (
        typeof body.user_code !== "string" ||
        typeof body.verification_uri !== "string" ||
        typeof body.expires_in !== "number" ||
        typeof body.device_code !== "string"
      ) {
        throw new Ms365Error(
          "graph_error",
          "Microsoft 365 device-code request returned an unexpected response.",
          "Thử lại sau ít phút.",
          true,
        );
      }
      deviceCode = body.device_code;
      return {
        userCode: body.user_code,
        verificationUri: body.verification_uri,
        expiresInSec: body.expires_in,
      };
    },
    async poll(): Promise<"pending" | "connected"> {
      if (deviceCode === null) {
        throw new Error("Device-code flow not started; call begin() first.");
      }
      const result = await postForm(deps.ssrf, doFetch, `${authBase}/token`, {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: deps.config.clientId,
        device_code: deviceCode,
      });
      const body = result.body as DeviceCodeTokenResponse;
      if (result.status === 400 && body.error === "authorization_pending") {
        return "pending";
      }
      if (result.status === 200 && typeof body.access_token === "string" && typeof body.refresh_token === "string" && typeof body.expires_in === "number") {
        accessToken = body.access_token;
        refreshToken = body.refresh_token;
        expiresAt = now() + body.expires_in * 1000;
        return "connected";
      }
      throw new Ms365Error(
        "graph_error",
        "Microsoft 365 device-code polling failed.",
        "Thử lại sau ít phút.",
        true,
      );
    },
  };
}
