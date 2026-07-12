/**
 * Shell bootstrap type — the in-memory handshake the shell forwards to the renderer.
 *
 * In a full launch the Electron main process starts the loopback service (ADR 0003) +
 * the supervised OpenCode child (ADR 0004) IN-PROCESS and holds the running-service base
 * URL + per-launch client token in memory (see `service/service-controller.ts`). The shell
 * forwards them to the renderer over the preload bridge on request. The token is a secret:
 * it is never logged, never written to disk, and only leaves the main process over the
 * bridge on `getBootstrap`.
 *
 * When the service is not (yet) running or failed to start, the shell returns
 * {@link EMPTY_BOOTSTRAP} — an honest "not connected" handshake the renderer readiness
 * surface (CGHC-025) renders as `not_connected`. It is NEVER a fabricated ready.
 */

/** In-memory handshake the shell forwards to the renderer (matches `RendererBootstrap`). */
export interface ShellBootstrap {
  readonly serviceBaseUrl: string;
  readonly clientToken: string;
}

/** The honest "not connected" handshake (empty base URL + token) — never a fake ready. */
export const EMPTY_BOOTSTRAP: ShellBootstrap = { serviceBaseUrl: "", clientToken: "" };
