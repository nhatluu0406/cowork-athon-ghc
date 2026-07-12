/**
 * `@cowork-ghc/service` file-mutation module — the guarded, permission-gated, audited file
 * boundary (CGHC-018, F1/F2/F3/F6/P5).
 *
 * The single filesystem-touching surface for the app. It composes three DONE/reviewed seams
 * without re-implementing them: the workspace guard (confinement), the permission gate
 * (Allow-gated mutation), and the workspace/permission audit sinks (no-secret audit). Local
 * barrel; the top-level `service/src/index.ts` (owned by the orchestrator) wires this module +
 * the live runtime-reply adapter into the service surface.
 */

export { FileOperationError, mapDiskError, type FileErrorReason } from "./errors.js";
export {
  FileService,
  nodeFsPort,
  type FileServiceOptions,
  type FileMutationResult,
  type FsPort,
} from "./file-service.js";
export {
  ToolPermissionProxy,
  mapToolToActionKind,
  type OpencodeToolPermissionEvent,
  type ProxyOutcome,
  type ProxyRefusalReason,
  type ToolPermissionProxyOptions,
} from "./tool-permission-proxy.js";
export {
  createLiveRuntimeReplyPort,
  RuntimeReplyError,
  type LiveRuntimeReplyOptions,
  type RuntimeReplyResponse,
  type RuntimeReplyTransport,
} from "./runtime-permission-proxy.js";
export { createReplyRedactor, type ReplyRedactor, type ReplyRedactorOptions } from "./reply-redaction.js";
