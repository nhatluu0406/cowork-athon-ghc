/**
 * PermissionGate — the SINGLE authority over pending permission requests (CGHC-016).
 *
 * One component owns the pending-request lifecycle (one source of truth). It enforces the
 * load-bearing security guarantees, all SERVER-SIDE at the execution boundary:
 *  - P1: a request ORIGINATES at the boundary via {@link PermissionGate.submit} (the runtime
 *    proxy calls it); the gate never invents a request.
 *  - P3 (deny blocks + no strand): {@link PermissionGate.proceed} runs the real mutation ONLY
 *    when a recorded Allow exists — a decision object is not itself authorization. On Deny the
 *    gate forwards an explicit deny reply through the runtime-reply port AND drives the session
 *    to a terminal `denied` state, so the runtime/session is never stranded.
 *  - P6 (fail-closed): if no decision arrives within the timeout the request AUTO-DENIES,
 *    blocks the action, and replies deny — a never-answered request never leaks an Allow.
 *  - P4: the approval level is recomputed from the action kind here (never trusts a
 *    client-supplied level).
 *  - P5: every Allow AND Deny is recorded to the audit sink (no secret values).
 *
 * Scope (once/always) is honored both in the outbound reply and at the enforcement boundary:
 * an `once` allow is CONSUMED after a single {@link PermissionGate.proceed}, so a replayed
 * call cannot reuse it.
 */

import type {
  ApprovalLevel,
  PermissionDecision,
  PermissionReply,
  PermissionRequest,
  PermissionScope,
} from "@cowork-ghc/contracts";
import { classifyApprovalLevel } from "./approval-level.js";
import type {
  PermissionAuditSink,
  PermissionDecisionReason,
  RuntimeReplyPort,
  SessionDenialSink,
  TimerHandle,
  TimerScheduler,
} from "./ports.js";

export interface PermissionGateOptions {
  readonly reply: RuntimeReplyPort;
  readonly audit: PermissionAuditSink;
  readonly session: SessionDenialSink;
  readonly scheduler: TimerScheduler;
  /** Fail-closed window (P6): auto-deny if unanswered within this many ms. */
  readonly timeoutMs: number;
  /** Injectable clock (deterministic tests). */
  readonly now: () => string;
  /**
   * Non-swallowing reporter for a failure forwarding a DENY reply — on BOTH the async
   * fail-closed-timeout path (no caller to await it) AND the explicit-deny path (FIX-3). In
   * either case the deny is already recorded/audited and the session driven terminal BEFORE
   * the outbound reply, so the request stays denied regardless; a failed reply must never
   * surface to the UI as a rejected `resolve()` / 500. This only surfaces the transport
   * failure. Defaults to a non-secret `console.error`. The reply object holds no secrets, so
   * logging it is safe.
   */
  readonly onReplyError?: (error: unknown, requestId: string) => void;
}

/** Internal lifecycle of one request. `consumed` = an `once` allow already spent. */
type RequestState =
  | { readonly status: "pending"; readonly request: PermissionRequest; readonly level: ApprovalLevel; readonly timer: TimerHandle }
  | { readonly status: "allowed"; readonly request: PermissionRequest; readonly level: ApprovalLevel; readonly scope: PermissionScope }
  | { readonly status: "consumed"; readonly request: PermissionRequest; readonly level: ApprovalLevel }
  | { readonly status: "denied"; readonly request: PermissionRequest; readonly level: ApprovalLevel; readonly reason: PermissionDecisionReason };

/** Input the decision path (UI → boundary) hands to {@link PermissionGate.resolve}. */
export interface ResolutionInput {
  readonly requestId: string;
  readonly decision: PermissionDecision;
  /** Scope of an allow; defaults to `once`. Ignored for a deny. */
  readonly scope?: PermissionScope;
}

/** Outcome of {@link PermissionGate.resolve}. */
export type ResolutionOutcome =
  | { readonly status: "resolved"; readonly reply: PermissionReply; readonly approvalLevel: ApprovalLevel }
  | { readonly status: "unknown" }
  | { readonly status: "already_resolved"; readonly decision: PermissionDecision };

