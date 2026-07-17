/**
 * PreviewService — the SINGLE owner of the one active runtime preview (Code Slice 1).
 *
 * Owns a bounded state machine over EITHER a loopback static server (no process, no command)
 * OR one dev-server child process launched from a user-approved package.json script. It is the
 * only place a preview process is spawned or killed; the shell/renderer never spawn anything.
 *
 * SECURITY invariants enforced here (not in the UI):
 *  - a `dev-server` launch runs ONLY inside {@link PermissionGate.proceed} after an explicit
 *    Allow (the launch is a `command_exec` request; a Deny/timeout never starts it);
 *  - the command is always `<pm> run <script>` with `pm`/`script` allowlisted + validated —
 *    never a free-form string from a model or a project file;
 *  - the cwd is confined to the active workspace via the WorkspaceGuard (realpath/symlink);
 *  - the child env is a curated allowlist (no provider/vault/MS365 secret inherited);
 *  - captured output is redacted + size-bounded;
 *  - stop uses graceful-then-force WHOLE-TREE termination so nothing is orphaned; the child is
 *    also a descendant of the service process, so the existing `taskkill /T` reaper covers a
 *    hard crash.
 */

import type {
  RuntimePreviewKind,
  RuntimePreviewOutput,
  RuntimePreviewPackageManager,
  RuntimePreviewProjectInfo,
  RuntimePreviewStartInput,
  RuntimePreviewState,
} from "@cowork-ghc/contracts";
import type { PermissionGate } from "../permission/permission-gate.js";
import { createPermissionRequest } from "../permission/approval-level.js";
import { createWorkspaceGuard } from "../workspace/guard.js";
import { grantWorkspace } from "../workspace/grant.js";
import type { SecretScrubber } from "../diagnostics/secret-scrubber.js";
import { createOutputBuffer, type OutputBuffer } from "./output-buffer.js";
import { detectPreviewProject } from "./project-detector.js";
import { buildDevServerCommand, buildPreviewEnv, InvalidLaunchError, type PreviewLaunchCommand } from "./launch-policy.js";
import { nodePreviewSpawner, type PreviewChild, type PreviewSpawner } from "./preview-spawner.js";
import { allocateLoopbackPort, detectUrlInLine, probeLoopbackPort } from "./port-detect.js";
import { startStaticServer, type StaticServerHandle } from "./static-server.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 45_000;
const DEFAULT_GRACEFUL_STOP_MS = 4_000;
const STARTUP_POLL_MS = 500;
/** The synthetic session id for user-initiated preview launches (no OpenCode session). */
const PREVIEW_SESSION_ID = "runtime-preview";

export type PreviewStopReason = "user" | "workspace_changed" | "shutdown" | "restart";

export interface PreviewServiceDeps {
  /** Active workspace root lookup (single source of truth). */
  readonly getActiveRoot: () => string | undefined;
  /** The dedicated preview permission gate (no-op reply/session sinks; shared audit). */
  readonly gate: PermissionGate;
  /** Free-form output redactor (registered credential values). */
  readonly scrubber: SecretScrubber;
  readonly spawner?: PreviewSpawner;
  readonly startStatic?: (root: string, port: number) => Promise<StaticServerHandle>;
  readonly allocatePort?: () => Promise<number>;
  readonly probePort?: (port: number) => Promise<boolean>;
  readonly detect?: (root: string) => Promise<RuntimePreviewProjectInfo>;
  /** Confine + realpath the cwd inside the workspace; returns the safe absolute cwd. */
  readonly confineCwd?: (root: string) => Promise<string>;
  readonly parentEnv?: Readonly<Record<string, string | undefined>>;
  readonly comspec?: string;
  readonly now?: () => string;
  readonly log?: (line: string) => void;
  readonly telemetry?: (counter: string) => void;
  readonly startupTimeoutMs?: number;
  readonly gracefulStopMs?: number;
  /** Poll seam (tests inject a synchronous stepper). Defaults to setInterval. */
  readonly setPoll?: (fn: () => void, ms: number) => { cancel: () => void };
}

export interface RequestLaunchResult {
  readonly requestId: string;
  readonly command: string;
  readonly cwd: string;
}

