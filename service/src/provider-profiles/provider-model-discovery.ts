/**
 * Profile-scoped model discovery (Wave 3). Wraps the provider-unit {@link ModelDiscovery}
 * with the profile's stored base_url + credential handle, and a short bounded per-target
 * cache so repeated "Dò model" clicks in the editor do not re-hit the endpoint.
 *
 * Draft support: the editor may pass a `baseUrlOverride` (the in-form, not-yet-saved base
 * URL) so a user can discover models for an endpoint edit before committing it. The
 * credential still comes from the profile's persisted {@link CredentialRef} — no key ever
 * crosses back through the renderer.
 *
 * Cache invalidation: the cache key is a fingerprint of (base_url · credential account ·
 * credential revision). Changing the endpoint OR rotating the key yields a different key, so
 * a stale list is never served after an endpoint/key change; entries also expire by TTL.
 * Only SUCCESSFUL results are cached (a transient failure must be retryable immediately).
 */

import { createHash } from "node:crypto";
import type { ModelDiscoveryResult, ProviderError } from "@cowork-ghc/contracts";
import {
  CUSTOM_OPENAI_COMPAT_ID,
  createModelDiscovery,
  createSsrfPolicy,
  CrossHostRedirectError,
  providerEnvSpec,
  SocketPinViolationError,
  SsrfBlockedError,
  type DnsResolver,
  type HttpDialer,
  type ModelDiscovery,
} from "../provider/index.js";
import type { CredentialService } from "../credential/index.js";
import type { ProviderProfile } from "./types.js";

const DEFAULT_CACHE_TTL_MS = 60_000;

const CREDENTIAL_REQUIRED: ProviderError = {
  kind: "auth_invalid",
  message: "Chưa có khoá API cho hồ sơ này — lưu khoá trước khi dò model.",
  retryable: false,
  recovery: "Nhập và lưu khoá API, sau đó dò lại.",
};

const DISCOVERY_REFUSED: ProviderError = {
  kind: "unavailable",
  message: "Endpoint bị chặn bởi chính sách kết nối hoặc chuyển hướng không hợp lệ.",
  retryable: false,
  recovery: "Kiểm tra Base URL và thử lại, hoặc nhập Model ID thủ công.",
};

export interface ProfileModelDiscoveryOptions {
  readonly credentials: CredentialService;
  readonly dnsResolver: DnsResolver;
  /** Injected dial seam (tests). Defaults to the real IP-pinning dialer inside the discovery. */
  readonly dialer?: HttpDialer;
  /** Monotonic clock in ms for cache TTL. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Cache lifetime for a successful result (ms). */
  readonly cacheTtlMs?: number;
  readonly e2eMockLlmBaseUrl?: string;
  readonly timeoutMs?: number;
}

export interface ProfileModelDiscovery {
  discoverForProfile(
    profile: ProviderProfile,
    opts?: { readonly baseUrlOverride?: string },
  ): Promise<ModelDiscoveryResult>;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly result: ModelDiscoveryResult;
}

/** Fingerprint the discovery target (non-secret): base_url + credential account + revision. */
function targetFingerprint(baseUrl: string, account: string, revision: number): string {
  const normalized = `${baseUrl.trim()}|acct:${account}|rev:${Math.max(0, Math.floor(revision))}`;
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function createProfileModelDiscovery(
  options: ProfileModelDiscoveryOptions,
): ProfileModelDiscovery {
  const clock = options.now ?? (() => Date.now());
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cache = new Map<string, CacheEntry>();

  const ssrf = createSsrfPolicy({
    resolver: options.dnsResolver,
    ...(options.e2eMockLlmBaseUrl !== undefined ? { e2eMockLlmBaseUrl: options.e2eMockLlmBaseUrl } : {}),
  });
  const discovery: ModelDiscovery = createModelDiscovery({
    ssrf,
    credentials: options.credentials,
    ...(options.dialer !== undefined ? { dialer: options.dialer } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });

  return {
    async discoverForProfile(profile, opts) {
      const credentialRef = profile.credentialRef;
      if (credentialRef === undefined) {
        return { ok: false, error: CREDENTIAL_REQUIRED };
      }
      const baseUrl = (opts?.baseUrlOverride ?? profile.baseUrl).trim();
      if (baseUrl.length === 0) {
        return { ok: false, error: DISCOVERY_REFUSED };
      }

      const key = targetFingerprint(
        baseUrl,
        credentialRef.account,
        profile.credentialRevision ?? 0,
      );
      const now = clock();
      const cached = cache.get(key);
      if (cached !== undefined && cached.expiresAt > now) {
        return cached.result;
      }

      let result: ModelDiscoveryResult;
      try {
        result = await discovery.discover({
          baseUrl,
          credentialRef,
          envSpec: providerEnvSpec(CUSTOM_OPENAI_COMPAT_ID, profile.envVar),
        });
      } catch (error) {
        // Security refusals (pin violation / SSRF / cross-host redirect) stay non-blocking:
        // surface a mapped, non-secret error and keep manual entry available.
        if (
          error instanceof SocketPinViolationError ||
          error instanceof SsrfBlockedError ||
          error instanceof CrossHostRedirectError
        ) {
          return { ok: false, error: DISCOVERY_REFUSED };
        }
        throw error;
      }

      if (result.ok) {
        cache.set(key, { expiresAt: now + ttlMs, result });
      }
      return result;
    },
  };
}
