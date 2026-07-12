/**
 * Shared child-process environment for packaged Electron verification.
 */

/** Topbar local-service readiness copy after successful connect. */
export const LOCAL_SERVICE_READY = /Local service:.*Sẵn sàng/i;

/**
 * Build a child env for packaged Cowork GHC launches.
 * Strips ELECTRON_RUN_AS_NODE so the binary starts as a GUI app.
 */
export function packagedChildEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
