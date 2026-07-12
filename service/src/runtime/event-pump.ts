/**
 * LIVE `/event` pump (CGHC-028 live-run wiring) — the missing consumer half of the live chat path.
 *
 * It opens ONE bounded, resilient `GET /event` SSE consumer against the supervised OpenCode child,
 * decodes the multiplexed frame stream, demuxes each frame by its `sessionID`, and FEEDS the raw
 * frame into that session's live run on the {@link SessionStreamHub} via `open(sessionId).ingest`.
 * The hub owns the SINGLE per-session mapper/seq owner (`createSessionStream`): it maps the raw
 * frame → EV(s), folds through the authoritative `apply` seam (the one source of truth), coalesces,
 * and fans out to every SSE subscriber. So the pump adds NO mapper of its own and NEVER fabricates
 * a terminal — only a real `session.idle` (→ EV7 `completed`) / `session.error` frame ends a run.
 *
 * Lifecycle (ONE owner): `start()` after the child is ready; `stop()` aborts the consumer and closes
 * every open run (no leaked socket, no dangling run). A dropped `/event` connection reconnects with
 * a BOUNDED backoff; secrets are never logged (frame bodies are never logged; diagnostics are
 * redacted). It talks to the child ONLY through the injected `fetch` + lazy `baseUrl`, so it is fully
 * testable against a fake loopback `/event` server with no real OpenCode.
 */

import type { SessionId } from "@cowork-ghc/contracts";
import { decodeSseFrame, frameSessionId } from "../execution/index.js";

/** One live run the pump feeds raw frames into (satisfied by the hub's `open(sessionId)`). */
export interface PumpRunController {
  ingest(frame: unknown): void;
  close(): void;
}

/** The demux target: which sessions are live, and how to open/feed one live run. */
export interface EventPumpTarget {
  /** True when the session is loaded (non-fabricated) — frames for others are dropped. */
  knows(sessionId: SessionId): boolean;
  /** Open (or reuse) the live run for a session and return its feed controller. */
  open(sessionId: SessionId): PumpRunController;
}

export interface EventPumpOptions {
  /** Lazily resolve the child base URL (the supervisor getter); `null` before the child is up. */
  readonly baseUrl: () => string | null;
  readonly target: EventPumpTarget;
  /** Injectable fetch (default global). Tests hit a real loopback fake `/event` server. */
  readonly fetch?: typeof fetch;
  /** Redactor for any diagnostic string (never frame data). Defaults to identity. */
  readonly redactError?: (message: string) => string;
  /** Backoff between reconnect attempts (default 250ms). */
  readonly reconnectDelayMs?: number;
  /** Max CONSECUTIVE failed reconnects before the pump gives up (default 20). */
  readonly maxReconnects?: number;
  /** Optional redacted-diagnostic sink; omitted → silent (never logs secrets). */
  readonly onDiagnostic?: (message: string) => void;
  /**
   * Optional hook invoked for every decoded frame BEFORE session demux (e.g. permission bridge).
   * Must not throw — failures are reported via {@link onDiagnostic} when provided.
   */
  readonly onFrame?: (frame: { type: string }) => void | Promise<void>;
}

export interface EventPump {
  /** Begin consuming `/event` (idempotent). Returns immediately; the loop runs in the background. */
  start(): void;
  /** Abort the consumer, close every open run, and settle the loop (idempotent). */
  stop(): Promise<void>;
}

/** Frame types that end a run — after ingesting one, the pump closes that session's run. */
function isTerminalFrameType(type: string): boolean {
  return type === "session.idle" || type === "session.error";
}

export function createEventPump(options: EventPumpOptions): EventPump {
  const doFetch = options.fetch ?? fetch;
  const redact = options.redactError ?? ((m: string): string => m);
  const reconnectDelayMs = options.reconnectDelayMs ?? 250;
  const maxReconnects = options.maxReconnects ?? 20;

  const controllers = new Map<SessionId, PumpRunController>();
  let running = false;
  let loop: Promise<void> | null = null;
  let controller: AbortController | null = null;

  function diagnostic(message: string): void {
    options.onDiagnostic?.(redact(message));
  }

  /** Feed one decoded raw frame to its session's run; close the run on a terminal frame. */
  function dispatch(frame: { type: string }): void {
    const sessionId = frameSessionId(frame);
    if (sessionId === undefined || !options.target.knows(sessionId)) return;
    let ctrl = controllers.get(sessionId);
    if (ctrl === undefined) {
      ctrl = options.target.open(sessionId);
      controllers.set(sessionId, ctrl);
    }
    ctrl.ingest(frame);
    if (isTerminalFrameType(frame.type)) {
      // A real terminal ends the run: flush + drop it (no leak). The subscriber already saw the
      // mapped terminal synchronously during ingest, so closing here never drops the EV7.
      ctrl.close();
      controllers.delete(sessionId);
    }
  }

  /** Split complete SSE blocks out of the rolling buffer; return the trailing partial. */
  function drain(buffer: string): string {
    const normalized = buffer.replace(/\r\n/g, "\n");
    const blocks = normalized.split("\n\n");
    const remainder = blocks.pop() ?? "";
    for (const block of blocks) {
      const trimmed = block.trim();
      if (trimmed.length === 0) continue;
      const frame = decodeSseFrame(trimmed);
      if (frame !== null) {
        const hook = options.onFrame?.(frame);
        if (hook !== undefined) {
          void hook.catch((err: unknown) => {
            diagnostic(`onFrame hook error: ${errText(err)}`);
          });
        }
        dispatch(frame);
      }
    }
    return remainder;
  }

  /** One connection attempt: open `/event`, stream frames until it ends or is aborted. */
  async function consumeOnce(signal: AbortSignal): Promise<void> {
    const base = options.baseUrl();
    if (base === null) throw new Error("runtime base url not ready");
    const res = await doFetch(new URL("/event", base), {
      headers: { accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || res.body === null) throw new Error(`/event HTTP ${res.status}`);
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      buffer = drain(buffer);
    }
  }

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref?.();
    });

  async function run(): Promise<void> {
    let failures = 0;
    while (running) {
      controller = new AbortController();
      try {
        await consumeOnce(controller.signal);
        failures = 0; // a clean end (server closed /event) resets the backoff.
      } catch (err) {
        if (!running) break; // an abort from stop() is expected — not a failure.
        failures += 1;
        diagnostic(`/event consumer error (attempt ${failures}): ${errText(err)}`);
        if (failures >= maxReconnects) {
          diagnostic(`/event consumer giving up after ${failures} attempts`);
          break;
        }
      }
      if (!running) break;
      await sleep(reconnectDelayMs);
    }
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      loop = run();
    },
    async stop(): Promise<void> {
      running = false;
      controller?.abort();
      try {
        await loop;
      } catch {
        /* the loop swallows its own errors; nothing to surface here */
      }
      loop = null;
      for (const ctrl of controllers.values()) ctrl.close();
      controllers.clear();
    },
  };
}

/** Extract a safe (redacted upstream) error string without leaking a stack/secret. */
function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "unknown error";
}
