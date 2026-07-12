/**
 * Typed boundary client (ADR 0003). Renderer/shell/tests are equal HTTP clients of the
 * loopback service and reach it only through a typed client — never a generic
 * passthrough. Presents the per-launch token on every request. Later tasks extend the
 * {@link BoundaryClient} interface and this factory with their own typed methods.
 */

import {
  type BoundaryClient,
  type HealthData,
  type ResponseEnvelope,
} from "./contract.js";
import { HEALTH_PATH } from "../server/health-router.js";

export interface BoundaryClientOptions {
  /** Base URL of the loopback service, e.g. `http://127.0.0.1:53421`. */
  readonly baseUrl: string;
  /** Per-launch client token issued by the service at launch. */
  readonly clientToken: string;
  /** Injectable fetch (defaults to the global). Enables offline unit testing. */
  readonly fetchImpl?: typeof fetch;
}

export class BoundaryClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BoundaryClientError";
    this.code = code;
  }
}

export function createBoundaryClient(options: BoundaryClientOptions): BoundaryClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  async function call<T>(path: string): Promise<T> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${options.clientToken}` },
    });
    const envelope = (await res.json()) as ResponseEnvelope<T>;
    if (!envelope.ok) throw new BoundaryClientError(envelope.error.code, envelope.error.message);
    return envelope.data;
  }

  return {
    baseUrl,
    health: () => call<HealthData>(HEALTH_PATH),
    close: () => {},
  };
}
