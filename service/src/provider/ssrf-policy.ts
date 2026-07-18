/**
 * Outbound SSRF policy for a user-defined custom `base_url` (CGHC-010, ADR 0005
 * §"Custom endpoint SSRF policy"; security MED-2 / test HIGH-2). Enforced at the SERVICE
 * (execution boundary), never in the UI — the outbound analogue of the M1 loopback-only
 * bind (CGHC-001).
 *
 * Production policy:
 *  - require `https` (http is permitted ONLY on loopback, ONLY under the test-mode escape),
 *  - block RFC-1918, link-local, loopback, and cloud-metadata targets,
 *  - validate the RESOLVED IP at connect time via an injected {@link DnsResolver} so a
 *    hostname cannot be re-pointed at a private IP after config (DNS-rebinding guard); if
 *    ANY resolved address is disallowed the whole target is refused.
 *
 * The resolver is injected so tests use a deterministic fake and never hit the network.
 */

import net from "node:net";
import { classifyIp, type IpClass } from "./ip-classify.js";
import { isGatewayProxyUrl } from "../gateway/gateway-proxy-url.js";

/** One resolved address for a hostname (mirrors `dns.lookup` all-results shape). */
export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Injected DNS seam. Returns every address a hostname resolves to. */
export type DnsResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

/** Why a target was refused. */
export type SsrfBlockReason =
  | "invalid_url"
  | "scheme_not_https"
  | "unresolvable"
  | "loopback"
  | "link_local"
  | "cloud_metadata"
  | "private";

/** A validated, safe-to-connect target: the parsed URL plus its resolved addresses. */
export interface ConnectTarget {
  readonly url: URL;
  readonly resolved: readonly ResolvedAddress[];
}

export type SsrfDecision =
  | { readonly allowed: true; readonly target: ConnectTarget }
  | { readonly allowed: false; readonly reason: SsrfBlockReason; readonly detail: string };

/** Thrown by {@link SsrfPolicy.assertAllowed}. Message is non-secret and user-safe. */
export class SsrfBlockedError extends Error {
  readonly reason: SsrfBlockReason;
  constructor(reason: SsrfBlockReason, detail: string) {
    super(`Outbound target refused by SSRF policy (${reason}): ${detail}`);
    this.name = "SsrfBlockedError";
    this.reason = reason;
  }
}

const CLASS_TO_REASON: Readonly<Record<Exclude<IpClass, "public">, SsrfBlockReason>> = {
  loopback: "loopback",
  link_local: "link_local",
  cloud_metadata: "cloud_metadata",
  private: "private",
};

export interface SsrfPolicyOptions {
  readonly resolver: DnsResolver;
  /**
   * When `true`, EXPLICIT loopback is allowed and `http` is permitted on loopback. This flag
   * must come ONLY from a composition-root-resolved source — either
   * {@link import("./test-mode.js").resolveLoopbackEscape} (the release-gated test-mode escape)
   * or {@link import("./dev-loopback-http.js").readDevLoopbackHttpEscape} (the ungated
   * developer-only override, never gated by `BUILD_PROFILE`) — and NEVER from a request body.
   * Everything else stays blocked. Defaults to `false`.
   */
  readonly loopbackEscape?: boolean;
  /**
   * Packaged-verifier-only exact mock LLM base URL (`http://127.0.0.1:.../v1`). When the
   * candidate URL matches exactly, loopback `http` is allowed. Never set from request bodies.
   */
  readonly e2eMockLlmBaseUrl?: string;
  /**
   * Explicit user opt-in for LAN/split-horizon provider endpoints (e.g. corporate DNS resolving
   * a provider hostname to an RFC-1918 address). When `true`, ONLY the `private` IP class becomes
   * allowed — loopback (still gated by {@link loopbackEscape} exactly as before), link-local, and
   * cloud-metadata targets stay blocked, and the `https`-required rule is unchanged (a private
   * target still needs `https` unless it also happens to be loopback under the escape). This
   * NEVER loosens metadata/link-local/scheme rules; it must be sourced ONLY from a trusted env
   * reader (never a request body) — see `isPrivateProviderAllowed`. Defaults to `false`.
   */
  readonly allowPrivateNetwork?: boolean;
}

export interface SsrfPolicy {
  /** Evaluate a raw URL to a typed decision (no throw). */
  evaluate(rawUrl: string): Promise<SsrfDecision>;
  /** Evaluate and throw {@link SsrfBlockedError} on refusal; returns the connect target. */
  assertAllowed(rawUrl: string): Promise<ConnectTarget>;
}

/**
 * Order validated addresses for an IP-pinned "Happy-Eyeballs-lite" dial: the resolver's first
 * choice, then the first address of a DIFFERENT family. This lets a dual-stack host whose
 * IPv6 has no working egress (a common Windows/office case) fall back to IPv4 instead of being
 * stuck on a dead pinned address. Bounded to at most two attempts so dial latency stays
 * bounded, and EVERY returned address is one the SSRF policy already validated — the F2
 * socket-pin guarantee is unchanged (we still only ever dial validated IPs).
 */
