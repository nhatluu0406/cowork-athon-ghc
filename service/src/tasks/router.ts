/**
 * Task store HTTP router (agent-harness-plan.md Task 4.1). Token-guarded. Read routes project the
 * catalog; write routes validate + persist a user task; `instantiate` is the 1-touch reuse entry.
 * The router owns no policy — it delegates to the {@link TaskStore} whose validator enforces
 * references and shape. A bad draft maps to HTTP 400, never a 500.
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import { TaskStoreError, type TaskStore } from "./store.js";

export const TASKS_PATH = "/v1/tasks";
export const TASK_ITEM_PATH = "/v1/tasks/{id}";
export const TASK_INSTANTIATE_PATH = "/v1/tasks/{id}/instantiate";

export class TaskRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "TaskRequestError";
  }
}

function requireId(params: Readonly<Record<string, string>>): string {
  const id = params["id"];
  if (id === undefined || id.length === 0) throw new TaskRequestError("id is required.");
  return id;
}

function guard<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (err instanceof TaskStoreError) throw new TaskRequestError(err.message);
    throw err;
  });
}

function parseOverrides(body: unknown): { name?: string; goal?: string } {
  if (typeof body !== "object" || body === null) return {};
  const rec = body as Record<string, unknown>;
  return {
    ...(typeof rec["name"] === "string" ? { name: rec["name"] } : {}),
    ...(typeof rec["goal"] === "string" ? { goal: rec["goal"] } : {}),
  };
}

export function createTaskRouter(store: TaskStore): BoundaryRouter {
  return {
    name: "tasks",
    routes: [
      {
        method: "GET",
        path: TASKS_PATH,
        handler: (): RouteResult => ({ status: 200, data: { tasks: store.list() } }),
      },
      {
        method: "POST",
        path: TASKS_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const task = await guard(() => store.createTask(ctx.body));
          return { status: 201, data: { task } };
        },
      },
      {
        method: "PUT",
        path: TASK_ITEM_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const task = await guard(() => store.updateTask(requireId(ctx.params), ctx.body));
          return { status: 200, data: { task } };
        },
      },
      {
        method: "DELETE",
        path: TASK_ITEM_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          await guard(() => store.deleteTask(requireId(ctx.params)));
          return { status: 200, data: { deleted: true } };
        },
      },
      {
        method: "POST",
        path: TASK_INSTANTIATE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const task = await guard(() =>
            store.instantiate(requireId(ctx.params), parseOverrides(ctx.body)),
          );
          return { status: 201, data: { task } };
        },
      },
    ],
  };
}
