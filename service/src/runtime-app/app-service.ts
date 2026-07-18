/**
 * AppService — the SINGLE owner of the one active desktop-app runtime (Code Slice 2).
 *
 * A sibling of {@link import("../runtime-preview/preview-service.js").PreviewService} that REUSES
 * the same bounded process-runner primitives (there is no second process manager):
 *  - {@link import("../runtime-preview/preview-spawner.js").nodePreviewSpawner} — argument-array
 *    spawn with captured stdio, and `terminateChildTree` for whole-tree, no-orphan termination;
 *  - {@link import("../runtime-preview/launch-policy.js")} — the `<pm> run <script>` argument
 *    array (never a shell string), the curated no-secret child env, and the strict validators;
 *  - {@link import("../runtime-preview/output-buffer.js").createOutputBuffer} — redacted +
 *    size-bounded output;
 *  - a preview-style {@link PermissionGate} — every Build/Run runs ONLY inside `proceed` after an
 *    explicit Allow.
 *
 * It differs from the web preview in its LIFECYCLE only: an optional `build` step, then a `run`
 * that launches the app as its OWN separate process/window (NEVER embedded). "Running" is the
 * honest fact that the launched process is still alive past a short readiness window — there is
 * no port to detect and nothing is embedded.
 *
 * SECURITY invariants enforced here (not in the UI): permission-gated launch; command is only a
 * validated `<pm> run <script>` chosen from the detected scripts; cwd confined to the active
 * workspace; curated env (no provider/vault/MS365 secret); output redacted + bounded; stop uses
 * whole-tree termination so nothing is orphaned; we only ever kill the PID we spawned.
 */

import type {
  RuntimeAppAction,
  RuntimeAppKind,
  RuntimeAppOutput,
  RuntimeAppProjectInfo,
  RuntimeAppStartInput,
  RuntimeAppState,
  RuntimePreviewPackageManager,
} from "@cowork-ghc/contracts";
import type { PermissionGate } from "../permission/permission-gate.js";
import { createPermissionRequest } from "../permission/approval-level.js";
import { createWorkspaceGuard } from "../workspace/guard.js";
import { grantWorkspace } from "../workspace/grant.js";
import type { SecretScrubber } from "../diagnostics/secret-scrubber.js";
import { createOutputBuffer, type OutputBuffer } from "../runtime-preview/output-buffer.js";
import {
  buildDevServerCommand,
  buildPreviewEnv,
  InvalidLaunchError,
  type PreviewLaunchCommand,
} from "../runtime-preview/launch-policy.js";
import {
  nodePreviewSpawner,
  terminateChildTree,
  type PreviewChild,
  type PreviewSpawner,
} from "../runtime-preview/preview-spawner.js";
import { detectAppProject } from "./app-detector.js";

const DEFAULT_READINESS_MS = 1_500;
const DEFAULT_GRACEFUL_STOP_MS = 4_000;
/** The synthetic session id for user-initiated app launches (no OpenCode session). */
const APP_SESSION_ID = "runtime-app";

export type AppStopReason = "user" | "workspace_changed" | "shutdown" | "restart";

export interface AppServiceDeps {
  readonly getActiveRoot: () => string | undefined;
  readonly gate: PermissionGate;
  readonly scrubber: SecretScrubber;
  readonly spawner?: PreviewSpawner;
  readonly detect?: (root: string) => Promise<RuntimeAppProjectInfo>;
  /** Confine + realpath the cwd inside the workspace; returns the safe absolute cwd. */
  readonly confineCwd?: (root: string) => Promise<string>;
  readonly parentEnv?: Readonly<Record<string, string | undefined>>;
  readonly comspec?: string;
  readonly now?: () => string;
  readonly log?: (line: string) => void;
  readonly telemetry?: (counter: string) => void;
  readonly readinessMs?: number;
  readonly gracefulStopMs?: number;
  /** One-shot readiness timer seam (tests inject a manual one). Defaults to setTimeout. */
  readonly setTimer?: (fn: () => void, ms: number) => { cancel: () => void };
}

