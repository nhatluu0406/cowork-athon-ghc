/**
 * Launch policy for the bounded preview runner (Code runtime web preview, Slice 1).
 *
 * SECURITY — this module is the choke point that turns a user-approved, allowlisted intent
 * into a concrete spawn. It NEVER accepts a free-form command string:
 *  - the package manager is a fixed allowlist ("npm" | "pnpm" | "yarn");
 *  - the script name must match a strict token pattern AND be one the detector found;
 *  - the child env is a CURATED ALLOWLIST of the parent env (never the full `process.env`,
 *    so no provider key / vault / MS365 secret is inherited) plus a few steering vars;
 *  - the spawn is `cmd.exe /d /s /c <pm> run <script>` as an ARGUMENT ARRAY — never a
 *    concatenated shell string. `cmd.exe` is required because Node refuses to spawn the
 *    `.cmd` package-manager shims without a shell (CVE-2024-27980); the wrapper keeps the
 *    argument array form and the strict validation makes cmd re-parsing injection-safe.
 */

import type { RuntimePreviewPackageManager } from "@cowork-ghc/contracts";

/** The only package managers the runner will launch. */
export const PACKAGE_MANAGERS: readonly RuntimePreviewPackageManager[] = ["npm", "pnpm", "yarn"];

/** A script name is a conservative token: letters, digits, and `:._-` only (npm-style). */
const SCRIPT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;

/**
 * Environment variables the preview child is allowed to inherit from the parent. This is an
 * ALLOWLIST — everything else (provider keys, `CGHC_*`, `OPENCODE_*`, tokens) is dropped.
 * These are the Windows essentials a dev server / package manager needs to run.
 */
const ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SystemDrive",
  "windir",
  "COMSPEC",
  "ComSpec",
  "TEMP",
  "TMP",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
];

export class InvalidLaunchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLaunchError";
  }
}

/** Validate a script name against the strict token pattern; throws {@link InvalidLaunchError}. */
export function assertValidScriptName(script: string): void {
  if (typeof script !== "string" || !SCRIPT_NAME_PATTERN.test(script)) {
    throw new InvalidLaunchError(`Invalid preview script name: ${JSON.stringify(script)}`);
  }
}

/** Validate a package manager against the fixed allowlist; throws {@link InvalidLaunchError}. */
export function assertValidPackageManager(
  pm: string,
): asserts pm is RuntimePreviewPackageManager {
  if (!PACKAGE_MANAGERS.includes(pm as RuntimePreviewPackageManager)) {
    throw new InvalidLaunchError(`Unsupported package manager: ${JSON.stringify(pm)}`);
  }
}

/**
 * Build the CURATED child env: the parent-env allowlist, plus steering vars that keep a dev
 * server headless and predictable. `port` steers frameworks that honour `PORT` (CRA, Next,
 * many others); Vite/others print their own port which the runner detects from output.
 */
export function buildPreviewEnv(
  parentEnv: Readonly<Record<string, string | undefined>>,
  port: number,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ENV_ALLOWLIST) {
    const value = parentEnv[name];
    if (typeof value === "string" && value.length > 0) env[name] = value;
  }
  // Never let the dev server pop a real browser; keep output plain + non-interactive.
  env["BROWSER"] = "none";
  env["OPEN"] = "none";
  env["CI"] = "1";
  env["FORCE_COLOR"] = "0";
  env["NO_COLOR"] = "1";
  env["PORT"] = String(port);
  env["HOST"] = "127.0.0.1";
  return env;
}

/** The concrete, validated spawn description for a dev-server launch. */
export interface PreviewLaunchCommand {
  /** Always `cmd.exe` (see module doc) — the executable. */
  readonly command: string;
  /** Argument array (never a joined string). */
  readonly args: readonly string[];
  /** Non-secret display string for the UI/state (e.g. "npm run dev"). */
  readonly display: string;
}

/**
 * Build the `cmd.exe /d /s /c <pm> run <script>` launch as an argument array. Both `pm` and
 * `script` are validated first, so the string cmd.exe re-parses contains no injectable input.
 */
export function buildDevServerCommand(
  pm: RuntimePreviewPackageManager,
  script: string,
  comspec?: string,
): PreviewLaunchCommand {
  assertValidPackageManager(pm);
  assertValidScriptName(script);
  const shell = comspec && comspec.trim().length > 0 ? comspec : "cmd.exe";
  return {
    command: shell,
    // /d skip AutoRun, /s canonical quote handling, /c run then terminate.
    args: ["/d", "/s", "/c", pm, "run", script],
    display: `${pm} run ${script}`,
  };
}
