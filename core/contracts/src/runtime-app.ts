/**
 * Runtime desktop-app launch contract types (Code surface — desktop app launch, Slice 2).
 *
 * These describe a BOUNDED, user-approved local desktop-application process for the active
 * workspace. Unlike runtime web preview (a dev server embedded in a hardened WebContentsView),
 * a desktop app is launched as its OWN separate process/window and is NEVER embedded in an
 * iframe/WebContentsView. It reuses the SAME bounded process runner primitives as the web
 * preview (argument-array spawn, curated no-secret env, redacted+bounded output, whole-tree
 * no-orphan termination) and the SAME explicit `command_exec` permission gate.
 *
 * SECURITY (enforced service-side, never in these types):
 *  - Every Build/Run is gated by an explicit `command_exec` permission decision.
 *  - The command is only ever a package-manager `run <script>` chosen by the user from the
 *    detected script list — NEVER an arbitrary string/executable from a model or a project file.
 *  - The cwd is confined to the active workspace via the WorkspaceGuard (realpath/symlink).
 *  - The child env is a curated allowlist (no provider/vault/MS365 secret inherited).
 *  - Captured output is redacted (secret scrubber) and size-bounded before it reaches here.
 *
 * No field here carries secrets, absolute host paths beyond the workspace-relative cwd label,
 * or raw environment values.
 */

import type { RuntimePreviewOutputLine, RuntimePreviewPackageManager } from "./runtime-preview.js";

/**
 * The kind of desktop app the runner can launch. Only `electron` is detected today (an
 * `electron` dependency + a runnable script is an unambiguous desktop signal); everything else is
 * reported `unsupported` rather than guessed, so no fake capability is shown.
 */
export type RuntimeAppKind = "electron";

/**
 * Lifecycle status of the single active desktop-app runtime.
 *  - `stopped`  — nothing running (initial + after a clean stop/exit).
 *  - `building` — a build script is running (optional pre-run step).
 *  - `starting` — the run command was spawned; the process has not passed the readiness window.
 *  - `running`  — the launched process is alive past readiness (its window is up).
 *  - `failed`   — spawn error, build failure, missing script, or a non-zero crash.
 *  - `stopping` — a stop/restart is terminating the process tree.
 */
export type RuntimeAppStatus =
  | "stopped"
  | "building"
  | "starting"
  | "running"
  | "failed"
  | "stopping";

/** Which action a launch request performs. */
export type RuntimeAppAction = "build" | "run";

/**
 * Result of inspecting the active workspace for desktop-app capability. Honest: a project with
 * no `electron` dependency (or no runnable script) is `unsupported`.
 */
export interface RuntimeAppProjectInfo {
  /** The supported app kind, or `unsupported` when no safe launch capability applies. */
  readonly kind: RuntimeAppKind | "unsupported";
  /** A readable `package.json` exists. */
  readonly hasPackageJson: boolean;
  /** `package.json` was present but could not be parsed as JSON. */
  readonly packageJsonMalformed: boolean;
  /** `electron` is declared in dependencies/devDependencies. */
  readonly hasElectronDependency: boolean;
  /** Scripts that launch the app (e.g. start, app, electron, dev), in preference order. */
  readonly runScripts: readonly string[];
  /** Optional build scripts (e.g. build, compile, dist, package), in preference order. */
  readonly buildScripts: readonly string[];
  /** Package manager inferred from a lockfile, or `npm` as the default when a script exists. */
  readonly packageManager: RuntimePreviewPackageManager | null;
  /** Non-secret human-readable reason when `kind === "unsupported"`. */
  readonly reason?: string;
}

/** The observable state of the active desktop-app runtime (safe to send to the renderer). */
export interface RuntimeAppState {
  readonly status: RuntimeAppStatus;
  readonly kind: RuntimeAppKind | null;
  /** The action currently/last performed (`build` or `run`), or `null`. */
  readonly action: RuntimeAppAction | null;
  /** Non-secret display of the launched command (e.g. "npm run start"), or `null`. */
  readonly command: string | null;
  /** The script name (must be one of the detected run/build scripts), or `null`. */
  readonly script: string | null;
  /** ISO-8601 start time of the current action, or `null`. Used for elapsed time when running. */
  readonly startedAt: string | null;
  /** Redacted, non-secret error message when `status === "failed"`, else `null`. */
  readonly error: string | null;
  /** Last observed exit code (honesty for crashes/stops), or `null`. */
  readonly exitCode: number | null;
  /** Total number of output lines produced so far (renderer polls for newer ones). */
  readonly outputSeq: number;
}

/** Response of the desktop-app output tail endpoint. */
export interface RuntimeAppOutput {
  readonly state: RuntimeAppState;
  readonly lines: readonly RuntimePreviewOutputLine[];
  /** True when older lines were dropped by the bounded buffer before `lines[0]`. */
  readonly truncated: boolean;
}

/** Request body to build or run the desktop app. */
export interface RuntimeAppStartInput {
  readonly action: RuntimeAppAction;
  /** The script name (must be one of the detected run/build scripts for the action). */
  readonly script?: string;
  /** The detected package manager (defaults to the detected one). */
  readonly packageManager?: RuntimePreviewPackageManager;
}
