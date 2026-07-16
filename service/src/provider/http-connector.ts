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

import type { CredentialRef, ModelRef, ProviderId, TestResult } from "@cowork-ghc/contracts";
import type { ProviderEnvSpec, ProviderKeyInjection } from "@cowork-ghc/runtime";
import type { ConnectTarget, SsrfPolicy } from "./ssrf-policy.js";
import { orderConnectCandidates } from "./ssrf-policy.js";
import type { ProviderConnector, StreamHandle } from "./provider-port.js";
import { providerEnvSpec, isCustomEndpoint } from "./descriptors.js";
import { mapProviderError, type ProviderErrorContext } from "./error-map.js";
import { authHeadersFor, chatCompletionUrl, minimalChatCompletionBody, probeUrlFor } from "./probe-profiles.js";
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
  /** Active default model for OpenAI-compatible model validation (optional second probe). */
  readonly activeModelFor?: () => ModelRef | undefined;
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
  const activeModelFor = options.activeModelFor;

  /** Map a completed (non-thrown) response to a TestResult; redirects handled by caller. */
  function classifyStatus(status: number, probeContext?: ProviderErrorContext): TestResult {
    if (status >= 200 && status < 300) return { ok: true };
    return { ok: false, error: mapProviderError({ status }, probeContext) };
  }

  interface DialOptions {
    readonly method?: "GET" | "POST";
    readonly body?: string;
  }

  /** Dial one hop, enforce F2, then either follow (F3-revalidated) or classify the status. */
  async function dialGuarded(
    url: URL,
    headers: Readonly<Record<string, string>>,
    target: ConnectTarget,
    hops: number,
    probeContext?: ProviderErrorContext,
    dialOptions?: DialOptions,
  ): Promise<TestResult> {
    // IP-pinned Happy-Eyeballs: try the resolver's first address, then a DIFFERENT family, so a
    // dual-stack host with a dead IPv6 route falls back to IPv4. Only a THROWN (transport/timeout)
    // failure triggers fallback — an HTTP status is a real answer, never a fallback trigger. Every
    // candidate is an SSRF-validated address, so the F2 socket-pin guarantee is unchanged.
    const candidates = orderConnectCandidates(target.resolved);
    if (candidates.length === 0) throw new Error("No validated address to dial.");

    let lastError: unknown;
    for (const pin of candidates) {
      let response: HttpProbeResponse;
      try {
        response = await dialer({
          url,
          ip: pin.address,
          family: pin.family,
          headers,
          timeoutMs,
          ...(dialOptions?.method !== undefined ? { method: dialOptions.method } : {}),
          ...(dialOptions?.body !== undefined ? { body: dialOptions.body } : {}),
        });
      } catch (cause) {
        lastError = cause;
        continue;
      }

      const validated = target.resolved.some((a) => a.address === response.dialedIp);
      if (response.dialedIp !== pin.address || !validated) {
        throw new SocketPinViolationError(pin.address, response.dialedIp);
      }

      if (isRedirect(response.status)) {
        return followRedirect(url, headers, response, hops, probeContext, dialOptions);
      }
      return classifyStatus(response.status, probeContext);
    }
    return { ok: false, error: mapProviderError(lastError, probeContext) };
  }

  /** F3: re-run the SSRF guard on the redirect target BEFORE following; bounded hops. */
  async function followRedirect(
    from: URL,
    headers: Readonly<Record<string, string>>,
    response: HttpProbeResponse,
    hops: number,
    probeContext?: ProviderErrorContext,
    dialOptions?: DialOptions,
  ): Promise<TestResult> {
    if (hops >= maxRedirects) return { ok: false, error: mapProviderError({ status: 508 }, probeContext) };
    const location = response.headers["location"];
    if (location === undefined || location.length === 0) {
      return { ok: false, error: mapProviderError({ status: 502 }, probeContext) };
    }
    const next = new URL(location, from);
    const nextTarget = await ssrf.assertAllowed(next.href);
    if (next.host !== from.host) throw new CrossHostRedirectError(from.host, next.host);
    return dialGuarded(next, headers, nextTarget, hops + 1, probeContext, dialOptions);
  }

  return {
    async probe(id: ProviderId, target: ConnectTarget | null): Promise<TestResult> {
      const url = new URL(probeUrlFor(id, target));
      const connectTarget = target ?? (await ssrf.assertAllowed(url.href));

      const ref = credentialRefFor(id);
      if (ref === undefined) return { ok: false, error: mapProviderError({ status: 401 }) };

      const injection = await credentials.resolveInjection(ref, envSpecFor(id));
      const headers = authHeadersFor(id, injection.value);

      const authResult = await dialGuarded(url, headers, connectTarget, 0, { probe: "auth" });
      if (!authResult.ok) return authResult;

      if (isCustomEndpoint(id)) {
        const model = activeModelFor?.();
        if (model !== undefined && model.modelID.trim().length > 0) {
          const chatUrl = new URL(chatCompletionUrl(connectTarget));
          const postHeaders = {
            ...headers,
            "content-type": "application/json",
            accept: "application/json",
          };
          const modelResult = await dialGuarded(
            chatUrl,
            postHeaders,
            connectTarget,
            0,
            { probe: "model" },
            { method: "POST", body: minimalChatCompletionBody(model.modelID) },
          );
          if (!modelResult.ok) return modelResult;
        }
      }

      return { ok: true };
    },

    // Streaming/cancel is a SEPARATE carry-forward (CGHC-012). The probe opens no stream.
    async cancel(_handle: StreamHandle): Promise<void> {
      /* no-op: testConnection is self-bounded and opens no long-lived stream */
    },
  };
}