export function orderConnectCandidates(
  resolved: readonly ResolvedAddress[],
): readonly ResolvedAddress[] {
  const first = resolved[0];
  if (first === undefined) return [];
  const diffFamily = resolved.find((a) => a.family !== first.family);
  return diffFamily === undefined ? [first] : [first, diffFamily];
}

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

/** Strip the `[...]` around an IPv6 authority; leave hostnames untouched. */
function bareHost(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

export function createSsrfPolicy(options: SsrfPolicyOptions): SsrfPolicy {
  const loopbackEscape = options.loopbackEscape === true;
  const allowPrivateNetwork = options.allowPrivateNetwork === true;
  const e2eMockLlmBaseUrl = options.e2eMockLlmBaseUrl?.trim().replace(/\/+$/u, "");

  async function addressesFor(host: string): Promise<readonly ResolvedAddress[]> {
    const family = net.isIP(host);
    if (family === 4 || family === 6) {
      // Literal IP: no DNS, so no rebinding surface — classify it directly.
      return [{ address: host, family: family === 4 ? 4 : 6 }];
    }
    // Hostname: RE-RESOLVE at connect time (the DNS-rebinding guard).
    return options.resolver(host);
  }

  function classDecision(cls: IpClass): { ok: boolean; reason?: SsrfBlockReason } {
    if (cls === "public") return { ok: true };
    if (cls === "loopback" && loopbackEscape) return { ok: true };
    // Explicit opt-in: ONLY the `private` (RFC-1918) class is affected. link_local and
    // cloud_metadata stay blocked unconditionally, regardless of this flag.
    if (cls === "private" && allowPrivateNetwork) return { ok: true };
    return { ok: false, reason: CLASS_TO_REASON[cls] };
  }

  async function evaluate(rawUrl: string): Promise<SsrfDecision> {
    const url = parseUrl(rawUrl);
    // NEVER echo the raw input: a malformed paste may contain a credential. The reason
    // alone is diagnosable; the user knows what they typed.
    if (url === null) return { allowed: false, reason: "invalid_url", detail: "unparseable URL" };

    const normalized = url.href.replace(/\/+$/u, "");
    if (
      e2eMockLlmBaseUrl !== undefined &&
      e2eMockLlmBaseUrl.length > 0 &&
      normalized === e2eMockLlmBaseUrl &&
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1"
    ) {
      return {
        allowed: true,
        target: { url, resolved: [{ address: "127.0.0.1", family: 4 }] },
      };
    }
    // Second fixed exception, same shape as the E2E-mock-LLM escape above: the Gateway proxy
    // is an internally-known loopback address (never user input) that Cowork itself forwards
    // from — a probe/test-connection against it must be allowed the same way live chat is.
    if (url.protocol === "http:" && url.hostname === "127.0.0.1" && isGatewayProxyUrl(url.href)) {
      return {
        allowed: true,
        target: { url, resolved: [{ address: "127.0.0.1", family: 4 }] },
      };
    }

    const isHttps = url.protocol === "https:";
    const isHttp = url.protocol === "http:";
    if (!isHttps && !(isHttp && loopbackEscape)) {
      return { allowed: false, reason: "scheme_not_https", detail: url.protocol };
    }

    const host = bareHost(url.hostname);
    let resolved: readonly ResolvedAddress[];
    try {
      resolved = await addressesFor(host);
    } catch (cause) {
      return { allowed: false, reason: "unresolvable", detail: describe(cause) };
    }
    if (resolved.length === 0) {
      return { allowed: false, reason: "unresolvable", detail: host };
    }

    // Block if ANY resolved address is disallowed (a single private answer poisons all).
    let allLoopback = true;
    for (const addr of resolved) {
      const cls = classifyIp(addr.address);
      if (cls !== "loopback") allLoopback = false;
      const decision = classDecision(cls);
      if (!decision.ok) {
        return { allowed: false, reason: decision.reason ?? "private", detail: addr.address };
      }
    }

    // `http` is allowed ONLY when every resolved address is loopback (test-mode escape).
    if (isHttp && !allLoopback) {
      return { allowed: false, reason: "scheme_not_https", detail: "http permitted on loopback only" };
    }

    return { allowed: true, target: { url, resolved } };
  }

  return {
    evaluate,
    async assertAllowed(rawUrl: string): Promise<ConnectTarget> {
      const decision = await evaluate(rawUrl);
      if (!decision.allowed) throw new SsrfBlockedError(decision.reason, decision.detail);
      return decision.target;
    },
  };
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.name;
  return "resolver_error";
}

/**
 * Env-flag gate for {@link SsrfPolicyOptions.allowPrivateNetwork} (PO decision 2026-07-15):
 * OFF (`false`) unless the env var is EXACTLY `"1"` or `"true"` — every other value, including
 * `undefined`, `"0"`, `"false"`, or any other string, is OFF. Mirrors `isMs365Enabled`'s style.
 * Scope: PROVIDER endpoints only (see the composition root for exactly which SsrfPolicy
 * instances read this) — it never applies to the MS365 Graph client, the device-code provider,
 * or the extension/MCP registry's SsrfPolicy, which stay strict regardless of this flag.
 */
export function isPrivateProviderAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.CGHC_SSRF_ALLOW_PRIVATE_PROVIDER === "1" || env.CGHC_SSRF_ALLOW_PRIVATE_PROVIDER === "true";
}
