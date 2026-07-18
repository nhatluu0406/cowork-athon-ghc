/**
 * The gateway proxy's own base URL — an internally-known loopback address, never derived from
 * user input. `assertSafeBaseUrl` (runtime/opencode-config.ts) and `SsrfPolicy` both carry an
 * exact-match allowlist check against whatever this module currently reports, mirroring the
 * existing E2E-mock-LLM escape hatch (`provider/e2e-mock-llm.ts`) — the same pattern, a second
 * exception, not a general loopback/http relaxation.
 *
 * Production binds the FIXED {@link DEFAULT_GATEWAY_PROXY_PORT} (tests override to an ephemeral
 * port via `gatewayProxyPort: 0` to avoid collisions across parallel test workers) so a profile's
 * persisted, gateway-swapped `baseUrl` keeps resolving to the SAME address across a settings-only
 * → live tier transition and across app restarts (2026-07-17 incident: an ephemeral bind meant the
 * NEXT session's proxy address never matched the persisted swap, so the SSRF policy legitimately
 * refused it and the whole live tier failed to start).
 *
 * The exact-match value defaults to the fixed address at module load — recognized even before any
 * `GatewayProxyServer` in THIS process has bound anything. This matters because the live launch
 * path (`buildLiveCoworkOptions` → `resolveProvider`) SSRF-validates the persisted baseUrl BEFORE
 * `createCoworkService`/the gateway proxy for that attempt is even constructed; the exception must
 * not depend on "is a proxy currently listening," only on "is this the recognized gateway address."
 */

export const DEFAULT_GATEWAY_PROXY_HOST = "127.0.0.1";
export const DEFAULT_GATEWAY_PROXY_PORT = 47771;

function defaultGatewayProxyBaseUrl(): string {
  return `http://${DEFAULT_GATEWAY_PROXY_HOST}:${DEFAULT_GATEWAY_PROXY_PORT}/v1`;
}

let currentBaseUrl: string = defaultGatewayProxyBaseUrl();

/** Called by the proxy server once it has actually bound its port (fixed or ephemeral). */
export function setGatewayProxyBaseUrl(url: string): void {
  currentBaseUrl = url;
}

/** Called when the proxy stops — falls back to the fixed default, never `undefined`. */
export function resetGatewayProxyBaseUrl(): void {
  currentBaseUrl = defaultGatewayProxyBaseUrl();
}

export function getGatewayProxyBaseUrl(): string {
  return currentBaseUrl;
}

/** True when `candidateUrl` is exactly this process's current (or default) Gateway proxy base URL. */
export function isGatewayProxyUrl(candidateUrl: string): boolean {
  try {
    const normalize = (u: string): string => new URL(u).href.replace(/\/+$/u, "");
    return normalize(candidateUrl) === normalize(currentBaseUrl);
  } catch {
    return false;
  }
}
