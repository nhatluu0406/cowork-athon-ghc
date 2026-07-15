/**
 * Dispatch HTTP router (agent-harness-plan.md Task 5.2 wiring / 5.3 backend). Token-guarded like
 * every sensitive route. Start runs a STORED task (built-in template or user task) — the router
 * never accepts an inline TaskDefinition, so everything that runs went through the store's
 * boundary validation. Views are secret-free projections from the run registry.
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { TaskStore } from "../tasks/index.js";
import { FanOutPlanError } from "./fanout.js";
import type { DispatchRunRegistry } from "./run-registry.js";

export const DISPATCH_RUNS_PATH = "/v1/dispatch/runs";
export const DISPATCH_RUN_ITEM_PATH = "/v1/dispatch/runs/{id}";
export const DISPATCH_RUN_CANCEL_PATH = "/v1/dispatch/runs/{id}/cancel";
export const DISPATCH_TASK_RUN_PATH = "/v1/dispatch/tasks/{id}/run";

export interface DispatchRouterOptions {
  readonly runs: DispatchRunRegistry;
  readonly tasks: TaskStore;
}

function requireId(params: Readonly<Record<string, string>>): string {
  const id = params["id"];
  if (id === undefined || id.length === 0) throw new BadRequestError("id is required.");
  return id;
}

export function createDispatchRouter(options: DispatchRouterOptions): BoundaryRouter {
  const { runs, tasks } = options;
  return {
    name: "dispatch",
    routes: [
      {
        method: "POST",
        path: DISPATCH_TASK_RUN_PATH,
        handler: (ctx: RouteContext): RouteResult => {
          const task = tasks.get(requireId(ctx.params));
          if (task === undefined) return { status: 404, data: { error: "not_found" } };
          try {
            return { status: 201, data: { run: runs.start(task) } };
          } catch (err) {
            if (err instanceof FanOutPlanError) throw new BadRequestError(err.message);
            throw err;
          }
        },
      },
      {
        method: "GET",
        path: DISPATCH_RUNS_PATH,
        handler: (): RouteResult => ({ status: 200, data: { runs: runs.list() } }),
      },
      {
        method: "GET",
        path: DISPATCH_RUN_ITEM_PATH,
        handler: (ctx: RouteContext): RouteResult => {
          const run = runs.get(requireId(ctx.params));
          if (run === undefined) return { status: 404, data: { error: "not_found" } };
          return { status: 200, data: { run } };
        },
      },
      {
        method: "POST",
        path: DISPATCH_RUN_CANCEL_PATH,
        handler: (ctx: RouteContext): RouteResult => {
          const cancelled = runs.cancel(requireId(ctx.params));
          if (!cancelled) return { status: 404, data: { error: "not_found" } };
          return { status: 200, data: { cancelled: true } };
        },
      },
    ],
  };
}
