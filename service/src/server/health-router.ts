/**
 * Built-in health/ready router (cold-start readiness contract, design §11).
 *
 * `GET /v1/health` returns the versioned envelope with {@link HealthData}. It requires
 * the per-launch client token like every other route (fail-closed): the shell obtains
 * the token at launch and uses it to poll readiness.
 */

import { SERVICE_NAME, type BoundaryRouter, type HealthData } from "../boundary/contract.js";

export const HEALTH_PATH = "/v1/health";

/**
 * @param runtimeReady optional live getter for supervised-runtime liveness (Tier 2). When provided,
 *   its current value is reported as {@link HealthData.runtimeReady} on every poll so the renderer
 *   can gate the first send / time a single safe retry. Omitted → the field is absent (Tier 1).
 */
export function createHealthRouter(startedAt: Date, runtimeReady?: () => boolean): BoundaryRouter {
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
            ...(runtimeReady !== undefined ? { runtimeReady: runtimeReady() } : {}),
          };
          return { status: 200, data };
        },
      },
    ],
  };
}
