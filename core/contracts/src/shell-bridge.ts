/**
 * Preload bridge contract (CGHC-SHELL scaffold).
 *
 * The single, shell-neutral description of the NARROW API that the Electron preload
 * exposes to the renderer via `contextBridge.exposeInMainWorld`. Both surfaces depend
 * on this type so neither duplicates the shape and so `app/ui` never has to import
 * `app/shell` to know it (import-direction rule, CGHC-003): the renderer imports this
 * type from `@cowork-ghc/contracts`; the preload imports it from the same place.
 *
 * This is deliberately tiny: only the native capabilities the shell owns and the
 * handshake that lets the renderer become a client of the loopback service. There is
 * NO generic `invoke(channel, …)` here — every capability is an explicit, typed method.
 */

/**
 * The one-shot handshake the renderer needs to become a client of the loopback service
 * (ADR 0003). `serviceBaseUrl` + `clientToken` are handed to the renderer in memory over
 * the preload bridge; the token is a per-launch secret and must never be persisted to
 * disk, written to `localStorage`, placed in the DOM, or logged.
 */
export interface RendererBootstrap {
  /** Loopback base URL of the local application service, e.g. `http://127.0.0.1:53421`. */
  readonly serviceBaseUrl: string;
  /** Per-launch client token to present on every boundary request (Bearer). Secret. */
  readonly clientToken: string;
}

/** Result of the native folder picker (W1). `rootPath` is present only when not canceled. */
export interface PickedWorkspaceFolder {
  readonly canceled: boolean;
  /** Absolute path the user selected; omitted when `canceled` is true. */
  readonly rootPath?: string;
}

/**
 * Result of a "connect to the live runtime" request. Restart is best-effort + always honest: the
 * true outcome is reflected by the readiness handshake the renderer re-polls afterwards (a failed
 * live start surfaces as `not_connected`, never a fake ready), so this carries no secret and only a
 * coarse acknowledgement the UI can use to show a transient "connecting…" state.
 */
export interface ConnectLiveResult {
  /** `true` once the shell has attempted the live restart (NOT a promise that it succeeded). */
  readonly restarted: boolean;
}

/**
 * The complete renderer-visible bridge surface. Extended by later UI tasks ONLY with
 * additional explicit, typed native-capability methods — never a passthrough.
 */
export interface CoworkShellBridge {
  /** Hand the renderer its loopback base URL + per-launch client token (in memory). */
  readonly getBootstrap: () => Promise<RendererBootstrap>;
  /** Open the OS folder picker (native capability owned by the shell, W1). */
  readonly pickWorkspaceFolder: () => Promise<PickedWorkspaceFolder>;
  /**
   * Restart the loopback service so it re-resolves its launch config from the now-persisted
   * onboarding settings — i.e. transition from the settings-only onboarding service to the LIVE
   * runtime (spawn OpenCode). User-gated: the renderer calls this from an explicit "Connect" action
   * once a workspace + provider + key + default model are configured. After it resolves, the
   * renderer re-runs the readiness handshake to pick up the new base URL + token (or an honest
   * not_connected if the live start failed).
   */
  readonly connectLive: () => Promise<ConnectLiveResult>;
}

/** Global key under which the preload exposes {@link CoworkShellBridge} on `window`. */
export const COWORK_SHELL_BRIDGE_KEY = "coworkShell";
