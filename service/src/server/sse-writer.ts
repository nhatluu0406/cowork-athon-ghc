/**
 * `ServerResponse`-backed {@link SseWriter} for streaming boundary routes (CGHC-015).
 *
 * This is the ONLY place the dispatcher hands a long-lived response to a handler. It keeps
 * the socket-owning concerns (SSE headers, one-shot pre-stream error, client-disconnect
 * teardown) in one small, testable seam so the streaming routes above it stay pure policy.
 *
 * Disconnect handling is load-bearing: the renderer may vanish (window closed, network cut)
 * at any moment. We listen on BOTH `req`/`res` `close` events and fire the registered
 * teardown callbacks exactly once, so a route always tears down its session subscription and
 * clears its heartbeat timer — no leaked timers, no orphaned fan-out listeners.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { BoundaryErrorCode, SseWriter } from "../boundary/contract.js";
import { errorEnvelope, writeEnvelope } from "./http-util.js";

/**
 * SSE response headers. `no-store, no-transform` + `x-accel-buffering:no` defeat any
 * intermediary buffering; `connection: keep-alive` keeps the long-lived socket open. No
 * permissive CORS header is ever emitted (loopback-only boundary).
 */
const SSE_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

/** Wrap a `ServerResponse` as an {@link SseWriter} bound to its request's disconnect. */
export function createSseWriter(req: IncomingMessage, res: ServerResponse): SseWriter {
  let opened = false;
  let closed = false;
  const listeners: Array<() => void> = [];

  const teardown = (): void => {
    if (closed) return;
    closed = true;
    for (const listener of listeners) {
      // Teardown is best-effort: one failing listener must not abort the others or the
      // socket-close handler. We do not have a logger at this layer; a throw here would
      // only be an unhandled socket error, so we contain it and continue teardown.
      try {
        listener();
      } catch {
        /* contained: continue tearing down the remaining subscriptions/timers */
      }
    }
  };

  // A dropped client (window closed / network cut) surfaces as a socket close on either end.
  req.on("close", teardown);
  res.on("close", teardown);

  return {
    open(): void {
      if (opened || closed) return;
      opened = true;
      res.writeHead(200, { ...SSE_HEADERS });
      res.flushHeaders?.();
    },
    write(frame: string): void {
      if (closed || !opened) return;
      res.write(frame);
    },
    fail(status: number, code: BoundaryErrorCode, message: string): void {
      // A pre-stream error still uses the standard versioned envelope; once the stream is
      // open the response is committed and this is a no-op.
      if (opened || closed) return;
      closed = true;
      writeEnvelope(res, status, errorEnvelope(code, message));
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          /* contained */
        }
      }
    },
    onClose(listener: () => void): void {
      listeners.push(listener);
    },
    end(): void {
      if (closed) return;
      // Fire teardown FIRST (clear timers/subscriptions), then close the socket so the
      // `res.close` re-entry is a no-op.
      teardown();
      res.end();
    },
    get closed(): boolean {
      return closed;
    },
  };
}
