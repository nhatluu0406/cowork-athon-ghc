/**
 * Public surface of the workspace-boundary module (CGHC-007, W4/F4).
 *
 * Enforcement lives at the execution boundary (this service), never in the UI. Downstream
 * tasks import `grantWorkspace` + `createWorkspaceGuard` and route every file operation through
 * the guard. The orchestrator wires this local barrel into the service surface after the batch;
 * this file is the ONLY seam this task exposes (it does not edit the top-level service barrel).
 */

export { grantWorkspace, type GrantWorkspaceInput } from "./grant.js";
export {
  createWorkspaceGuard,
  type WorkspaceGuard,
  type WorkspaceGuardOptions,
} from "./guard.js";
export { WorkspaceBoundaryError, WorkspaceGrantError } from "./errors.js";
export {
  type WorkspaceAuditEvent,
  type WorkspaceAuditSink,
  type WorkspacePathRejected,
} from "./audit.js";
export {
  isInsideRoot,
  isUncOrDevicePath,
  resolveWorkspacePath,
} from "./path-safety.js";
export { realPathInsideRoot, realpathAllowingMissing } from "./realpath.js";
export {
  resolveWorkspaceRelativePath,
  type ResolveWorkspaceRelativeResult,
} from "./resolve-relative.js";
export {
  validateWorkspaceSelection,
  nodeFsProbe,
  type WorkspaceValidation,
  type WorkspaceFsProbe,
  type WorkspaceStat,
  type WorkspaceRejectReason,
} from "./validate.js";
export {
  createRecentWorkspaces,
  type RecentWorkspaces,
  type RecentWorkspacesOptions,
  type RecentWorkspaceEntry,
  type RecentWorkspaceView,
  type RecentExistenceProbe,
} from "./recent.js";
export { nodeExistenceProbe } from "./probe.js";
export {
  createWorkspaceRouter,
  WorkspaceRequestError,
  WORKSPACE_GRANT_PATH,
  WORKSPACE_RECENT_PATH,
  type WorkspaceGrantResponse,
  type WorkspaceRouterOptions,
} from "./router.js";
