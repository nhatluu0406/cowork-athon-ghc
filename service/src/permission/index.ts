/**
 * `@cowork-ghc/service` permission module — execution-boundary permission enforcement
 * (CGHC-016, P1/P3/P4/P5/P6).
 *
 * The {@link createPermissionGate} is the single authority over pending requests; enforcement
 * is SERVER-SIDE (a Deny actually blocks — a decision object is not authorization). Local
 * barrel; the top-level `service/src/index.ts` is owned by the orchestrator and wires this
 * module + the LIVE OpenCode reply adapter later (CGHC-018). Downstream consumers:
 *  - CGHC-017 (Allow/Deny modal) reads {@link PermissionGate.pending} and calls
 *    {@link PermissionGate.resolve}; a UI Deny maps to a real server-side block.
 *  - CGHC-018 (file mutation) calls {@link PermissionGate.proceed} at the mutation site so a
 *    mutation runs only behind a recorded Allow, and supplies the live {@link RuntimeReplyPort}.
 */

export { classifyApprovalLevel, createPermissionRequest, type PermissionRequestInput } from "./approval-level.js";

export { createInMemoryAuditSink, type InMemoryAuditSink } from "./audit.js";

export { createNodeScheduler } from "./timer.js";

export {
  createPermissionGate,
  type PermissionGate,
  type PermissionGateOptions,
  type ResolutionInput,
  type ResolutionOutcome,
  type ProceedResult,
} from "./permission-gate.js";

export {
  createSessionDenialSink,
  noopSessionDenialSink,
  type SessionDenialTarget,
} from "./session-denial.js";

export {
  createBranchPermissionBindings,
  type BranchPermissionBindings,
} from "./branch-permission-bindings.js";

export {
  createPermissionRouter,
  PermissionRequestError,
  PERMISSION_PENDING_PATH,
  PERMISSION_DECISION_PATH,
  type PendingPermissionView,
  type PermissionDecisionResponse,
} from "./router.js";

export type {
  PermissionAuditEvent,
  PermissionAuditSink,
  PermissionDecisionReason,
  RuntimeReplyPort,
  SessionDenialSink,
  TimerHandle,
  TimerScheduler,
} from "./ports.js";
