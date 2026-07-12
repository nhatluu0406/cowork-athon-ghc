/**
 * Main-process lifecycle wiring (CGHC-028 Wave B1) — the testable glue between the Electron
 * `app` lifecycle and the {@link ServiceController} that owns the live service.
 *
 * Kept separate from `main.ts` (which touches the electron singleton at import) so the
 * start/stop ownership is unit-tested against a fake `app`:
 *   - on `whenReady`: START the live service NON-BLOCKING (so a slow/failing start never
 *     hangs the window) and then run the electron-specific ready work (protocol, CSP, IPC
 *     handlers, window). The renderer's readiness surface polls `getBootstrap` and reflects
 *     the true phase;
 *   - on `before-quit`: STOP the live service ONCE (socket + supervised child — one owner),
 *     then quit. Guarded (no re-entry) and bounded (the controller's stop is bounded).
 */

import type { ServiceController } from "./service/service-controller.js";

/** Minimal electron `Event` slice the quit handler needs. */
export interface LifecycleEvent {
  preventDefault(): void;
}

/** The narrow slice of the Electron `app` the lifecycle wiring depends on (mockable). */
export interface LifecycleApp {
  whenReady(): Promise<void>;
  onBeforeQuit(listener: (event: LifecycleEvent) => void): void;
  quit(): void;
}

export interface ShellLifecycleDeps {
  readonly app: LifecycleApp;
  /** The live-service owner. Only its start/stop are used here. */
  readonly controller: Pick<ServiceController, "start" | "stop">;
  /** Electron-specific ready work: protocol, CSP, IPC handlers, window creation. */
  readonly onReady: () => void;
}

/**
 * Wire `before-quit` → stop the live service once, then quit. Guarded so re-entrant quit
 * events (e.g. `window-all-closed` → `app.quit()` → `before-quit`) do not stop twice.
 */
export function installQuitHandler(deps: ShellLifecycleDeps): void {
  let quitting = false;
  deps.app.onBeforeQuit((event) => {
    if (quitting) return;
    quitting = true;
    // Defer the actual quit until the service (and its child) have been stopped.
    event.preventDefault();
    void deps.controller.stop().finally(() => deps.app.quit());
  });
}

/**
 * Run the shell lifecycle: install the quit handler, wait for `whenReady`, kick off the
 * (non-blocking) live-service start, and run the electron-specific ready work.
 */
export async function runShellLifecycle(deps: ShellLifecycleDeps): Promise<void> {
  installQuitHandler(deps);
  await deps.app.whenReady();
  void deps.controller.start();
  deps.onReady();
}
