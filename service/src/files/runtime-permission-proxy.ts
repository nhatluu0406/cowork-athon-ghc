/**
 * `LiveRuntimeReplyPort` — the LIVE OpenCode runtime-reply adapter (CGHC-018, P3 + LOW-2).
 *
 * The {@link PermissionGate} forwards every Allow/Deny (explicit or fail-closed) through a
 * {@link RuntimeReplyPort} so the runtime is never stranded. This is the concrete adapter that
 * turns a {@link PermissionReply} into the OpenCode POST:
 *   `POST {baseUrl}/permission/{requestID}/reply`  (default; requestId == the runtime permissionID)
 * with a body mapping the decision + scope to OpenCode's `{ reply: "once" | "always" | "reject" }`.
 * The alternate `/session/{id}/permissions/{permissionID}` form is supported by injecting a custom
 * `endpoint` builder (it needs a requestId→sessionId lookup the reply object does not carry).
 *
 * SECURITY (LOW-2): the HTTP transport is thin + injectable (tests need no live server) and the
 * error path is REDACTING. A raw `fetch` error can embed the base URL, the permission id, header
 * echoes, or a bearer token; this adapter scrubs every such error through {@link createReplyRedactor}
 * BEFORE it reaches the reporter, and it rethrows only a fixed, secret-free
 * {@link RuntimeReplyError}. No credential/URL/header/token material ever escapes (security.md).
 */

import type { PermissionReply } from "@cowork-ghc/contracts";
import type { RuntimeReplyPort } from "../permission/index.js";
import { createReplyRedactor, type ReplyRedactor } from "./reply-redaction.js";

/** OpenCode's reply vocabulary. */
export type RuntimeReplyResponse = "once" | "always" | "reject";

/** Thin, injectable HTTP transport so the default suite needs no live runtime. */
export interface RuntimeReplyTransport {
  post(url: string, body: unknown, headers: Readonly<Record<string, string>>): Promise<void>;
}

/** Non-secret failure the gate/caller sees. Its message NEVER carries a URL/token. */
export class RuntimeReplyError extends Error {
  readonly code = "runtime_reply_failed" as const;
  readonly requestId: string;
  constructor(requestId: string) {
    super(`Runtime permission reply failed for ${requestId}.`);
    this.name = "RuntimeReplyError";
    this.requestId = requestId;
  }
}

export interface LiveRuntimeReplyOptions {
  /** Base URL of the local runtime, e.g. `http://127.0.0.1:53421`. */
  readonly baseUrl: string;
  /** Per-launch runtime auth token (a secret — never logged, always redacted). */
  readonly token?: string;
  /** Injectable transport; defaults to a thin `fetch` POST. */
  readonly transport?: RuntimeReplyTransport;
  /** Override the reply URL (e.g. the `/session/{id}/permissions/{permissionID}` form). */
  readonly endpoint?: (requestId: string) => string;
  /**
   * Redacting reporter for a transport failure. Receives an ALREADY-scrubbed, non-secret
   * message. Defaults to a non-secret `console.error`.
   */
  readonly onReplyError?: (message: string, requestId: string) => void;
}

function mapReply(reply: PermissionReply): RuntimeReplyResponse {
  if (reply.decision === "deny") return "reject";
  return reply.scope === "always" ? "always" : "once";
}

/** Build a thin `fetch`-based transport that never returns without a 2xx. */
function fetchTransport(fetchImpl: typeof fetch): RuntimeReplyTransport {
  return {
    async post(url, body, headers) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Status only — never echo the URL/body/headers into the error.
        throw new Error(`runtime responded with status ${res.status}`);
      }
    },
  };
}

/**
 * Build a {@link RuntimeReplyPort} that POSTs Allow/Deny replies to the live runtime with a
 * redacting error path. `fetchImpl` is injectable for offline unit tests.
 */
export function createLiveRuntimeReplyPort(
  options: LiveRuntimeReplyOptions,
  fetchImpl: typeof fetch = fetch,
): RuntimeReplyPort {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const token = options.token ?? "";
  const authHeaderValue = token.length > 0 ? `Bearer ${token}` : "";
  const headers: Record<string, string> =
    authHeaderValue.length > 0 ? { authorization: authHeaderValue } : {};
  const transport = options.transport ?? fetchTransport(fetchImpl);
  const endpoint =
    options.endpoint ?? ((requestId: string) => `${baseUrl}/permission/${encodeURIComponent(requestId)}/reply`);
  const redact: ReplyRedactor = createReplyRedactor({
    secrets: [baseUrl, token, authHeaderValue],
  });
  const report =
    options.onReplyError ??
    ((message: string, requestId: string) =>
      console.error(`[files] runtime reply transport error for ${requestId}: ${message}`));

  return {
    async reply(reply: PermissionReply): Promise<void> {
      const url = endpoint(reply.requestId);
      const body = { reply: mapReply(reply) };
      try {
        await transport.post(url, body, headers);
      } catch (rawError) {
        // LOW-2: scrub the raw error (which may embed the URL/token) before it is reported or
        // rethrown, then surface only a fixed, secret-free error to the gate/caller.
        report(redact(rawError), reply.requestId);
        throw new RuntimeReplyError(reply.requestId);
      }
    },
  };
}
