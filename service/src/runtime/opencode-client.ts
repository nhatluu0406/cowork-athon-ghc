/**
 * The ONE thin HTTP transport the LIVE OpenCode data adapters share (CGHC-028 Wave A2).
 *
 * SessionStore / RuntimeReply / ProviderConnector all POST/GET the supervised child over
 * loopback through this helper so bounded-timeout, typed-error, and header handling live in a
 * single place (no duplicated `fetch` logic per adapter). It is provider-neutral and secret-free:
 * it never logs a URL/body/header and it sends only a non-secret model ref / decision the caller
 * built. The child `baseUrl` is read LAZILY from the supervisor on every call, so an adapter
 * constructed before `supervisor.start()` simply fails closed with a typed
 * {@link RuntimeNotReadyError} until the child is up (and again after `stop()`).
 */

import {
  OpencodeHttpError,
  OpencodeUnreachableError,
  RuntimeNotReadyError,
} from "./opencode-http-error.js";

const DEFAULT_TIMEOUT_MS = 15_000;

/** One wire call against the child. `body`, when present, is JSON-encoded. */
export interface OpencodeCall {
  /** Secret-free operation label used only in typed errors (e.g. `session.create`). */
  readonly operation: string;
  readonly method: string;
  /** Absolute path resolved against the child `baseUrl` (e.g. `/session`). */
  readonly path: string;
  readonly body?: unknown;
  /** Caller cancellation (e.g. a session cancel); merged with the bounded timeout. */
  readonly signal?: AbortSignal;
}

export interface OpencodeHttp {
  /** Parse a 2xx JSON body; non-2xx → {@link OpencodeHttpError}; unreachable → typed error. */
  json<T>(call: OpencodeCall): Promise<T>;
  /** Like {@link json} but a 404 resolves to `null` (a soft "no such resource"). */
  jsonOrNull<T>(call: OpencodeCall): Promise<T | null>;
  /** Require a 2xx with no body of interest; non-2xx → typed rejection. */
  send(call: OpencodeCall): Promise<void>;
  /** Reachability: `true` on a 2xx, `false` on any non-2xx / network error. NEVER throws. */
  reachable(call: OpencodeCall): Promise<boolean>;
}

export interface OpencodeClientOptions {
  /** Lazily resolve the child base URL (the supervisor's getter); `null` before ready. */
  readonly baseUrl: () => string | null;
  /** Injectable fetch (default: global `fetch`). Tests hit a real loopback fake server. */
  readonly fetch?: typeof fetch;
  /** Optional bearer token if the child is configured with loopback auth (default: none). */
  readonly authToken?: string;
  /** Per-request bound (default 15s) so no adapter await can hang. */
  readonly timeoutMs?: number;
}

export function createOpencodeHttp(options: OpencodeClientOptions): OpencodeHttp {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function headers(hasBody: boolean): Record<string, string> {
    const out: Record<string, string> = { accept: "application/json" };
    if (hasBody) out["content-type"] = "application/json";
    if (options.authToken !== undefined) out["authorization"] = `Bearer ${options.authToken}`;
    return out;
  }

  async function execute(call: OpencodeCall): Promise<Response> {
    const base = options.baseUrl();
    if (base === null) throw new RuntimeNotReadyError(call.operation);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const relay = (): void => controller.abort();
    if (call.signal) call.signal.addEventListener("abort", relay, { once: true });
    const hasBody = call.body !== undefined;
    try {
      return await doFetch(new URL(call.path, base), {
        method: call.method,
        headers: headers(hasBody),
        signal: controller.signal,
        ...(hasBody ? { body: JSON.stringify(call.body) } : {}),
      });
    } catch (err) {
      // A refused/aborted/timed-out socket: no HTTP status ever arrived.
      throw new OpencodeUnreachableError(call.operation, { cause: err });
    } finally {
      clearTimeout(timer);
      if (call.signal) call.signal.removeEventListener("abort", relay);
    }
  }

  return {
    async json<T>(call: OpencodeCall): Promise<T> {
      const res = await execute(call);
      if (!res.ok) throw new OpencodeHttpError(call.operation, res.status);
      return (await res.json()) as T;
    },
    async jsonOrNull<T>(call: OpencodeCall): Promise<T | null> {
      const res = await execute(call);
      if (res.status === 404) return null;
      if (!res.ok) throw new OpencodeHttpError(call.operation, res.status);
      return (await res.json()) as T;
    },
    async send(call: OpencodeCall): Promise<void> {
      const res = await execute(call);
      if (!res.ok) throw new OpencodeHttpError(call.operation, res.status);
    },
    async reachable(call: OpencodeCall): Promise<boolean> {
      try {
        return (await execute(call)).ok;
      } catch {
        return false;
      }
    },
  };
}