/** Result of the execution-boundary guard {@link PermissionGate.proceed}. */
export type ProceedResult<T> =
  | { readonly performed: true; readonly result: T }
  | { readonly performed: false; readonly reason: "not_allowed" };

export interface PermissionGate {
  /** P1: register an inbound request that originated at the execution boundary. */
  submit(request: PermissionRequest): void;
  /** Resolve a pending request with an Allow/Deny; forwards the reply + audits (idempotent-safe). */
  resolve(input: ResolutionInput): Promise<ResolutionOutcome>;
  /** Enforcement query: may this request's action proceed? Only true for a live recorded Allow. */
  isAllowed(requestId: string): boolean;
  /**
   * The execution-boundary guard (P3): run `perform` ONLY when a recorded Allow exists.
   * Without one (unknown / pending / denied / already-consumed) `perform` NEVER runs — this
   * is what makes "bypass by calling the service directly" impossible. An `once` allow is
   * consumed on success.
   */
  proceed<T>(requestId: string, perform: () => T): ProceedResult<T>;
  /** Snapshot of still-pending requests (for the CGHC-017 UI). */
  pending(): readonly PermissionRequest[];
  /**
   * D1 fix (follow-up): a SEPARATE, narrow boundary-POLICY deny — used ONLY by a boundary
   * component denying on its own authority (e.g. {@link import("../files/tool-permission-proxy.js").ToolPermissionProxy}
   * auto-denying a tool a dispatch branch's `permissionPreset` forbids), NEVER by the
   * user-facing decision route (`resolve`'s {@link ResolutionInput} has no `reason` field — the
   * router cannot reach this method or forge its reason). Registers `request` with the SAME
   * validation guarantees as {@link submit} (non-empty ids, duplicate-requestId rejection) and
   * IMMEDIATELY finalizes it as denied with the honest `"agent_preset"` audit reason — no
   * `pending` state is ever created and no fail-closed timer is armed (there is no one to wait
   * for an answer from). The deny reply is still forwarded (P3, never stranded) and the session
   * still driven terminal, exactly like any other gate deny.
   */
  denyByPolicy(request: PermissionRequest): Promise<PermissionReply>;
}

