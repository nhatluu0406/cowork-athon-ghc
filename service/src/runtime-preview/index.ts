/**
 * Runtime preview module barrel — the bounded process runner for the Code surface web preview
 * (Slice 1: static HTML + frontend dev server). Desktop app launch is a later slice.
 */

export {
  createPreviewService,
  type PreviewService,
  type PreviewServiceDeps,
  type PreviewStopReason,
  type RequestLaunchResult,
} from "./preview-service.js";
export { createPreviewGate, type PreviewGateOptions } from "./preview-gate.js";
export {
  createRuntimePreviewRouter,
  RUNTIME_PREVIEW_DETECT_PATH,
  RUNTIME_PREVIEW_STATE_PATH,
  RUNTIME_PREVIEW_OUTPUT_PATH,
  RUNTIME_PREVIEW_START_STATIC_PATH,
  RUNTIME_PREVIEW_REQUEST_LAUNCH_PATH,
  RUNTIME_PREVIEW_RESOLVE_PATH,
  RUNTIME_PREVIEW_STOP_PATH,
  RUNTIME_PREVIEW_RESTART_PATH,
} from "./router.js";
export { detectPreviewProject } from "./project-detector.js";
export {
  buildDevServerCommand,
  buildPreviewEnv,
  assertValidScriptName,
  assertValidPackageManager,
  InvalidLaunchError,
  PACKAGE_MANAGERS,
} from "./launch-policy.js";
export { createOutputBuffer, redactLine, MAX_LINE_CHARS, MAX_LINES } from "./output-buffer.js";
export { detectUrlInLine, allocateLoopbackPort, probeLoopbackPort } from "./port-detect.js";
export { startStaticServer, type StaticServerHandle } from "./static-server.js";
export {
  nodePreviewSpawner,
  type PreviewSpawner,
  type PreviewChild,
  type PreviewSpawnOptions,
} from "./preview-spawner.js";
