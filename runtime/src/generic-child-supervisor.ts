/**
 * Generic child process supervisor for managing long-lived subprocesses
 * (e.g., Postgres, Neo4j, backend services).
 *
 * Handles: start, stop, restart, readiness probes, graceful shutdown,
 * error recovery. D3 Knowledge module uses this to supervise the M365KG
 * backend stack components.
 *
 * NOTE: D3 Knowledge integration is PARTIAL (not merge-ready). This module
 * is a stub implementation for compilation; full functionality pending.
 */

export interface GenericChildSupervisorOptions {
  /** Human-readable name for this child process (e.g., "Postgres 14") */
  readonly name: string;
  /** Command to execute (e.g., "postgres.exe", "/path/to/backend") */
  readonly command: string;
  /** Arguments passed to the command */
  readonly args?: readonly string[];
  /** Environment variables for the subprocess */
  readonly env?: Record<string, string>;
  /** Working directory for the process */
  readonly cwd?: string;
  /** Max time (ms) to wait for graceful shutdown before force-kill */
  readonly shutdownTimeoutMs?: number;
}

export interface GenericStartSpec {
  /** Unique identifier for this supervisor instance */
  readonly id: string;
  /** Options for starting the child process */
  readonly options: GenericChildSupervisorOptions;
}

/**
 * Supervises a single long-lived child process.
 *
 * NOT FULLY IMPLEMENTED — stub for compilation. Production use pending D3 merge.
 */
export class GenericChildSupervisor {
  private readonly options: GenericChildSupervisorOptions;
  private childPid: number | null = null;
  private isRunning = false;

  constructor(options: GenericChildSupervisorOptions) {
    this.options = options;
  }

  /** Returns true if the child process is currently running. */
  isChildRunning(): boolean {
    return this.isRunning;
  }

  /** Starts the child process. */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error(`${this.options.name} is already running`);
    }
    // Stub: actual implementation pending D3 merge
    this.isRunning = true;
    // In production: spawn child process, track PID, await readiness
  }

  /** Gracefully stops the child process. */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    // Stub: actual implementation pending D3 merge
    this.isRunning = false;
    this.childPid = null;
    // In production: send SIGTERM, wait for shutdown, force-kill if timeout
  }

  /** Restarts the child process (stop + start). */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Returns the child process ID (if running). */
  getPid(): number | null {
    return this.childPid;
  }
}
