/**
 * Post-bind readiness probe for the in-process loopback service (CGHC-028 packaged lifecycle).
 *
 * Opening the socket is not enough: callers must prove `GET /v1/health` is reachable with the
 * per-launch token before handing the base URL to the renderer or logging a started marker.
 */

import type { StartService, StartedService } from "./service-controller.js";

/** Raised when the loopback service never becomes health-ready within the bounded window. */
export class ServiceReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceReadinessError";
  }
}

export interface WaitForHealthOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly probeTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_INTERVAL_MS = 100;
const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

async function probeHealth(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  probeTimeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), probeTimeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (response.status !== 200) return false;
    const envelope = (await response.json()) as { ok?: boolean };
    return envelope.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Poll `GET /v1/health` until it returns a successful envelope or the deadline passes. */
export async function waitForServiceHealth(options: WaitForHealthOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const url = `${options.baseUrl.replace(/\/$/, "")}/v1/health`;
  const deadline = Date.now() + timeoutMs;
  let lastError = "service not reachable";

  while (Date.now() < deadline) {
    try {
      const ready = await probeHealth(fetchImpl, url, options.token, probeTimeoutMs);
      if (ready) return;
      lastError = "health endpoint did not return ok";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new ServiceReadinessError(`Service readiness timed out after ${timeoutMs}ms: ${lastError}`);
}

/** Wrap a {@link StartService} so it returns only after a real authenticated health probe succeeds. */
export function createHealthVerifiedStartService(
  start: StartService,
  options?: Omit<WaitForHealthOptions, "baseUrl" | "token">,
): StartService {
  return async (): Promise<StartedService> => {
    const started = await start();
    await waitForServiceHealth({
      baseUrl: started.baseUrl,
      token: started.token,
      ...options,
    });
    return started;
  };
}
