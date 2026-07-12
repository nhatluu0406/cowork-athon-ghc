/**
 * Permission boundary router (CGHC-017 service-side transport; mounts on the CGHC-002
 * loopback boundary, ADR 0003). It is the WIRE seam the Allow/Deny UI (Part B) talks to.
 *
 * SECURITY / ARCHITECTURE invariants held here:
 *  - Every route is TOKEN-GUARDED (no `publicUnauthenticated`) — fail-closed like every
 *    sensitive route.
 *  - This router NEVER performs a mutation and is NOT a second authority. It only READS the
 *    pending snapshot and RECORDS a decision on the single {@link PermissionGate}. The real
 *    block/allow happens later at `gate.proceed` inside the tool proxy (the execution
 *    boundary). A decision object is not itself authorization (P3).
 *  - `GET /pending` returns an EXPLICIT non-secret projection of each pending request — it
 *    never spreads raw internal gate state, so no field can leak by accident. A
 *    {@link PermissionRequest} carries no secret today; mapping fields explicitly keeps it
 *    that way as the contract evolves.
 */

import type {
  ApprovalLevel,
  PermissionActionKind,
  PermissionDecision,
  PermissionScope,
} from "@cowork-ghc/contracts";
import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { PermissionGate, ResolutionInput } from "./permission-gate.js";

export const PERMISSION_PENDING_PATH = "/v1/permission/pending";
export const PERMISSION_DECISION_PATH = "/v1/permission/decision";

/**
 * Malformed decision request (bad client input). Extends {@link BadRequestError} so the
 * boundary dispatcher maps it to HTTP 400 `bad_request` (not a misleading 500). The message
 * stays generic and never carries a secret.
 */
export class PermissionRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "PermissionRequestError";
  }
}

/** Explicit, non-secret projection of one pending request for the Allow/Deny UI. */
export interface PendingPermissionView {
  readonly requestId: string;
  readonly sessionId: string;
  readonly approvalLevel: ApprovalLevel;
  /** ISO-8601 timestamp the request was raised (display ordering). */
  readonly requestedAt: string;
  readonly action: {
    readonly kind: PermissionActionKind;
    /** Human-readable, non-secret description of the change (P2/F5). */
    readonly description: string;
    /** Target path for file actions; absent for non-file actions. */
    readonly targetPath?: string;
  };
}

/** Response of `POST /v1/permission/decision`, mirroring the gate's `ResolutionOutcome`. */
export type PermissionDecisionResponse =
  | {
      readonly status: "resolved";
      readonly decision: PermissionDecision;
      readonly approvalLevel: ApprovalLevel;
      /** Present only for an allow (the scope actually recorded on the gate). */
      readonly scope?: PermissionScope;
    }
  | { readonly status: "already_resolved"; readonly decision: PermissionDecision }
  | { readonly status: "unknown"; readonly requestId: string };

interface DecisionBody {
  readonly requestId: string;
  readonly decision: PermissionDecision;
  readonly scope?: PermissionScope;
}

/** Build the explicit projection — never spread the raw request (avoids accidental leaks). */
function projectPending(gate: PermissionGate): readonly PendingPermissionView[] {
  return gate.pending().map((req) => ({
    requestId: req.requestId,
    sessionId: req.sessionId,
    approvalLevel: req.approvalLevel,
    requestedAt: req.requestedAt,
    action: {
      kind: req.action.kind,
      description: req.action.description,
      ...(req.action.targetPath !== undefined ? { targetPath: req.action.targetPath } : {}),
    },
  }));
}

function parseDecisionBody(body: unknown): DecisionBody {
  if (typeof body !== "object" || body === null) {
    throw new PermissionRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  const { requestId, decision, scope } = record;
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    throw new PermissionRequestError("requestId is required.");
  }
  if (decision !== "allow" && decision !== "deny") {
    throw new PermissionRequestError('decision must be "allow" or "deny".');
  }
  if (scope !== undefined && scope !== "once" && scope !== "always") {
    throw new PermissionRequestError('scope, when present, must be "once" or "always".');
  }
  // scope is meaningful only for an allow; the gate ignores it for a deny.
  return scope === undefined ? { requestId, decision } : { requestId, decision, scope };
}

/**
 * Build the permission router against the SINGLE {@link PermissionGate}. The composition root
 * mounts it via the shared `routers` array so it shares the one gate the tool proxy enforces
 * against.
 */
export function createPermissionRouter(gate: PermissionGate): BoundaryRouter {
  return {
    name: "permission",
    routes: [
      {
        method: "GET",
        path: PERMISSION_PENDING_PATH,
        handler: (): RouteResult<{ pending: readonly PendingPermissionView[] }> => ({
          status: 200,
          data: { pending: projectPending(gate) },
        }),
      },
      {
        method: "POST",
        path: PERMISSION_DECISION_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<PermissionDecisionResponse>> => {
          const input = parseDecisionBody(ctx.body);
          // This route ONLY records the decision on the gate — it performs no mutation. The
          // actual block/allow happens at `gate.proceed` at the execution boundary.
          const resolution: ResolutionInput =
            input.scope === undefined
              ? { requestId: input.requestId, decision: input.decision }
              : { requestId: input.requestId, decision: input.decision, scope: input.scope };
          const outcome = await gate.resolve(resolution);

          if (outcome.status === "unknown") {
            // Honest typed not-found — never a fabricated success for an unknown request.
            return { status: 404, data: { status: "unknown", requestId: input.requestId } };
          }
          if (outcome.status === "already_resolved") {
            // Idempotent: report the decision already on record (a late Allow never overrides).
            return { status: 200, data: { status: "already_resolved", decision: outcome.decision } };
          }
          // resolved: reflect the recorded decision + boundary-authoritative approval level.
          const data: PermissionDecisionResponse =
            outcome.reply.scope === undefined
              ? { status: "resolved", decision: outcome.reply.decision, approvalLevel: outcome.approvalLevel }
              : {
                  status: "resolved",
                  decision: outcome.reply.decision,
                  approvalLevel: outcome.approvalLevel,
                  scope: outcome.reply.scope,
                };
          return { status: 200, data };
        },
      },
    ],
  };
}
