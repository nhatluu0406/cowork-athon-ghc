/**
 * Captured-stdio spawn seam for the preview runner + Windows tree termination.
 *
 * Distinct from {@link import("../runtime/child-spawner.js")} (which uses `stdio: "ignore"` because
 * the OpenCode child's only secret is in env): a dev server's stdout/stderr is the Output log the
 * user needs, so this seam PIPES both streams as UTF-8 chunks. Termination is a whole-TREE kill
 * (`taskkill /PID <pid> /T /F`) because `npm run dev` spawns node which spawns more — a bare
 * `child.kill()` would orphan the descendants. The port is injectable so tests drive the full
 * lifecycle with a fake child (no real process, no real taskkill).
 *
 * SECURITY: spawned with an ARGUMENT ARRAY (never a shell string), `windowsHide: true`, and the
 * CURATED env the caller supplies (never the full parent env).
 */

import { spawn, execFile, type ChildProcess } from "node:child_process";

export type PreviewChildEvent = "exit" | "error";
export type PreviewChildListener = (...args: never[]) => void;
export type PreviewDataListener = (stream: "stdout" | "stderr", chunk: string) => void;

export interface PreviewChild {
  readonly pid?: number | undefined;
  readonly killed: boolean;
  /** Subscribe to decoded stdout/stderr chunks. */
  onData(listener: PreviewDataListener): void;
  once(event: PreviewChildEvent, listener: PreviewChildListener): void;
  on(event: PreviewChildEvent, listener: PreviewChildListener): void;
  removeListener(event: PreviewChildEvent, listener: PreviewChildListener): void;
  /** Kill the direct child only (graceful attempt). */
  kill(signal?: NodeJS.Signals | number): boolean;
  /** Force-kill the whole descendant tree (Windows `taskkill /T /F`). */
  killTree(): void;
}

export interface PreviewSpawnOptions {
  readonly cwd: string;
  /** CURATED child env (allowlist only — never the full parent env). */
  readonly env: Record<string, string>;
}

export interface PreviewSpawner {
  spawn(command: string, args: readonly string[], options: PreviewSpawnOptions): PreviewChild;
}

type NodeListener = (...args: unknown[]) => void;

function adaptChildProcess(cp: ChildProcess): PreviewChild {
  cp.stdout?.setEncoding("utf8");
  cp.stderr?.setEncoding("utf8");
  return {
    get pid(): number | undefined {
      return cp.pid;
    },
    get killed(): boolean {
      return cp.killed;
    },
    onData(listener) {
      cp.stdout?.on("data", (chunk: string) => listener("stdout", chunk));
      cp.stderr?.on("data", (chunk: string) => listener("stderr", chunk));
    },
    once: (event, listener) => void cp.once(event, listener as NodeListener),
    on: (event, listener) => void cp.on(event, listener as NodeListener),
    removeListener: (event, listener) => void cp.removeListener(event, listener as NodeListener),
    kill: (signal) => cp.kill(signal),
    killTree() {
      const pid = cp.pid;
      if (pid === undefined || pid <= 0) {
        cp.kill("SIGKILL");
        return;
      }
      // Whole-tree, identity by PID only (never /IM image). Fire-and-forget; a graceful
      // cp.kill() is attempted by the caller first.
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {
        // Best-effort: if taskkill is unavailable or the tree is already gone, fall back to
        // the direct-child SIGKILL so we never leave the immediate child alive.
        if (!cp.killed) cp.kill("SIGKILL");
      });
    },
  };
}

/**
 * Wait up to `ms` for a child's `exit` event; resolves `true` if it exited, `false` on timeout.
 * The listener is registered by the caller BEFORE any kill so a synchronous exit is never missed.
 */
export function waitForChildExit(c: PreviewChild, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (v: boolean): void => {
      if (done) return;
      done = true;
      resolve(v);
    };
    c.once("exit", () => finish(true));
    const t = setTimeout(() => finish(false), ms);
    (t as { unref?: () => void }).unref?.();
  });
}

/**
 * Terminate a spawned child's WHOLE process tree with no orphan (shared by the preview + app
 * runners). The direct child is a `cmd.exe` wrapper on Windows; a graceful `kill()` of it reaps
 * ONLY cmd.exe and orphans the `pm → node → …` descendants — and once cmd.exe is gone the
 * parent links break so a later tree-kill can no longer find them. So kill the still-LIVE tree
 * up front (`taskkill /PID <pid> /T /F`, identity by PID only). A last-resort direct kill covers
 * the case where the tree somehow outlives the grace window.
 */
export async function terminateChildTree(c: PreviewChild, gracefulStopMs: number): Promise<void> {
  const exited = waitForChildExit(c, gracefulStopMs);
  try {
    c.killTree();
  } catch {
    /* ignore */
  }
  if (!(await exited)) {
    try {
      c.kill();
    } catch {
      /* ignore */
    }
  }
}

/** Production spawner: pipes stdout/stderr, hidden window, argument array. */
export function nodePreviewSpawner(): PreviewSpawner {
  return {
    spawn(command, args, options): PreviewChild {
      const cp = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
      return adaptChildProcess(cp);
    },
  };
}
