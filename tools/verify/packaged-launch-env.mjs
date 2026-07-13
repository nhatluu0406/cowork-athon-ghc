/**
 * Shared child-process environment for packaged Electron verification.
 */

/** Local-service readiness copy (legacy topbar + V3 status bar). */
export const LOCAL_SERVICE_READY = /(?:Local service:|Service ·)\s*Sẵn sàng/i;

/** V3 status bar with legacy topbar fallback for packaged verifiers. */
export const SERVICE_STATUS_SELECTOR = ".status-bar__service, .topbar__status";

/** Provider/settings entry (V3 status bar + legacy topbar gateway). */
export const PROVIDER_SETTINGS_SELECTOR = ".status-bar__provider, .topbar__gateway";

/** Full-screen settings surface or legacy modal. */
export const SETTINGS_ROOT_SELECTOR = ".settings-surface:not([hidden]), .modal:not([hidden])";

/** Close/back control for settings surface or legacy modal. */
export const SETTINGS_CLOSE_SELECTOR =
  ".settings-surface__close, .settings-surface__back, .modal .icon-btn";

/** New conversation control in contextual sidebar. */
export const NEW_CONVERSATION_SELECTOR = ".cowork-sidebar__new, .sidebar__new-btn";

/** Continuation unlock when composer is locked. */
export const CONTINUATION_UNLOCK_SELECTOR =
  ".continuation-banner__button, .continuation-banner .label-btn";

/**
 * Build a child env for packaged Cowork GHC launches.
 * Strips ELECTRON_RUN_AS_NODE so the binary starts as a GUI app.
 */
export function packagedChildEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
