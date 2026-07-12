/**
 * The REAL {@link ProviderConnector} behind {@link ProviderPort.testConnection} (CGHC-011,
 * PR3). A bounded HTTP connection probe: it resolves the bound credential late, injects it
 * as an auth header, dials an auth-gated endpoint pinned to the SSRF-validated IP, and maps
 * the outcome to a {@link TestResult} (2xx → ok; 401/403 → auth error; timeout → PR7 timeout).
 *
 * Secret discipline (non-negotiable): the key value is produced ONLY by
 * {@link CredentialResolver.resolveInjection} (which registers it with the shared scrubber),
 * placed ONLY into an Authorization-style header, and NEVER echoed to a return value, log,
 * or thrown error. Errors are mapped through {@link mapProviderError} (status/kind only).
 *
 * TWO CARRY-FORWARD SECURITY GATES from the CGHC-010 review are enforced here:
 *  - F2 (socket-IP pin): after dialing, the connector asserts the socket's actual remote IP
 *    equals the exact validated IP it pinned — the port-validated hostname alone is NEVER
 *    trusted, because Node/undici would re-resolve at connect time and defeat the
 *    DNS-rebinding guard. See {@link SocketPinViolationError} throw below.
 *  - F3 (redirect revalidation): a 3xx is NOT transparently auto-followed. The `Location`
 *    host+IP is re-checked through the SSRF guard before following; a redirect to a
 *    private/metadata/loopback host is refused (and the credential is never resent to a
 *    different host).
 *
 * STREAMING is a SEPARATE carry-forward: the OpenCode streaming path (CGHC-012) re-resolves
 * DNS at its OWN socket, outside this probe. `testConnection` is the guarded, IP-pinned call
 * WE control; hardening the streaming socket is owned by the streaming task, not this one.
 * {@link ProviderConnector.cancel} therefore stays a no-op here (no stream is opened).
 */

import type { CredentialRef, ProviderId, TestResult } from "@cowork-ghc/contracts";
import type { ProviderEnvSpec, ProviderKeyInjection } from "@cowork-ghc/runtime";
import type { ConnectTarget, SsrfPolicy } from "./ssrf-policy.js";
import type { ProviderConnector, StreamHandle } from "./provider-port.js";
import { providerEnvSpec, isCustomEndpoint } from "./descriptors.js";
import { mapProviderError } from "./error-map.js";
import { authHeadersFor, probeUrlFor } from "./probe-profiles.js";
import { createHttpsDialer, type HttpDialer, type HttpProbeResponse } from "./http-dialer.js";

/** The minimal credential capability the connector needs (decoupled from the full service). */
export interface CredentialResolver {
  resolveInjection(ref: CredentialRef, spec: ProviderEnvSpec): Promise<ProviderKeyInjection>;
}

export interface HttpConnectorOptions {
  /** The SSRF policy — re-runs on every redirect target (F3) and validates built-in hosts. */
  readonly ssrf: SsrfPolicy;
  /** Resolves a key value late (SOLE point it leaves the store; scrubber-registered). */
  readonly credentials: CredentialResolver;
  /** The bound credential handle for a provider (or `undefined` when none is configured). */
  readonly credentialRefFor: (id: ProviderId) => CredentialRef | undefined;
  /** Injected dial seam; defaults to the real IP-pinning HTTPS dialer. Tests inject a fake. */
  readonly dialer?: HttpDialer;
  /** Hard per-probe time bound (ms). Default 10s — bounded, no retry loop. */
  readonly timeoutMs?: number;
  /** Max redirect hops to follow after SSRF revalidation. Default 3 (bounded). */
  readonly maxRedirects?: number;
  /** Env spec resolver (labels the scrubber registration). Defaults to descriptor lookup. */
  readonly envSpecFor?: (id: ProviderId) => ProviderEnvSpec;
}

/** F2: the socket connected to an IP the SSRF policy never validated. Message is non-secret. */
export class SocketPinViolationError extends Error {
  readonly expectedIp: string;
  readonly actualIp: string;
  constructor(expectedIp: string, actualIp: string) {
    super(
      `Socket dialed an unvalidated IP (pinned ${expectedIp}, connected ${actualIp}); ` +
        "refusing the connection (DNS-rebinding guard, CGHC-010 F2).",
    );
    this.name = "SocketPinViolationError";
    this.expectedIp = expectedIp;
    this.actualIp = actualIp;
  }
}

