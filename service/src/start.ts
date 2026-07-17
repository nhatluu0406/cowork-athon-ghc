/**
 * Convenience start seam used by the Windows lifecycle scripts / shell supervisor
 * (start/stop/health are owned by the runtime-llm-engineer via ADR 0004). Constructs
 * the service, optionally mounts routers, starts it on a loopback ephemeral port, and
 * returns the running service plus a ready-to-use typed client bound to its address.
 *
 * The returned `clientToken` is a per-launch secret: hand it to the shell/renderer over
 * the launch handshake (e.g. spawn stdout), never write it to disk.
 */

import { createBoundaryClient } from "./boundary/client.js";
import type { BoundaryClient, BoundaryRouter } from "./boundary/contract.js";
import {
  createService,
  type LocalService,
  type ServiceAddress,
  type ServiceOptions,
} from "./server/http-service.js";

export interface StartServiceOptions extends ServiceOptions {
  /** Routers to mount before the socket opens (workspace/session/… in later tasks). */
  readonly routers?: readonly BoundaryRouter[];
}

export interface RunningService {
  readonly service: LocalService;
  readonly address: ServiceAddress;
  readonly baseUrl: string;
  readonly clientToken: string;
  /** A typed client bound to this service's address + token (for the shell/tests). */
  readonly client: BoundaryClient;
}

export async function startService(options: StartServiceOptions = {}): Promise<RunningService> {
  const service = createService(options);
  for (const router of options.routers ?? []) service.mount(router);
  const address = await service.start();
  const baseUrl = baseUrlFor(address.host, address.port);
  const client = createBoundaryClient({ baseUrl, clientToken: service.clientToken });
  return { service, address, baseUrl, clientToken: service.clientToken, client };
}

function baseUrlFor(host: string, port: number): string {
  // Bracket IPv6 loopback for a valid URL authority.
  const authority = host.includes(":") ? `[${host}]` : host;
  return `http://${authority}:${port}`;
}
