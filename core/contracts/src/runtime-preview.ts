/**
 * Runtime preview contract types (Code surface — runtime web preview, Slice 1).
 *
 * These describe a BOUNDED, user-approved local preview process for the active workspace:
 *  - a static HTML/CSS/JS project served by a loopback static file server, OR
 *  - a frontend project's dev server started from a package.json script the user picked.
 *
 * SECURITY (enforced service-side, never in these types):
 *  - Every launch is gated by an explicit `command_exec` permission decision.
 *  - The command is only ever a package-manager `run <script>` chosen by the user from the
 *    detected script list — NEVER an arbitrary string from a model or a project file.
 *  - The cwd is confined to the active workspace via the WorkspaceGuard (realpath/symlink).
 *  - Captured output is redacted (secret scrubber) and size-bounded before it reaches here.
 *
 * There is no field in these DTOs that carries secrets, absolute host paths beyond the
 * workspace-relative cwd label, or raw environment values.
 */

/** What kind of preview is running. */
export type RuntimePreviewKind = "static" | "dev-server";

/**
 * Lifecycle status of the single active preview.
 *  - `idle`     — nothing running.
 *  - `starting` — process spawned / server binding; URL not confirmed yet.
 *  - `running`  — a loopback URL is confirmed and reachable.
 *  - `stopped`  — user (or a lifecycle event) stopped it cleanly.
 *  - `failed`   — spawn error, startup timeout, crash, or unsupported project.
 */
export type RuntimePreviewStatus = "idle" | "starting" | "running" | "stopped" | "failed";

/** Package managers the runner will launch (fixed allowlist; never a free-form command). */
export type RuntimePreviewPackageManager = "npm" | "pnpm" | "yarn";

/**
 * Result of inspecting the active workspace for previewable capability. This is honest:
 * a project with neither a static index nor a runnable dev script is `unsupported`.
 */
export interface RuntimePreviewProjectInfo {
  /** The best-supported preview kind, or `unsupported` when neither path applies. */
  readonly kind: RuntimePreviewKind | "unsupported";
  /** A root-level `index.html` exists (static preview candidate). */
  readonly hasStaticIndex: boolean;
  /** A readable `package.json` exists. */
  readonly hasPackageJson: boolean;
  /** `package.json` was present but could not be parsed as JSON. */
  readonly packageJsonMalformed: boolean;
  /** Candidate dev-server scripts detected in `package.json` (e.g. dev, start, serve, preview). */
  readonly devScripts: readonly string[];
  /** Package manager inferred from a lockfile, or `npm` as the default when a script exists. */
  readonly packageManager: RuntimePreviewPackageManager | null;
  /** Non-secret human-readable reason when `kind === "unsupported"`. */
  readonly reason?: string;
}

/** The observable state of the active preview (safe to send to the renderer). */
export interface RuntimePreviewState {
  readonly status: RuntimePreviewStatus;
  readonly kind: RuntimePreviewKind | null;
  /** Confirmed loopback URL to embed, or `null` until `running`. */
  readonly url: string | null;
  /** Confirmed loopback port, or `null` until `running`. */
  readonly port: number | null;
  /** Non-secret display of the launched command (e.g. "npm run dev"); `null` for static. */
  readonly command: string | null;
  /** ISO-8601 start time, or `null`. */
  readonly startedAt: string | null;
  /** Redacted, non-secret error message when `status === "failed"`, else `null`. */
  readonly error: string | null;
  /** Total number of output lines produced so far (renderer polls for newer ones). */
  readonly outputSeq: number;
}

/** One captured, already-redacted output line. */
export interface RuntimePreviewOutputLine {
  readonly seq: number;
  readonly stream: "stdout" | "stderr" | "system";
  /** Redacted, size-bounded text (no trailing newline). */
  readonly text: string;
  readonly at: string;
}

/** Response of the output tail endpoint. */
export interface RuntimePreviewOutput {
  readonly state: RuntimePreviewState;
  readonly lines: readonly RuntimePreviewOutputLine[];
  /** True when older lines were dropped by the bounded buffer before `lines[0]`. */
  readonly truncated: boolean;
}

/** Request body to start a preview. */
export interface RuntimePreviewStartInput {
  readonly kind: RuntimePreviewKind;
  /** For `dev-server`: the script name (must be one of the detected `devScripts`). */
  readonly script?: string;
  /** For `dev-server`: the detected package manager (defaults to the detected one). */
  readonly packageManager?: RuntimePreviewPackageManager;
}
