/**
 * SSRF-pinned Microsoft Graph HTTP client. Every URL passes SsrfPolicy.assertAllowed
 * before fetch. Bearer token is added per call and redacted from logs. Non-2xx
 * responses throw mapGraphStatus-mapped Ms365Errors.
 *
 * Design: port/adapter seam over the SSRF policy + provider token discipline.
 */

import type { SsrfPolicy } from "../provider/index.js";
import { Ms365Error, mapGraphStatus } from "./ms365-errors.js";

/** Fixed set of hosts this client is ever allowed to reach. */
const DEFAULT_ALLOWED_HOSTS: readonly string[] = ["graph.microsoft.com", "login.microsoftonline.com"];

export interface HttpGraphClientOptions {
  /** SSRF policy to validate every outbound URL */
  ssrf: SsrfPolicy;
  /** Async function that returns the current bearer token */
  getToken: () => Promise<string>;
  /** Optional custom fetch implementation (defaults to global fetch) */
  fetchFn?: typeof fetch;
  /** Base URL for Graph API (defaults to https://graph.microsoft.com/v1.0) */
  baseUrl?: string;
  /**
   * Fixed host allowlist this client may ever contact. Defaults to the Graph API and
   * Microsoft identity platform hosts. `baseUrl`'s host must be a member.
   */
  allowedHosts?: readonly string[];
}

export interface GraphClientRequest {
  /** HTTP method for this request. */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path component (e.g. "/me", "/sites/contoso") */
  path: string;
  /** Optional query parameters */
  query?: Record<string, string | string[]>;
  /** Optional request body */
  body?: unknown;
  /** Optional body bytes for PUT/PATCH/POST */
  bodyBytes?: Uint8Array;
  /** Optional ETag for optimistic concurrency (Planner PATCH/DELETE). Sent as If-Match. */
  ifMatch?: string;
  /** Optional Prefer header value (e.g. non-indexed-query warning for SharePoint $filter). */
  prefer?: string;
}

export interface HttpGraphClient {
  /** Send request and parse response as JSON */
  json<T>(req: GraphClientRequest): Promise<T>;
  /** Send request and return response as bytes */
  bytes(req: GraphClientRequest): Promise<Uint8Array>;
  /** Send request expecting a 2xx with no meaningful body (e.g. 204). */
  noContent(req: GraphClientRequest): Promise<void>;
}

/**
 * Provider-neutral alias used by consumers (connector, SharePoint service) that only need
 * the request/response shape, not the HTTP-specific construction options. Same shape as
 * {@link HttpGraphClient}; kept as a distinct name so callers depend on the narrow contract.
 */
export type GraphClient = HttpGraphClient;

export function createHttpGraphClient(options: HttpGraphClientOptions): HttpGraphClient {
  const baseUrl = options.baseUrl ?? "https://graph.microsoft.com/v1.0";
  const fetchFn = options.fetchFn ?? fetch;
  const allowedHosts = new Set(options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS);

  const baseHost = new URL(baseUrl).hostname;
  if (!allowedHosts.has(baseHost)) {
    throw new Ms365Error(
      "endpoint_blocked",
      `Graph client baseUrl host "${baseHost}" is not in the allowed host list.`,
      "Kiểm tra lại cấu hình baseUrl.",
      false,
    );
  }

  /**
   * Sends a Graph request.
   *
   * SSRF/DNS-rebinding note: `url.hostname` is checked against the fixed {@link allowedHosts}
   * list BEFORE the SSRF policy runs, so a redirect or injected host can never reach a
   * non-Graph endpoint. `options.ssrf.assertAllowed` then re-validates the IP class of the
   * CURRENT resolution. However, the actual network call below still uses the global
   * `fetchFn` (`fetch` by default), which performs its OWN DNS resolution — this does NOT
   * pin the connection to the IP address the SSRF policy just validated, unlike
   * `http-connector.ts`'s manual dialer. The mitigation here is therefore the fixed-host
   * allowlist plus the SSRF policy check, not a full IP pin; a custom dialer that reuses
   * the validated `ConnectTarget` IP is a documented future hardening step, not implemented.
   * `redirect: "error"` additionally ensures an HTTP redirect cannot silently bounce the
   * request to a host that was never checked.
   */
  async function send(req: GraphClientRequest): Promise<Response> {
    // Build full URL with query params
    const fullPath = baseUrl.endsWith("/") || req.path.startsWith("/")
      ? baseUrl + req.path
      : baseUrl + "/" + req.path;
    const url = new URL(fullPath);

    if (req.query) {
      for (const [key, value] of Object.entries(req.query)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            url.searchParams.append(key, v);
          }
        } else {
          url.searchParams.set(key, value);
        }
      }
    }

    // Fixed host allowlist check BEFORE the SSRF policy runs.
    if (!allowedHosts.has(url.hostname)) {
      throw new Ms365Error(
        "endpoint_blocked",
        `Refusing request to non-allowlisted host "${url.hostname}".`,
        "Liên hệ quản trị viên nếu cần thêm host mới.",
        false,
      );
    }

    const href = url.toString();

    // SSRF validation BEFORE fetch
    await options.ssrf.assertAllowed(href);

    // Get token
    const token = await options.getToken();

    // Build request init
    const init: RequestInit = {
      method: req.method,
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
      },
    };

    if (req.ifMatch !== undefined) {
      (init.headers as Record<string, string>)["if-match"] = req.ifMatch;
    }

    if (req.prefer !== undefined) {
      (init.headers as Record<string, string>)["prefer"] = req.prefer;
    }

    // Set content type and body
    if (req.bodyBytes) {
      init.body = req.bodyBytes;
      (init.headers as Record<string, string>)["content-type"] = "application/octet-stream";
    } else if (req.body) {
      init.body = JSON.stringify(req.body);
      (init.headers as Record<string, string>)["content-type"] = "application/json";
    }

    // Fetch
    const res = await fetchFn(href, init);

    // Handle non-2xx
    if (!res.ok) {
      throw mapGraphStatus(res.status, res.headers.get("retry-after"));
    }

    return res;
  }

  return {
    async json<T>(req: GraphClientRequest): Promise<T> {
      const res = await send(req);
      return res.json() as Promise<T>;
    },

    async bytes(req: GraphClientRequest): Promise<Uint8Array> {
      const res = await send(req);
      return new Uint8Array(await res.arrayBuffer());
    },

    async noContent(req: GraphClientRequest): Promise<void> {
      await send(req);
    },
  };
}
