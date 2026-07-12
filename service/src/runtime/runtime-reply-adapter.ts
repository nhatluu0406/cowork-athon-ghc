/**
 * LIVE {@link RuntimeReplyPort} over the supervised OpenCode child (CGHC-028 Wave A2).
 *
 * Fills the Tier 2 outbound permission-reply seam (`compose-service.ts` default: reject every
 * reply). The permission gate records an Allow/Deny SERVER-SIDE first, then calls this port to
 * POST the decision back to the child so a run is never stranded (P3). A non-2xx surfaces as a
 * TYPED rejection ({@link OpencodeHttpError}) rather than an unhandled throw — the gate's FIX-3
 * already report-and-swallows a failed Deny reply, so a real server-side Deny still blocks even
 * if this delivery fails.
 *
 * ROUTE (flag for Wave C live confirmation): `POST /permission/{requestId}/reply` with body
 * `{ decision, scope? }`. This is the request-id-addressed reply route documented in ADR 0001
 * and the OpenWork reference (`permission/:requestId/reply`); the {@link PermissionReply} carries
 * only `requestId` (no `sessionId`), so the request-id route — not a session-scoped variant — is
 * the correct shape. NOT confirmed against the pinned server in-repo.
 */

import type { PermissionReply } from "@cowork-ghc/contracts";
import type { RuntimeReplyPort } from "../permission/index.js";
import type { OpencodeHttp } from "./opencode-client.js";

export interface OpencodeRuntimeReplyOptions {
  readonly http: OpencodeHttp;
}

export function createOpencodeRuntimeReply(
  options: OpencodeRuntimeReplyOptions,
): RuntimeReplyPort {
  return {
    reply(reply: PermissionReply): Promise<void> {
      // Secret-free body: an enum decision + optional allow scope (never a path/credential).
      const body = reply.scope !== undefined
        ? { decision: reply.decision, scope: reply.scope }
        : { decision: reply.decision };
      return options.http.send({
        operation: "permission.reply",
        method: "POST",
        path: `/permission/${encodeURIComponent(reply.requestId)}/reply`,
        body,
      });
    },
  };
}
