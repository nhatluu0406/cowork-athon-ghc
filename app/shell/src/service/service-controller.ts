/**
 * ServiceController — the ONE in-memory owner of the live loopback service handle inside
 * the Electron main process (CGHC-028 Wave B1).
 *
 * It starts the service through an injectable {@link StartService} seam (default:
 * `startLiveCoworkService` normalized — see `live-service-adapter.ts`), holds the running
 * `{ baseUrl, token, stop }` in memory ONLY, and hands the renderer an honest handshake:
 *   - running  → the REAL base URL + per-launch token (the renderer becomes a client);
 *   - anything else (idle / starting / failed / stopped) → {@link EMPTY_BOOTSTRAP}, the
 *     honest "not connected" signal the CGHC-025 readiness surface renders — NEVER a
 *     fabricated ready.
 *
 * Invariants:
 *   - single start: a second `start()` while running / in-flight does NOT double-start;
 *   - honest failure: a rejecting `StartService` is caught, recorded, and surfaced as the
 *     empty handshake (no unhandled crash, no fake ready);
 *   - one owner + idempotent stop: `stop()` calls the running handle's `stop()` at most
 *     once (which stops the loopback socket AND the supervised child);
 *   - token hygiene: the token lives only on the running handle + the handshake response;
 *     it is NEVER passed to the log sink.
 */

import { EMPTY_BOOTSTRAP, type ShellBootstrap } from "../bootstrap.js";

/** The minimal running-service handle the shell holds in memory. */
export interface StartedService {
  readonly baseUrl: string;
  /** Per-launch client token (secret). Never logged; only reaches the renderer via the bridge. */
  readonly token: string;
  /** Stop the loopback socket AND the supervised OpenCode child (one owner). */
  stop(): Promise<void>;
}

/** Bring the live service up. Injectable so tests use a fake (no real socket / OpenCode). */
export type StartService = () => Promise<StartedService>;

export type ServiceStatus = "idle" | "starting" | "running" | "failed" | "stopped";

export interface ServiceControllerOptions {
  /** Default boot path: the Tier-1 settings-only onboarding service. */
  readonly startService: StartService;
  /**
   * User-gated live connect (`connectLive`): tiered live attempt with onboarding fallback.
   * Defaults to {@link startService} when omitted.
   */
  readonly startLiveService?: StartService;
  /** Secret-free lifecycle log. The controller NEVER passes the token here. */
  readonly log?: (line: string) => void;
  /** Forwarded to the renderer bootstrap (dev / verification import seam). */
  readonly allowEnvCredentialImport?: boolean;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ServiceController {
  private readonly startFn: StartService;
  private readonly startLiveFn: StartService;
  private readonly log: (line: string) => void;
  private readonly allowEnvCredentialImport: boolean;
  private status: ServiceStatus = "idle";
  private started: StartedService | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private failureMessage: string | null = null;

  constructor(options: ServiceControllerOptions) {
    this.startFn = options.startService;
    this.startLiveFn = options.startLiveService ?? options.startService;
    this.log = options.log ?? ((): void => {});
    this.allowEnvCredentialImport = options.allowEnvCredentialImport === true;
  }

  /** Current lifecycle phase (for the shell's own honest diagnostics). */
  get state(): ServiceStatus {
    return this.status;
  }

  /** The last honest failure message (secret-free), or null. The error "signal". */
  get lastError(): string | null {
    return this.failureMessage;
  }

  /** Start the onboarding (settings-only) service ONCE. Concurrent calls never double-start. */
  async start(): Promise<void> {
    return this.invokeStart(this.startFn);
  }

  /** User-gated live connect: try the live path, fall back per the injected tiered seam. */
  async startLive(): Promise<void> {
    return this.invokeStart(this.startLiveFn);
  }

  private async invokeStart(fn: StartService): Promise<void> {
    if (this.startPromise !== null) return this.startPromise;
    if (this.status === "running") return;
    const run = this.runStart(fn);
    this.startPromise = run;
    try {
      await run;
    } finally {
      this.startPromise = null;
    }
  }

  private async runStart(fn: StartService): Promise<void> {
    this.status = "starting";
    this.failureMessage = null;
    this.log("service_starting");
    try {
      const started = await fn();
      this.started = started;
      this.status = "running";
      this.log(`service_started: ${started.baseUrl}`);
    } catch (err) {
      // HONEST failure: no started handle, no fake ready — the renderer gets the empty
      // handshake and the readiness surface renders `not_connected`. Never rethrow so the
      // main lifecycle never crashes on a failed service start.
      this.started = null;
      this.status = "failed";
      this.failureMessage = messageOf(err);
      this.log(`service_start_failed: ${this.failureMessage}`);
    }
  }

  /** The handshake for the renderer: real when running, else the honest empty handshake. */
  getBootstrap(): ShellBootstrap {
    const extra =
      this.allowEnvCredentialImport ? { allowEnvCredentialImport: true as const } : {};
    if (this.status === "running" && this.started !== null) {
      return {
        serviceBaseUrl: this.started.baseUrl,
        clientToken: this.started.token,
        ...extra,
      };
    }
    return { ...EMPTY_BOOTSTRAP, ...extra };
  }

  /** Stop the running service (socket + child) at most once. Idempotent; bounded. */
  async stop(): Promise<void> {
    if (this.stopPromise !== null) return this.stopPromise;
    const run = this.runStop();
    this.stopPromise = run;
    try {
      await run;
    } finally {
      this.stopPromise = null;
    }
  }

  private async runStop(): Promise<void> {
    // If a start is still in flight, let it settle so we own (and reap) any child it spawned.
    if (this.startPromise !== null) {
      await this.startPromise.catch(() => undefined);
    }
    const started = this.started;
    this.started = null;
    if (this.status !== "failed") this.status = "stopped";
    if (started === null) return; // nothing running → idempotent no-op
    try {
      await started.stop();
      this.log("service_stopped");
    } catch (err) {
      this.log(`service_stop_error: ${messageOf(err)}`);
    }
  }
}
