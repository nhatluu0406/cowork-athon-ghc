/**
 * Workflow draft/confirm HTTP router (agent-harness-plan.md Task 4.3). Token-guarded like every
 * sensitive route (default — no `publicUnauthenticated`). `POST draft` only ever GENERATES and
 * VALIDATES — it never persists and never runs anything. `POST confirm` is the one, explicit,
 * separate step that saves: it RE-VALIDATES the submitted draft through the same
 * {@link AgentCatalog} / {@link TaskStore} boundaries every other write goes through, so a client
 * that tampers with a draft between the two calls is caught here too. Neither route ever starts a
 * dispatch run — saving a task is not the same as running it (the dispatch router is separate).
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import { AgentCatalogError, parseAgentDraft, type AgentCatalog } from "../agents/index.js";
import { TaskStoreError, type TaskStore } from "./store.js";
import type { WorkflowBuilder } from "./workflow-builder.js";

export const TASK_DRAFT_PATH = "/v1/tasks/draft";
export const TASK_DRAFT_CONFIRM_PATH = "/v1/tasks/draft/confirm";

export class WorkflowRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowRequestError";
  }
}

export interface WorkflowRouterOptions {
  readonly builder: WorkflowBuilder;
  readonly tasks: TaskStore;
  readonly agents: AgentCatalog;
}

function parsePrompt(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    throw new WorkflowRequestError("Body must be a JSON object.");
  }
  const prompt = (body as Record<string, unknown>)["prompt"];
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new WorkflowRequestError("prompt is required.");
  }
  return prompt;
}

function parseConfirmBody(body: unknown): { readonly task: unknown; readonly newAgent?: unknown } {
  if (typeof body !== "object" || body === null) {
    throw new WorkflowRequestError("Body must be a JSON object.");
  }
  const rec = body as Record<string, unknown>;
  if (rec["task"] === undefined) throw new WorkflowRequestError("task is required.");
  return { task: rec["task"], ...(rec["newAgent"] !== undefined ? { newAgent: rec["newAgent"] } : {}) };
}

export function createWorkflowRouter(options: WorkflowRouterOptions): BoundaryRouter {
  const { builder, tasks, agents } = options;
  return {
    name: "tasks-workflow",
    routes: [
      {
        method: "POST",
        path: TASK_DRAFT_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const prompt = parsePrompt(ctx.body);
          const outcome = await builder.draftFromPrompt(prompt);
          // 422 for an honestly-refused draft (never a 500 for an untrusted-LLM-shaped rejection).
          return { status: outcome.ok ? 200 : 422, data: outcome };
        },
      },
      {
        method: "POST",
        path: TASK_DRAFT_CONFIRM_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const { task, newAgent } = parseConfirmBody(ctx.body);
          try {
            // Re-validate + persist the proposed agent FIRST so the task's reference resolves.
            if (newAgent !== undefined) {
              await agents.createUserAgent(parseAgentDraft(newAgent));
            }
            const saved = await tasks.createTask(task);
            return { status: 201, data: { task: saved } };
          } catch (err) {
            if (err instanceof AgentCatalogError || err instanceof TaskStoreError) {
              throw new WorkflowRequestError(err.message);
            }
            throw err;
          }
        },
      },
    ],
  };
}
