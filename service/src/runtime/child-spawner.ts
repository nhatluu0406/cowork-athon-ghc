/**
 * The child-process spawn seam for the OpenCode supervisor (CGHC-028 Wave A1).
 *
 * The supervisor depends on this narrow port instead of `node:child_process.spawn` directly,
 * so the DEFAULT test suite injects a FAKE child (no real OpenCode binary, no real socket) and
 * still drives the full spawn → ready → stop lifecycle. Production wires {@link nodeChildSpawner}.
 *
 * SECURITY: the spawn env carries the PLAINTEXT provider key (child env only, never a file or a
 * log). Children are spawned with `windowsHide` and an ARGUMENT ARRAY (never a shell string) so a
 * workspace path with spaces/Unicode is safe (ADR 0004, W3/LC5).
 */

import { spawn, type ChildProcess } from "node:child_process";

/** A listener the supervisor attaches for lifecycle transitions. */
export type ChildEvent = "exit" | "error";

/** A lifecycle listener. `never[]` params keep concrete `(err)=>` / `()=>` listeners assignable. */
export type ChildListener = (...args: never[]) => void;

/**
 * The minimal `ChildProcess` surface the supervisor uses. The default spawner adapts a real
 * `node:child_process.ChildProcess` onto this port; a test fake implements exactly these members.
 */
export interface SupervisedChild {
  readonly pid?: number | undefined;
  readonly killed: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: ChildEvent, listener: ChildListener): void;
  on(event: ChildEvent, listener: ChildListener): void;
  removeListener(event: ChildEvent, listener: ChildListener): void;
}

/** Node's EventEmitter listeners are `any[]`-typed; this alias bridges without leaking `any`. */
type NodeListener = (...args: unknown[]) => void;

/** Adapt a real `ChildProcess` onto the narrow {@link SupervisedChild} port. */
function adaptChildProcess(cp: ChildProcess): SupervisedChild {
  return {
    get pid(): number | undefined {
      return cp.pid;
    },
    get killed(): boolean {
      return cp.killed;
    },
    kill: (signal) => cp.kill(signal),
    once: (event, listener) => void cp.once(event, listener as NodeListener),
    on: (event, listener) => void cp.on(event, listener as NodeListener),
    removeListener: (event, listener) => void cp.removeListener(event, listener as NodeListener),
  };
}

/** Spawn options the supervisor controls (env is the plaintext, injection-bearing map). */
export interface SpawnChildOptions {
  readonly cwd: string;
  /** PLAINTEXT child env (per-run isolation + injected provider key). Never logged. */
  readonly env: Record<string, string>;
}

/** The injected spawn port. */
export interface ChildSpawner {
  spawn(command: string, args: readonly string[], options: SpawnChildOptions): SupervisedChild;
}

/** Production spawner: the pinned OpenCode binary via `node:child_process.spawn`. */
export function nodeChildSpawner(): ChildSpawner {
  return {
    spawn(command, args, options): SupervisedChild {
      // stdio ignored so nothing the child prints is captured/relayed (defense in depth: the
      // key is never in argv/stdout anyway, only in env). windowsHide keeps no console window.
      const cp = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
      });
      return adaptChildProcess(cp);
    },
  };
}
