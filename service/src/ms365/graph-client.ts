/**
 * SSRF-pinned Microsoft Graph HTTP client. Every URL passes SsrfPolicy.assertAllowed
 * before fetch. Bearer token is added per call and redacted from logs. Non-2xx
 * responses throw mapGraphStatus-mapped Ms365Errors.
 *
 * Design: port/adapter seam over the SSRF policy + provider token discipline.
 */

import type { SsrfPolicy } from "../provider/index.js";
import { mapGraphStatus } from "./ms365-errors.js";

export interface HttpGraphClientOptions {
  /** SSRF policy to validate every outbound URL */
  ssrf: SsrfPolicy;
  /** Async function that returns the current bearer token */
  getToken: () => Promise<string>;
  /** Optional custom fetch implementation (defaults to global fetch) */
  fetchFn?: typeof fetch;
  /** Base URL for Graph API (defaults to https://graph.microsoft.com/v1.0) */
  baseUrl?: string;
}

export interface GraphClientRequest {
  /** Path component (e.g. "/me", "/sites/contoso") */
  path: string;
  /** Optional query parameters */
  query?: Record<string, string | string[]>;
  /** Optional request body */
  body?: unknown;
  /** Optional body bytes for PUT/PATCH/POST */
  bodyBytes?: Uint8Array;
}

export interface HttpGraphClient {
  /** Send request and parse response as JSON */
  json<T>(req: GraphClientRequest): Promise<T>;
  /** Send request and return response as bytes */
  bytes(req: GraphClientRequest): Promise<Uint8Array>;
}

export function createHttpGraphClient(options: HttpGraphClientOptions): HttpGraphClient {
  const baseUrl = options.baseUrl ?? "https://graph.microsoft.com/v1.0";
  const fetchFn = options.fetchFn ?? fetch;

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

    const href = url.toString();

    // SSRF validation BEFORE fetch
    await options.ssrf.assertAllowed(href);

    // Get token
    const token = await options.getToken();

    // Build request init
    const init: RequestInit = {
      method: req.body || req.bodyBytes ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${token}`,
      },
    };

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
  };
}
