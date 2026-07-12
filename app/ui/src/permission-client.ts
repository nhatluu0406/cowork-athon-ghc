/**
 * Permission sub-client of the loopback service (CGHC-017, split out of {@link ./service-client}
 * in CGHC-025 to keep each file cohesive + under the size budget).
 *
 * Carries the non-secret permission wire types (mirrored from `service/src/permission/router.ts`
 * so the renderer bundle stays dependency-free of the Node-only service package) and the two
 * permission routes. It is composed into the single {@link ServiceClient} object — the public
 * import surface is unchanged: consumers still import these names from `./service-client.js`,
 * which re-exports them.
 */

import type {
  ApprovalLevel,
  PermissionActionKind,
  PermissionDecision,
  PermissionScope,
} from "@cowork-ghc/contracts";

/**
 * Non-secret projection of one pending permission request (CGHC-017, P2). Mirrors the WIRE
 * shape of `PendingPermissionView` from `service/src/permission/router.ts`. It carries
 * `action.description`/`action.targetPath` for the P2 "describe the action + its target"
 * requirement, never a secret.
 */
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

/** Outcome of `POST /v1/permission/decision`, mirroring the gate's resolution outcome. */
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

/** Body of a decision POST. `scope` is meaningful only for an allow (the gate ignores it on deny). */
export interface DecidePermissionInput {
  readonly requestId: string;
  readonly decision: PermissionDecision;
  readonly scope?: PermissionScope;
}

/** The typed boundary call helper the service client hands down (a versioned-envelope fetch). */
export type BoundaryCall = <T>(path: string, init?: RequestInit) => Promise<T>;

/** The permission slice of the renderer-visible client surface. */
export interface PermissionClient {
  /**
   * List the pending permission requests (CGHC-017, P1). The UI renders these honestly and
   * never fabricates activity — the list is empty when nothing is awaiting a decision.
   */
  listPendingPermissions(): Promise<readonly PendingPermissionView[]>;
  /**
   * Record an Allow/Deny decision on the single server-side gate. A Deny maps to a REAL
   * server-side block (enforced at the execution boundary, not the UI). The `unknown` /
   * `already_resolved` outcomes are returned honestly — never a fabricated success.
   */
  decidePermission(input: DecidePermissionInput): Promise<PermissionDecisionResponse>;
}

/** Build the permission routes over the shared boundary `call` helper. */
export function createPermissionClient(call: BoundaryCall): PermissionClient {
  return {
    listPendingPermissions: async () =>
      (await call<{ pending: readonly PendingPermissionView[] }>("/v1/permission/pending")).pending,
    // The decision route always returns a success envelope (even the 404 `unknown` body), so
    // `call` resolves with the typed outcome; the controller distinguishes resolved / unknown /
    // already_resolved and never treats a non-`resolved` outcome as a fabricated success.
    decidePermission: (input) =>
      call<PermissionDecisionResponse>("/v1/permission/decision", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };
}