export interface RequestAppLaunchResult {
  readonly requestId: string;
  readonly action: RuntimeAppAction;
  readonly command: string;
  readonly cwd: string;
}

interface PendingLaunch {
  readonly requestId: string;
  readonly action: RuntimeAppAction;
  readonly launch: PreviewLaunchCommand;
  readonly script: string;
}

const noop = (): void => {};

export interface AppService {
  detect(): Promise<RuntimeAppProjectInfo>;
  state(): RuntimeAppState;
  output(afterSeq: number): RuntimeAppOutput;
  /** Step 1 of a Build/Run: validate + raise a `command_exec` permission request. */
  requestLaunch(input: RuntimeAppStartInput): Promise<RequestAppLaunchResult>;
  /** Step 2: resolve the launch permission; on Allow, start inside the gate. */
  resolveLaunch(requestId: string, decision: "allow" | "deny"): Promise<RuntimeAppState>;
  /** Restart the app (re-uses the last approved RUN launch; never re-runs a build). */
  restart(): Promise<RuntimeAppState>;
  /** Stop the active app. */
  stop(reason?: AppStopReason): Promise<RuntimeAppState>;
  /** Tear down for workspace change / service shutdown (idempotent). */
  dispose(reason: AppStopReason): Promise<void>;
}

export function createAppService(deps: AppServiceDeps): AppService {
  const spawner = deps.spawner ?? nodePreviewSpawner();
  const detect = deps.detect ?? detectAppProject;
  const parentEnv = deps.parentEnv ?? process.env;
  const now = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? noop;
  const telemetry = deps.telemetry ?? noop;
  const readinessMs = deps.readinessMs ?? DEFAULT_READINESS_MS;
  const gracefulStopMs = deps.gracefulStopMs ?? DEFAULT_GRACEFUL_STOP_MS;
  const setTimer =
    deps.setTimer ??
    ((fn, ms) => {
      const handle = setTimeout(fn, ms);
      (handle as { unref?: () => void }).unref?.();
      return { cancel: () => clearTimeout(handle) };
    });
  const rawConfineCwd =
    deps.confineCwd ??
    (async (root: string) => {
      const guard = createWorkspaceGuard(grantWorkspace({ rootPath: root }));
      return guard.assertRealPathInside(".");
    });
  const confineCwd = async (root: string): Promise<string> => {
    try {
      return await rawConfineCwd(root);
    } catch (err) {
      throw new InvalidLaunchError(
        `Không thể xác nhận thư mục làm việc nằm trong workspace: ${(err as Error).message}`,
      );
    }
  };

  const output: OutputBuffer = createOutputBuffer(deps.scrubber);

  // --- Mutable state (single active app) ---
  let status: RuntimeAppState["status"] = "stopped";
  let kind: RuntimeAppKind | null = null;
  let action: RuntimeAppAction | null = null;
  let command: string | null = null;
  let script: string | null = null;
  let startedAt: string | null = null;
  let error: string | null = null;
  let exitCode: number | null = null;

  let child: PreviewChild | null = null;
  let stopping = false;
  let readinessTimer: { cancel: () => void } | null = null;
  let pending: PendingLaunch | null = null;
  let approvedRun: PendingLaunch | null = null;

  function snapshot(): RuntimeAppState {
    return { status, kind, action, command, script, startedAt, error, exitCode, outputSeq: output.totalSeq() };
  }

  function emitSystem(text: string): void {
    output.append("system", text + "\n", now());
  }

  function clearReadiness(): void {
    readinessTimer?.cancel();
    readinessTimer = null;
  }

  function fail(message: string, code: number | null = null): void {
    error = deps.scrubber.scrub(message);
    status = "failed";
    exitCode = code;
    clearReadiness();
    emitSystem(`Lỗi: ${error}`);
    telemetry("app_failed");
    log(`app_failed: ${error}`);
  }

  function onOutput(stream: "stdout" | "stderr", chunk: string): void {
    output.append(stream, chunk, now());
  }

  const terminateChild = (c: PreviewChild): Promise<void> => terminateChildTree(c, gracefulStopMs);

  function onChildExit(code: number | null): void {
    if (child === null) return;
    child = null;
    clearReadiness();
    exitCode = code;
    if (stopping) {
      status = "stopped";
      return;
    }
    if (status === "building") {
      if (code === 0) {
        status = "stopped";
        emitSystem("Build thành công. Sẵn sàng chạy ứng dụng.");
        telemetry("app_build_succeeded");
        log("app_build_succeeded");
      } else {
        fail(`Build thất bại (mã ${code ?? "?"}).`, code);
      }
      return;
    }
    // A `run` process exited (during starting or while running).
    if (code === 0) {
      // Clean exit — the app closed itself (or exited before its window persisted).
      status = "stopped";
      emitSystem(`Ứng dụng đã thoát (mã 0).`);
      telemetry("app_stopped");
      log("app_exit_clean");
    } else {
      fail(`Ứng dụng dừng bất ngờ (mã ${code ?? "?"}).`, code);
    }
  }

  function startReadiness(): void {
    clearReadiness();
    readinessTimer = setTimer(() => {
      readinessTimer = null;
      if (status === "starting" && child !== null) {
        status = "running";
        error = null;
        emitSystem("Ứng dụng đang chạy.");
        telemetry("app_running");
        log("app_running");
      }
    }, readinessMs);
  }

  async function doStart(launch: PreviewLaunchCommand, act: RuntimeAppAction, scriptName: string): Promise<void> {
    const root = deps.getActiveRoot();
    if (root === undefined || root.trim().length === 0) {
      throw new InvalidLaunchError("Chưa chọn workspace.");
    }
    const cwd = await confineCwd(root);
    // Reuse the curated preview env (allowlist only, no inherited secret). Port steering is
    // harmless for a desktop app; the app ignores it.
    const env = buildPreviewEnv(parentEnv, 0);

    output.clear();
    stopping = false;
    kind = "electron";
    action = act;
    command = launch.display;
    script = scriptName;
    error = null;
    exitCode = null;
    startedAt = now();
    status = act === "build" ? "building" : "starting";

    emitSystem(`${act === "build" ? "Đang build" : "Đang khởi động ứng dụng"}: ${launch.display}`);
    telemetry(act === "build" ? "app_build_started" : "app_run_started");
    log(`app_start action=${act} display=${launch.display}`);

    const c = spawner.spawn(launch.command, launch.args, { cwd, env });
    child = c;
    c.onData((stream, chunk) => onOutput(stream, chunk));
    c.once("exit", ((code: number | null) => onChildExit(code)) as never);
    c.once("error", ((err: Error) => {
      if (child === c) child = null;
      clearReadiness();
      fail(`Không khởi chạy được lệnh: ${err.message}`);
    }) as never);

    if (act === "run") startReadiness();
  }

  function pickScript(info: RuntimeAppProjectInfo, act: RuntimeAppAction, requested?: string): string {
    const list = act === "build" ? info.buildScripts : info.runScripts;
    if (list.length === 0) {
      throw new InvalidLaunchError(
        act === "build" ? "Dự án không có script build." : "Dự án không có script chạy ứng dụng.",
      );
    }
    const chosen = requested ?? list[0]!;
    if (!list.includes(chosen)) {
      throw new InvalidLaunchError(`Script không hợp lệ cho ${act}: ${JSON.stringify(chosen)}`);
    }
    return chosen;
  }

  return {
    async detect() {
      const root = deps.getActiveRoot();
      if (root === undefined || root.trim().length === 0) {
        return {
          kind: "unsupported",
          hasPackageJson: false,
          packageJsonMalformed: false,
          hasElectronDependency: false,
          runScripts: [],
          buildScripts: [],
          packageManager: null,
          reason: "Chưa chọn workspace.",
        };
      }
      return detect(root);
    },

    state() {
      return snapshot();
    },

    output(afterSeq: number) {
      return { state: snapshot(), lines: output.since(afterSeq), truncated: output.hasDropped() };
    },

    async requestLaunch(input) {
      if (status === "building" || status === "starting" || status === "running" || status === "stopping") {
        throw new InvalidLaunchError("Ứng dụng đang chạy hoặc đang build. Hãy dừng trước.");
      }
      if (input.action !== "build" && input.action !== "run") {
        throw new InvalidLaunchError("action phải là 'build' hoặc 'run'.");
      }
      const root = deps.getActiveRoot();
      if (root === undefined || root.trim().length === 0) {
        throw new InvalidLaunchError("Chưa chọn workspace.");
      }
      const info = await detect(root);
      if (info.kind === "unsupported") {
        throw new InvalidLaunchError(info.reason ?? "Dự án không hỗ trợ chạy ứng dụng.");
      }
      const scriptName = pickScript(info, input.action, input.script);
      const pm: RuntimePreviewPackageManager = input.packageManager ?? info.packageManager ?? "npm";
      const launch = buildDevServerCommand(pm, scriptName, deps.comspec);
      const cwd = await confineCwd(root);

      const requestId = `app-${input.action}-${now()}-${scriptName}`;
      const request = createPermissionRequest({
        requestId,
        sessionId: APP_SESSION_ID,
        action: {
          kind: "command_exec",
          description:
            input.action === "build"
              ? `Build ứng dụng desktop: chạy "${launch.display}" trong workspace.`
              : `Chạy ứng dụng desktop: "${launch.display}" trong workspace (mở cửa sổ riêng).`,
        },
        requestedAt: now(),
      });
      deps.gate.submit(request);
      pending = { requestId, action: input.action, launch, script: scriptName };
      return { requestId, action: input.action, command: launch.display, cwd };
    },

    async resolveLaunch(requestId, decision) {
      if (pending === null || pending.requestId !== requestId) {
        await deps.gate.resolve({ requestId, decision }).catch(() => undefined);
        return snapshot();
      }
      const outcome = await deps.gate.resolve({
        requestId,
        decision,
        ...(decision === "allow" ? { scope: "always" as const } : {}),
      });
      if (decision === "deny" || outcome.status !== "resolved") {
        pending = null;
        emitSystem("Đã từ chối chạy lệnh ứng dụng.");
        return snapshot();
      }
      const toStart = pending;
      pending = null;
      // Remember the last approved RUN so Restart can re-run without re-prompting.
      if (toStart.action === "run") approvedRun = toStart;
      const result = deps.gate.proceed(requestId, () => doStart(toStart.launch, toStart.action, toStart.script));
      if (result.performed) await result.result;
      return snapshot();
    },

    async restart() {
      const approved = approvedRun;
      await this.stop("restart");
      if (approved === null) {
        return snapshot();
      }
      const result = deps.gate.proceed(approved.requestId, () => doStart(approved.launch, "run", approved.script));
      if (!result.performed) {
        fail("Cần phê duyệt lại lệnh để chạy ứng dụng.");
        return snapshot();
      }
      await result.result;
      return snapshot();
    },

    async stop(reason: AppStopReason = "user") {
      stopping = true;
      clearReadiness();
      const c = child;
      child = null;
      if (c !== null) {
        status = "stopping";
        await terminateChild(c);
      }
      if (status !== "failed") status = "stopped";
      if (reason !== "restart") emitSystem(`Đã dừng ứng dụng (${reason}).`);
      telemetry("app_stopped");
      log(`app_stop reason=${reason}`);
      return snapshot();
    },

    async dispose(reason) {
      await this.stop(reason);
      if (reason === "workspace_changed" || reason === "shutdown") {
        approvedRun = null;
        pending = null;
        status = "stopped";
        kind = null;
        action = null;
        command = null;
        script = null;
        error = null;
        exitCode = null;
        startedAt = null;
        output.clear();
      }
    },
  };
}
