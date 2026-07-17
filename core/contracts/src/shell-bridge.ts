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
  /**
   * When true, the service exposes POST /v1/credentials/import-env (development / verification
   * only). The renderer may offer a dev-only import action; never used in normal production UX.
   */
  readonly allowEnvCredentialImport?: boolean;
}

/** Result of the native file picker for workspace attachments. */
export interface PickedWorkspaceFile {
  readonly canceled: boolean;
  /** Absolute path the user selected; omitted when `canceled` is true. */
  readonly filePath?: string;
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

/** Request to save a text blob to a user-chosen path via the native save dialog (diagnostics export). */
export interface SaveTextFileRequest {
  /** Suggested file name shown in the save dialog. */
  readonly filename: string;
  /** UTF-8 text content to write. The shell writes it verbatim to the chosen path. */
  readonly content: string;
}

/** Result of a native save-dialog write. `path` is present only when the user confirmed a location. */
export interface SaveTextFileResult {
  readonly canceled: boolean;
  /** Absolute path written; omitted when canceled or on write failure. */
  readonly path?: string;
}

/** Visual theme used to keep the native Windows title-bar overlay aligned with the renderer. */
export type WindowTheme = "light" | "dark";

/**
 * Geometry (in renderer DIP, relative to the window content) for the embedded runtime-preview
 * surface, plus whether it should be shown. The renderer measures its preview pane and syncs
 * this whenever the layout changes or a modal/permission dialog needs the view hidden.
 */
export interface PreviewViewBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Show the view only when the Preview pane is actually visible + unobstructed. */
  readonly visible: boolean;
}

/** Result of asking the shell to load a URL into the embedded preview surface. */
export interface PreviewLoadResult {
  /** True when the URL was accepted (loopback http/https) and load was initiated. */
  readonly ok: boolean;
  /** Non-secret reason when rejected (e.g. a non-loopback URL). */
  readonly error?: string;
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
  /** Open the OS file picker for workspace text attachments (scoped to active workspace). */
  readonly pickWorkspaceFile: (workspaceRoot: string) => Promise<PickedWorkspaceFile>;
  /**
   * Restart the loopback service so it re-resolves its launch config from the now-persisted
   * onboarding settings — i.e. transition from the settings-only onboarding service to the LIVE
   * runtime (spawn OpenCode). User-gated: the renderer calls this from an explicit "Connect" action
   * once a workspace + provider + key + default model are configured. After it resolves, the
   * renderer re-runs the readiness handshake to pick up the new base URL + token (or an honest
   * not_connected if the live start failed).
   */
  readonly connectLive: () => Promise<ConnectLiveResult>;
  /** Synchronize the native title-bar overlay with the renderer theme. */
  readonly setWindowTheme: (theme: WindowTheme) => Promise<void>;
  /** Open or close Electron DevTools for the main window (Settings → Chung). */
  readonly setDevToolsEnabled: (enabled: boolean) => Promise<void>;
  /**
   * Save a text blob (the redacted diagnostics export) to a user-chosen path via the native save
   * dialog. The shell owns the dialog + the write; the renderer never chooses an arbitrary path.
   */
  readonly saveTextFile: (request: SaveTextFileRequest) => Promise<SaveTextFileResult>;
  /**
   * Load a LOOPBACK preview URL into a hardened, separately-governed embedded surface
   * (a WebContentsView the shell owns — NOT an iframe, so the renderer CSP is untouched, and
   * NOT a `<webview>`). Only `http(s)://127.0.0.1|localhost|[::1]` is accepted; the view denies
   * off-loopback navigation, popups, downloads, and webview attach, and runs with no preload.
   */
  readonly previewLoad: (url: string) => Promise<PreviewLoadResult>;
  /** Position/size/show the embedded preview surface over the renderer's Preview pane. */
  readonly previewSetBounds: (bounds: PreviewViewBounds) => Promise<void>;
  /** Hide the embedded preview surface (modal open / surface switch / drawer overlap). */
  readonly previewHide: () => Promise<void>;
  /** Reload the current preview page. */
  readonly previewReload: () => Promise<void>;
  /** Tear down the embedded preview surface entirely. */
  readonly previewClose: () => Promise<void>;
}

/** Global key under which the preload exposes {@link CoworkShellBridge} on `window`. */
export const COWORK_SHELL_BRIDGE_KEY = "coworkShell";
