/**
 * Built-in health/ready router (cold-start readiness contract, design §11).
 *
 * `GET /v1/health` returns the versioned envelope with {@link HealthData}. It requires
 * the per-launch client token like every other route (fail-closed): the shell obtains
 * the token at launch and uses it to poll readiness.
 */

import { SERVICE_NAME, type BoundaryRouter, type HealthData } from "../boundary/contract.js";

export const HEALTH_PATH = "/v1/health";

export function createHealthRouter(startedAt: Date): BoundaryRouter {
  return {
    name: "health",
    routes: [
      {
        // Token-guarded by default (fail-closed): the shell obtains the per-launch
        // token at launch and uses it to poll readiness.
        method: "GET",
        path: HEALTH_PATH,
        handler: () => {
          const data: HealthData = {
            status: "ok",
            service: SERVICE_NAME,
            startedAt: startedAt.toISOString(),
            uptimeMs: Date.now() - startedAt.getTime(),
          };
          return { status: 200, data };
        },
      },
    ],
  };
}