export function createPermissionGate(options: PermissionGateOptions): PermissionGate {
  const states = new Map<string, RequestState>();
  const reportReplyError =
    options.onReplyError ??
    ((error: unknown, requestId: string) =>
      // No secret material in a PermissionReply; a non-secret diagnostic line is safe.
      console.error(`[permission] fail-closed reply transport error for ${requestId}:`, error));

  /** Shared deny finalizer for BOTH the explicit-deny and fail-closed-timeout paths. */
  function finalizeDeny(
    request: PermissionRequest,
    level: ApprovalLevel,
    reason: PermissionDecisionReason,
  ): PermissionReply {
    const at = options.now();
    // 1. Record the deny BEFORE anything else — state is fail-closed even if forwarding fails.
    states.set(request.requestId, { status: "denied", request, level, reason });
    // 2. Audit (P5) — structured, no secret values.
    options.audit.record({
      requestId: request.requestId,
      sessionId: request.sessionId,
      actionKind: request.action.kind,
      ...(request.action.targetPath !== undefined ? { targetPath: request.action.targetPath } : {}),
      decision: "deny",
      approvalLevel: level,
      reason,
      at,
    });
    // 3. Drive the session to a terminal `denied` state so it is never stranded (P3).
    options.session.denySession(request.sessionId, request.requestId, at);
    return { requestId: request.requestId, decision: "deny" };
  }

  /** Shared "is this a valid, brand-new request id" guard for `submit` AND `denyByPolicy`. */
  function assertNewRequest(request: PermissionRequest, callerLabel: string): void {
    if (typeof request.requestId !== "string" || request.requestId.length === 0) {
      throw new Error(`PermissionGate.${callerLabel}: requestId must be a non-empty string`);
    }
    if (typeof request.sessionId !== "string" || request.sessionId.length === 0) {
      throw new Error(`PermissionGate.${callerLabel}: sessionId must be a non-empty string`);
    }
    if (states.has(request.requestId)) {
      throw new Error(`PermissionGate.${callerLabel}: duplicate requestId ${JSON.stringify(request.requestId)}`);
    }
  }

  return {
    submit(request) {
      assertNewRequest(request, "submit");
      // P4: the level is boundary-authoritative — recompute from the action kind, never
      // trust the field on the incoming request (a client cannot downgrade a delete).
      const level = classifyApprovalLevel(request.action.kind);
      // P6: arm the fail-closed timer. If it fires first, the request auto-denies.
      const timer = options.scheduler.schedule(options.timeoutMs, () => {
        const current = states.get(request.requestId);
        if (current?.status !== "pending") return; // already resolved — nothing to do.
        const reply = finalizeDeny(request, level, "fail_closed_timeout");
        // No caller to await in the timer path; forward and route any transport error.
        void options.reply.reply(reply).catch((error) => reportReplyError(error, request.requestId));
      });
      states.set(request.requestId, { status: "pending", request, level, timer });
    },

    async resolve(input) {
      const state = states.get(input.requestId);
      if (state === undefined) return { status: "unknown" };
      if (state.status !== "pending") {
        // Never flip an already-decided request (a late Allow cannot override a fail-closed
        // Deny). Report the decision already on record.
        const decision: PermissionDecision = state.status === "denied" ? "deny" : "allow";
        return { status: "already_resolved", decision };
      }
      options.scheduler.cancel(state.timer);
      const { request, level } = state;

      if (input.decision === "deny") {
        const reply = finalizeDeny(request, level, "user_decision");
        // FIX-3: the deny is ALREADY recorded, audited, and the session driven terminal (inside
        // finalizeDeny, BEFORE this point). The server-side Deny is therefore complete and the
        // mutation is blocked regardless of the outbound reply. So a failed forward must NOT
        // surface as a rejected resolve()/500 — report (non-secret) + swallow, EXACTLY like the
        // fail-closed-timeout path. A successful Deny never looks like a transport error to the UI.
        await options.reply.reply(reply).catch((error) => reportReplyError(error, request.requestId));
        return { status: "resolved", reply, approvalLevel: level };
      }

      // Allow: record BEFORE forwarding so isAllowed/proceed are consistent even if the
      // outbound POST fails (the caller then sees the transport error and can retry).
      const scope: PermissionScope = input.scope ?? "once";
      states.set(request.requestId, { status: "allowed", request, level, scope });
      options.audit.record({
        requestId: request.requestId,
        sessionId: request.sessionId,
        actionKind: request.action.kind,
        ...(request.action.targetPath !== undefined ? { targetPath: request.action.targetPath } : {}),
        decision: "allow",
        approvalLevel: level,
        reason: "user_decision",
        at: options.now(),
      });
      const reply: PermissionReply = { requestId: request.requestId, decision: "allow", scope };
      await options.reply.reply(reply);
      return { status: "resolved", reply, approvalLevel: level };
    },

    isAllowed(requestId) {
      return states.get(requestId)?.status === "allowed";
    },

    proceed<T>(requestId: string, perform: () => T): ProceedResult<T> {
      const state = states.get(requestId);
      if (state?.status !== "allowed") return { performed: false, reason: "not_allowed" };
      // Run the real mutation, THEN consume an `once` allow so a replay cannot reuse it.
      const result = perform();
      if (state.scope === "once") {
        states.set(requestId, { status: "consumed", request: state.request, level: state.level });
      }
      return { performed: true, result };
    },

    async denyByPolicy(request) {
      // Same brand-new-request guarantees as `submit` — including the duplicate-requestId
      // rejection, so a policy deny can never silently override (or be confused with) a request
      // already known to the gate via the ordinary ask path.
      assertNewRequest(request, "denyByPolicy");
      const level = classifyApprovalLevel(request.action.kind);
      // No `pending` state is ever set and no timer is armed — this request is decided already;
      // there is nothing to wait for and nothing to auto-deny later.
      const reply = finalizeDeny(request, level, "agent_preset");
      await options.reply.reply(reply).catch((error) => reportReplyError(error, request.requestId));
      return reply;
    },

    pending() {
      const out: PermissionRequest[] = [];
      for (const state of states.values()) {
        if (state.status === "pending") out.push(state.request);
      }
      return out;
    },
  };
}