interface PendingLaunch {
  readonly requestId: string;
  readonly launch: PreviewLaunchCommand;
  readonly pm: RuntimePreviewPackageManager;
  readonly script: string;
}

const noop = (): void => {};

export interface PreviewService {
  detect(): Promise<RuntimePreviewProjectInfo>;
  state(): RuntimePreviewState;
  output(afterSeq: number): RuntimePreviewOutput;
  /** Start a static preview (no command, no permission). */
  startStaticPreview(): Promise<RuntimePreviewState>;
  /** Step 1 of a dev-server launch: validate + raise a `command_exec` permission request. */
  requestLaunch(input: RuntimePreviewStartInput): Promise<RequestLaunchResult>;
  /** Step 2: resolve the launch permission; on Allow, start inside the gate. */
  resolveLaunch(requestId: string, decision: "allow" | "deny"): Promise<RuntimePreviewState>;
  /** Restart the current preview (re-uses the approved launch / static kind). */
  restart(): Promise<RuntimePreviewState>;
  /** Stop the active preview. */
  stop(reason?: PreviewStopReason): Promise<RuntimePreviewState>;
  /** Tear down for workspace change / service shutdown (idempotent). */
  dispose(reason: PreviewStopReason): Promise<void>;
}

export function createPreviewService(deps: PreviewServiceDeps): PreviewService {
  const spawner = deps.spawner ?? nodePreviewSpawner();
  const startStatic = deps.startStatic ?? startStaticServer;
  const allocatePort = deps.allocatePort ?? allocateLoopbackPort;
  const probePort = deps.probePort ?? probeLoopbackPort;
  const detect = deps.detect ?? detectPreviewProject;
  const parentEnv = deps.parentEnv ?? process.env;
  const now = deps.now ?? (() => new Date().toISOString());
  const log = deps.log ?? noop;
  const telemetry = deps.telemetry ?? noop;
  const startupTimeoutMs = deps.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const gracefulStopMs = deps.gracefulStopMs ?? DEFAULT_GRACEFUL_STOP_MS;
  const setPoll =
    deps.setPoll ??
    ((fn, ms) => {
      const handle = setInterval(fn, ms);
      handle.unref?.();
      return { cancel: () => clearInterval(handle) };
    });
  const confineCwd =
    deps.confineCwd ??
    (async (root: string) => {
      const guard = createWorkspaceGuard(grantWorkspace({ rootPath: root }));
      return guard.assertRealPathInside(".");
    });

  const output: OutputBuffer = createOutputBuffer(deps.scrubber);

  // --- Mutable state (single active preview) ---
  let status: RuntimePreviewState["status"] = "idle";
  let kind: RuntimePreviewKind | null = null;
  let url: string | null = null;
  let port: number | null = null;
  let command: string | null = null;
  let startedAt: string | null = null;
  let error: string | null = null;

  let child: PreviewChild | null = null;
  let staticHandle: StaticServerHandle | null = null;
  let stopping = false;
  let startupDeadline = 0;
  let poll: { cancel: () => void } | null = null;
  let pending: PendingLaunch | null = null;
  let approved: PendingLaunch | null = null;
  let envPort = 0;
  let requestCounter = 0;

  function snapshot(): RuntimePreviewState {
    return { status, kind, url, port, command, startedAt, error, outputSeq: output.totalSeq() };
  }

  function emitSystem(text: string): void {
    output.append("system", text + "\n", now());
  }

  function clearPoll(): void {
    poll?.cancel();
    poll = null;
  }

  function setRunning(confirmedPort: number, confirmedUrl: string): void {
    if (status !== "starting") return;
    status = "running";
    port = confirmedPort;
    url = confirmedUrl;
    error = null;
    clearPoll();
    emitSystem(`Sẵn sàng: ${confirmedUrl}`);
    telemetry("preview_running");
    log(`preview_running kind=${kind ?? ""} port=${confirmedPort}`);
  }

  function fail(message: string): void {
    error = deps.scrubber.scrub(message);
    status = "failed";
    url = null;
    clearPoll();
    emitSystem(`Lỗi: ${error}`);
    telemetry("preview_failed");
    log(`preview_failed: ${error}`);
  }

  function onOutput(stream: "stdout" | "stderr", chunk: string): void {
    output.append(stream, chunk, now());
    if (status === "starting" && url === null) {
      for (const line of chunk.split(/\r?\n/)) {
        const detected = detectUrlInLine(line);
        if (detected !== null) {
          setRunning(detected.port, detected.url);
          break;
        }
      }
    }
  }

  function waitForExit(c: PreviewChild, ms: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (v: boolean): void => {
        if (done) return;
        done = true;
        resolve(v);
      };
      c.once("exit", () => finish(true));
      const t = setTimeout(() => finish(false), ms);
      t.unref?.();
    });
  }

  async function terminateChild(c: PreviewChild): Promise<void> {
    try {
      if (!c.killed) c.kill();
    } catch {
      /* ignore */
    }
    const exited = await waitForExit(c, gracefulStopMs);
    if (!exited) {
      try {
        c.killTree();
      } catch {
        /* ignore */
      }
    }
  }

  function onChildExit(code: number | null): void {
    if (child === null) return;
    child = null;
    if (stopping) {
      status = "stopped";
      url = null;
      clearPoll();
      return;
    }
    // Unexpected exit while starting or running → crash / command-not-found / early failure.
    if (status === "starting") {
      fail(`Tiến trình dừng khi khởi động (mã ${code ?? "?"}). Kiểm tra lệnh và package manager.`);
    } else if (status === "running") {
      fail(`Tiến trình đã dừng bất ngờ (mã ${code ?? "?"}).`);
    }
  }

  async function startPollLoop(): Promise<void> {
    startupDeadline = Date.now() + startupTimeoutMs;
    poll = setPoll(() => {
      void (async () => {
        if (status !== "starting") {
          clearPoll();
          return;
        }
        if (Date.now() > startupDeadline) {
          const c = child;
          fail("Hết thời gian khởi động dev server (không phát hiện được localhost).");
          if (c !== null) {
            child = null;
            await terminateChild(c);
          }
          return;
        }
        if (url === null && envPort > 0 && (await probePort(envPort))) {
          setRunning(envPort, `http://127.0.0.1:${envPort}`);
        }
      })();
    }, STARTUP_POLL_MS);
  }

  async function doStartDev(launch: PreviewLaunchCommand): Promise<void> {
    const root = deps.getActiveRoot();
    if (root === undefined || root.trim().length === 0) {
      throw new InvalidLaunchError("Chưa chọn workspace.");
    }
    const cwd = await confineCwd(root);
    envPort = await allocatePort();
    const env = buildPreviewEnv(parentEnv, envPort);

    output.clear();
    stopping = false;
    status = "starting";
    kind = "dev-server";
    command = launch.display;
    url = null;
    port = null;
    error = null;
    startedAt = now();

    emitSystem(`Đang khởi động: ${launch.display} (PORT=${envPort})`);
    telemetry("preview_started");
    log(`preview_start_dev display=${launch.display} port=${envPort}`);

    const c = spawner.spawn(launch.command, launch.args, { cwd, env });
    child = c;
    c.onData((stream, chunk) => onOutput(stream, chunk));
    c.once("exit", ((code: number | null) => onChildExit(code)) as never);
    c.once("error", ((err: Error) => {
      if (child === c) child = null;
      fail(`Không khởi chạy được lệnh: ${err.message}`);
    }) as never);

    await startPollLoop();
  }

  return {
    async detect() {
      const root = deps.getActiveRoot();
      if (root === undefined || root.trim().length === 0) {
        return {
          kind: "unsupported",
          hasStaticIndex: false,
          hasPackageJson: false,
          packageJsonMalformed: false,
          devScripts: [],
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
      const lines = output.since(afterSeq);
      return { state: snapshot(), lines, truncated: output.hasDropped() };
    },

    async startStaticPreview() {
      if (status === "starting" || status === "running") {
        throw new InvalidLaunchError("Đã có preview đang chạy. Hãy dừng trước.");
      }
      const root = deps.getActiveRoot();
      if (root === undefined || root.trim().length === 0) {
        throw new InvalidLaunchError("Chưa chọn workspace.");
      }
      const info = await detect(root);
      if (!info.hasStaticIndex) {
        fail("Không có index.html để xem tĩnh.");
        return snapshot();
      }
      const safeRoot = await confineCwd(root);
      output.clear();
      stopping = false;
      status = "starting";
      kind = "static";
      command = null;
      url = null;
      port = null;
      error = null;
      startedAt = now();
      emitSystem("Đang khởi động máy chủ tĩnh…");
      telemetry("preview_started");
      try {
        const chosen = await allocatePort();
        staticHandle = await startStatic(safeRoot, chosen);
        setRunning(staticHandle.port, staticHandle.url);
      } catch (err) {
        fail(`Không khởi động được máy chủ tĩnh: ${(err as Error).message}`);
      }
      return snapshot();
    },

    async requestLaunch(input) {
      if (status === "starting" || status === "running") {
        throw new InvalidLaunchError("Đã có preview đang chạy. Hãy dừng trước.");
      }
      if (input.kind !== "dev-server") {
        throw new InvalidLaunchError("requestLaunch chỉ dùng cho dev-server.");
      }
      const root = deps.getActiveRoot();
      if (root === undefined || root.trim().length === 0) {
        throw new InvalidLaunchError("Chưa chọn workspace.");
      }
      const info = await detect(root);
      if (info.kind !== "dev-server" || info.devScripts.length === 0) {
        throw new InvalidLaunchError("Dự án không có dev server để chạy.");
      }
      const script = input.script ?? info.devScripts[0]!;
      if (!info.devScripts.includes(script)) {
        throw new InvalidLaunchError(`Script không hợp lệ: ${JSON.stringify(script)}`);
      }
      const pm = input.packageManager ?? info.packageManager ?? "npm";
      const launch = buildDevServerCommand(pm, script, deps.comspec);
      const cwd = await confineCwd(root);

      requestCounter += 1;
      const requestId = `preview-${now()}-${requestCounter}-${script}`;
      const request = createPermissionRequest({
        requestId,
        sessionId: PREVIEW_SESSION_ID,
        action: {
          kind: "command_exec",
          description: `Chạy "${launch.display}" trong workspace để xem trước web.`,
        },
        requestedAt: now(),
      });
      deps.gate.submit(request);
      pending = { requestId, launch, pm, script };
      return { requestId, command: launch.display, cwd };
    },

    async resolveLaunch(requestId, decision) {
      if (pending === null || pending.requestId !== requestId) {
        // Idempotent: unknown/stale request — just report current state.
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
        emitSystem("Đã từ chối chạy lệnh preview.");
        return snapshot();
      }
      approved = pending;
      pending = null;
      const toStart = approved;
      const result = deps.gate.proceed(requestId, () => doStartDev(toStart.launch));
      if (result.performed) await result.result;
      return snapshot();
    },

    async restart() {
      const previousKind = kind;
      const approvedLaunch = approved;
      await this.stop("restart");
      if (previousKind === "static") {
        return this.startStaticPreview();
      }
      if (previousKind === "dev-server" && approvedLaunch !== null) {
        const result = deps.gate.proceed(approvedLaunch.requestId, () => doStartDev(approvedLaunch.launch));
        if (!result.performed) {
          fail("Cần phê duyệt lại lệnh để chạy preview.");
          return snapshot();
        }
        await result.result;
        return snapshot();
      }
      return snapshot();
    },

    async stop(reason: PreviewStopReason = "user") {
      stopping = true;
      clearPoll();
      const c = child;
      const sh = staticHandle;
      child = null;
      staticHandle = null;
      if (c !== null) await terminateChild(c);
      if (sh !== null) await sh.close().catch(() => undefined);
      if (status === "starting" || status === "running") status = "stopped";
      url = null;
      port = null;
      if (reason !== "restart") emitSystem(`Đã dừng preview (${reason}).`);
      telemetry("preview_stopped");
      log(`preview_stop reason=${reason}`);
      return snapshot();
    },

    async dispose(reason) {
      await this.stop(reason);
      if (reason === "workspace_changed" || reason === "shutdown") {
        approved = null;
        pending = null;
        status = "idle";
        kind = null;
        command = null;
        error = null;
        startedAt = null;
        output.clear();
      }
    },
  };
}
