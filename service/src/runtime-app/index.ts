/**
 * Runtime app module barrel — the bounded desktop-app launcher for the Code surface (Slice 2).
 *
 * Reuses the runtime-preview process primitives (spawner + tree-kill, output buffer, launch
 * policy, permission gate); adds only the app-specific lifecycle + detector. The app is launched
 * as its OWN separate process/window — it is NEVER embedded in a WebContentsView/iframe.
 */

export {
  createAppService,
  type AppService,
  type AppServiceDeps,
  type AppStopReason,
  type RequestAppLaunchResult,
} from "./app-service.js";
export { detectAppProject } from "./app-detector.js";
export {
  createRuntimeAppRouter,
  RUNTIME_APP_DETECT_PATH,
  RUNTIME_APP_STATE_PATH,
  RUNTIME_APP_OUTPUT_PATH,
  RUNTIME_APP_REQUEST_LAUNCH_PATH,
  RUNTIME_APP_RESOLVE_PATH,
  RUNTIME_APP_STOP_PATH,
  RUNTIME_APP_RESTART_PATH,
} from "./router.js";