/** A redirect that would send the credential to a DIFFERENT host is refused (no key leak). */
export class CrossHostRedirectError extends Error {
  constructor(fromHost: string, toHost: string) {
    super(`Refusing a cross-host redirect (${fromHost} → ${toHost}); the credential is not resent.`);
    this.name = "CrossHostRedirectError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function defaultEnvSpec(id: ProviderId): ProviderEnvSpec {
  return isCustomEndpoint(id) ? providerEnvSpec(id, "CUSTOM_OPENAI_COMPAT_API_KEY") : providerEnvSpec(id);
}

/** Build the real HTTP-probe connector. `probe` runs through the port's SSRF guard already. */
export function createHttpConnector(options: HttpConnectorOptions): ProviderConnector {
  const { ssrf, credentials, credentialRefFor } = options;
  const dialer = options.dialer ?? createHttpsDialer();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const envSpecFor = options.envSpecFor ?? defaultEnvSpec;

  /** Map a completed (non-thrown) response to a TestResult; redirects handled by caller. */
  function classifyStatus(status: number): TestResult {
    if (status >= 200 && status < 300) return { ok: true };
    return { ok: false, error: mapProviderError({ status }) };
  }

  /** Dial one hop, enforce F2, then either follow (F3-revalidated) or classify the status. */
  async function dialGuarded(
    url: URL,
    headers: Readonly<Record<string, string>>,
    target: ConnectTarget,
    hops: number,
  ): Promise<TestResult> {
    const pin = target.resolved[0];
    if (pin === undefined) throw new Error("No validated address to dial.");

    let response: HttpProbeResponse;
    try {
      response = await dialer({ url, ip: pin.address, family: pin.family, headers, timeoutMs });
    } catch (cause) {
      // Timeout / transport failure → mapped PR7 error (never carries a secret).
      return { ok: false, error: mapProviderError(cause) };
    }

    // F2: the socket MUST have used the exact validated IP we pinned. The hostname alone is
    // never trusted — a re-resolution to any other IP (esp. private/metadata) is refused.
    const validated = target.resolved.some((a) => a.address === response.dialedIp);
    if (response.dialedIp !== pin.address || !validated) {
      throw new SocketPinViolationError(pin.address, response.dialedIp);
    }

    if (isRedirect(response.status)) return followRedirect(url, headers, response, hops);
    return classifyStatus(response.status);
  }

  /** F3: re-run the SSRF guard on the redirect target BEFORE following; bounded hops. */
  async function followRedirect(
    from: URL,
    headers: Readonly<Record<string, string>>,
    response: HttpProbeResponse,
    hops: number,
  ): Promise<TestResult> {
    if (hops >= maxRedirects) return { ok: false, error: mapProviderError({ status: 508 }) };
    const location = response.headers["location"];
    if (location === undefined || location.length === 0) {
      return { ok: false, error: mapProviderError({ status: 502 }) };
    }
    const next = new URL(location, from);
    // Re-validate the redirect host+IP through the SSRF guard (throws on private/metadata).
    const nextTarget = await ssrf.assertAllowed(next.href);
    // Secret discipline: never resend the credential to a different host.
    if (next.host !== from.host) throw new CrossHostRedirectError(from.host, next.host);
    return dialGuarded(next, headers, nextTarget, hops + 1);
  }

  return {
    async probe(id: ProviderId, target: ConnectTarget | null): Promise<TestResult> {
      // The probe endpoint URL (no secret). Built-ins are SSRF-validated here; the custom
      // endpoint's target was already validated by the port's guardedConnect.
      const url = new URL(probeUrlFor(id, target));
      const connectTarget = target ?? (await ssrf.assertAllowed(url.href));

      const ref = credentialRefFor(id);
      // No credential configured → a clean auth failure (recovery: enter a credential).
      if (ref === undefined) return { ok: false, error: mapProviderError({ status: 401 }) };

      // SOLE point the key value leaves the store; it is registered with the scrubber here.
      const injection = await credentials.resolveInjection(ref, envSpecFor(id));
      const headers = authHeadersFor(id, injection.value);

      return dialGuarded(url, headers, connectTarget, 0);
    },

    // Streaming/cancel is a SEPARATE carry-forward (CGHC-012). The probe opens no stream.
    async cancel(_handle: StreamHandle): Promise<void> {
      /* no-op: testConnection is self-bounded and opens no long-lived stream */
    },
  };
}
