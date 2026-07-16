/**
 * Best-effort OpenAI-compatible model discovery (Wave 3). A bounded GET against the
 * endpoint's `{base}/models`, using the SAME security primitives as the connection probe
 * (CGHC-010/011): SSRF validation of the base_url, the IP-pinning dialer, and the F2
 * socket-pin assertion. It reads the response body (unlike the probe) to parse the standard
 * `data[].id` list.
 *
 * NON-BLOCKING by contract: discovery is a convenience, never a gate. Every failure — an
 * SSRF refusal, a redirect, a 404/405 (endpoint without discovery), a timeout, or a
 * malformed body — resolves to a mapped, non-secret {@link ModelDiscoveryResult} with
 * `ok: false`; the caller keeps manual model-id entry available. No exotic providers are
 * assumed: we parse ONLY the standard OpenAI list shape and nothing vendor-specific.
 *
 * Secret discipline (non-negotiable): the key value is produced ONLY by
 * {@link CredentialResolver.resolveInjection} (scrubber-registered), placed ONLY into the
 * Authorization header, and NEVER echoed into a return value, log, or error. Errors are
 * mapped through {@link mapProviderError} (status/kind only). A redirect is REFUSED, not
 * followed, so the credential is never resent to a different host.
 */

import type {
  CredentialRef,
  ModelDiscoveryResult,
  ProviderError,
} from "@cowork-ghc/contracts";
import type { ProviderEnvSpec } from "@cowork-ghc/runtime";
import type { ConnectTarget, SsrfPolicy } from "./ssrf-policy.js";
import { orderConnectCandidates } from "./ssrf-policy.js";
import type { CredentialResolver } from "./http-connector.js";
import { SocketPinViolationError } from "./http-connector.js";
import { createHttpsDialer, type HttpDialer, type HttpProbeResponse } from "./http-dialer.js";
import { mapProviderError } from "./error-map.js";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

/** A non-secret "discovery is not available here" result the UI treats as manual-entry fallback. */
const DISCOVERY_UNSUPPORTED: ProviderError = {
  kind: "unavailable",
  message: "Endpoint không hỗ trợ liệt kê model (dò model không khả dụng).",
  retryable: false,
  recovery: "Nhập Model ID thủ công.",
};

/** A non-secret "the endpoint returned an unexpected shape" result. */
const DISCOVERY_MALFORMED: ProviderError = {
  kind: "unknown",
  message: "Endpoint trả về danh sách model không đúng định dạng.",
  retryable: false,
  recovery: "Nhập Model ID thủ công.",
};

export interface ModelDiscoveryTarget {
  /** The user-supplied base_url of the OpenAI-compatible endpoint (SSRF-validated here). */
  readonly baseUrl: string;
  /** The bound credential HANDLE (resolved late; key bytes never enter this module's state). */
  readonly credentialRef: CredentialRef;
  /** Env spec labelling the scrubber registration for the resolved key. */
  readonly envSpec: ProviderEnvSpec;
}

export interface ModelDiscovery {
  discover(target: ModelDiscoveryTarget): Promise<ModelDiscoveryResult>;
}

export interface ModelDiscoveryOptions {
  readonly ssrf: SsrfPolicy;
  readonly credentials: CredentialResolver;
  /** Injected dial seam; defaults to the real IP-pinning HTTPS dialer. Tests inject a fake. */
  readonly dialer?: HttpDialer;
  /** Hard per-probe time bound (ms). Default 8s — quick, bounded, no retry loop. */
  readonly timeoutMs?: number;
  /** Cap on the captured body (bytes). */
  readonly maxBodyBytes?: number;
}

/** Derive `{base}/models` from a validated target (same host → same pinned IP). */
function modelsUrl(target: ConnectTarget): URL {
  const url = new URL(target.url.href);
  const base = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${base}/models`;
  url.search = "";
  url.hash = "";
  return url;
}

/**
 * Parse the standard OpenAI-compatible model list (`{ data: [{ id }] }`). Returns the sorted,
 * de-duplicated ids, or `null` when the shape is not the standard list (malformed / unsupported).
 */
export function parseModelList(bodyText: string | undefined): string[] | null {
  if (bodyText === undefined || bodyText.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const data = (parsed as Record<string, unknown>)["data"];
  if (!Array.isArray(data)) return null;
  const ids = new Set<string>();
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    const id = (entry as Record<string, unknown>)["id"];
    if (typeof id === "string" && id.trim().length > 0) ids.add(id.trim());
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/** Build the model-discovery probe. */
export function createModelDiscovery(options: ModelDiscoveryOptions): ModelDiscovery {
  const { ssrf, credentials } = options;
  const dialer = options.dialer ?? createHttpsDialer();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return {
    async discover(target: ModelDiscoveryTarget): Promise<ModelDiscoveryResult> {
      // SSRF-validate + re-resolve the base_url at discovery time (DNS-rebinding guard).
      let connectTarget: ConnectTarget;
      try {
        connectTarget = await ssrf.assertAllowed(target.baseUrl);
      } catch {
        return { ok: false, error: DISCOVERY_UNSUPPORTED };
      }

      const url = modelsUrl(connectTarget);
      // IP-pinned Happy-Eyeballs: try the resolver's first address, then a DIFFERENT family, so a
      // dual-stack host with a dead IPv6 route falls back to IPv4. Every candidate is SSRF-validated.
      const candidates = orderConnectCandidates(connectTarget.resolved);
      if (candidates.length === 0) return { ok: false, error: DISCOVERY_UNSUPPORTED };

      const injection = await credentials.resolveInjection(target.credentialRef, target.envSpec);
      const headers = {
        authorization: `Bearer ${injection.value}`,
        accept: "application/json",
      };

      let response: HttpProbeResponse | undefined;
      let pin = candidates[0]!;
      let lastError: unknown;
      for (const candidate of candidates) {
        try {
          response = await dialer({
            url,
            ip: candidate.address,
            family: candidate.family,
            headers,
            timeoutMs,
            method: "GET",
            readBody: true,
            maxBodyBytes,
          });
          pin = candidate;
          break;
        } catch (cause) {
          lastError = cause;
        }
      }
      if (response === undefined) {
        // Timeout / socket failure on every candidate → mapped, non-secret error (non-blocking).
        return { ok: false, error: mapProviderError(lastError) };
      }

      // F2: the socket MUST have used the exact validated IP (never trust re-resolution).
      const validated = connectTarget.resolved.some((a) => a.address === response.dialedIp);
      if (response.dialedIp !== pin.address || !validated) {
        throw new SocketPinViolationError(pin.address, response.dialedIp);
      }

      // A redirect is REFUSED, not followed — the credential is never resent to another host.
      if (response.status >= 300 && response.status < 400) {
        return { ok: false, error: DISCOVERY_UNSUPPORTED };
      }
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, error: mapProviderError({ status: response.status }) };
      }

      const models = parseModelList(response.bodyText);
      if (models === null) return { ok: false, error: DISCOVERY_MALFORMED };
      return { ok: true, models };
    },
  };
}
