/**
 * Task store (agent-harness-plan.md Task 4.1) — built-in read-only templates + user TaskDefinitions.
 *
 * User tasks persist as one JSON document through an injectable {@link TaskStoreFs} seam (no disk
 * in tests). Every write validates via the shared contract validator, gating agent/branch
 * references against the CURRENT agent catalog so a task can never reference a removed agent.
 * "1-touch reuse" instantiates a new user task from a template or an existing task with a fresh id.
 */

import {
  validateTaskDefinition,
  type TaskDefinition,
} from "@cowork-ghc/contracts";
import { BUILTIN_TASK_TEMPLATES } from "./builtins.js";

export interface TaskStoreFs {
  read(): Promise<string | undefined>;
  write(data: string): Promise<void>;
}

export interface TaskStoreOptions {
  readonly fs: TaskStoreFs;
  /** Current known agent ids, evaluated per write so references stay valid as agents change. */
  readonly knownAgentIds: () => ReadonlySet<string>;
}

/** A user-supplied task draft (id optional on create). Source is always coerced to user_local. */
export type TaskDraft = Omit<TaskDefinition, "id" | "source"> & { readonly id?: string };

export interface TaskStore {
  list(): readonly TaskDefinition[];
  get(id: string): TaskDefinition | undefined;
  createTask(draft: unknown): Promise<TaskDefinition>;
  updateTask(id: string, draft: unknown): Promise<TaskDefinition>;
  deleteTask(id: string): Promise<void>;
  /** 1-touch reuse: clone a template or existing task into a NEW user task (fresh id). */
  instantiate(fromId: string, overrides?: { name?: string; goal?: string }): Promise<TaskDefinition>;
}

export class TaskStoreError extends Error {
  readonly code = "task_invalid";
  constructor(message: string) {
    super(message);
    this.name = "TaskStoreError";
  }
}

interface StoredDoc {
  readonly version: 1;
  readonly tasks: readonly TaskDefinition[];
}

const BUILTIN_IDS = new Set(BUILTIN_TASK_TEMPLATES.map((t) => t.id));

function freshId(): string {
  return `task-${Math.random().toString(36).slice(2, 10)}`;
}

export async function createTaskStore(options: TaskStoreOptions): Promise<TaskStore> {
  const { fs, knownAgentIds } = options;
  const userTasks = new Map<string, TaskDefinition>();
  await load();

  async function load(): Promise<void> {
    const raw = await fs.read();
    if (raw === undefined || raw.trim().length === 0) return;
    let doc: StoredDoc;
    try {
      doc = JSON.parse(raw) as StoredDoc;
    } catch {
      return; // corrupt store → treat as empty; user re-creates
    }
    if (!Array.isArray(doc.tasks)) return;
    for (const candidate of doc.tasks) {
      // On load, don't gate on agent ids (agents may load in any order); shape-validate only.
      const check = validateTaskDefinition({ ...candidate, source: "user_local" });
      if (check.ok && !BUILTIN_IDS.has(check.value.id)) userTasks.set(check.value.id, check.value);
    }
  }

  async function persist(): Promise<void> {
    const doc: StoredDoc = { version: 1, tasks: [...userTasks.values()] };
    await fs.write(`${JSON.stringify(doc, null, 2)}\n`);
  }

  function all(): readonly TaskDefinition[] {
    return [...BUILTIN_TASK_TEMPLATES, ...userTasks.values()];
  }

  function validate(draft: unknown, id: string): TaskDefinition {
    if (typeof draft !== "object" || draft === null) throw new TaskStoreError("task must be an object.");
    const check = validateTaskDefinition(
      { ...(draft as Record<string, unknown>), id, source: "user_local" },
      knownAgentIds(),
    );
    if (!check.ok) throw new TaskStoreError(check.error);
    return check.value;
  }

  return {
    list: all,
    get: (id) => all().find((t) => t.id === id),

    async createTask(draft) {
      const rawId = typeof draft === "object" && draft !== null ? (draft as Record<string, unknown>)["id"] : undefined;
      const id = typeof rawId === "string" && rawId.trim().length > 0 ? rawId.trim() : freshId();
      if (BUILTIN_IDS.has(id)) throw new TaskStoreError(`"${id}" is a built-in template id.`);
      if (userTasks.has(id)) throw new TaskStoreError(`task "${id}" already exists.`);
      const task = validate(draft, id);
      userTasks.set(id, task);
      await persist();
      return task;
    },

    async updateTask(id, draft) {
      if (BUILTIN_IDS.has(id)) throw new TaskStoreError("built-in templates are read-only.");
      if (!userTasks.has(id)) throw new TaskStoreError(`task "${id}" not found.`);
      const task = validate(draft, id);
      userTasks.set(id, task);
      await persist();
      return task;
    },

    async deleteTask(id) {
      if (BUILTIN_IDS.has(id)) throw new TaskStoreError("built-in templates are read-only.");
      if (!userTasks.delete(id)) throw new TaskStoreError(`task "${id}" not found.`);
      await persist();
    },

    async instantiate(fromId, overrides) {
      const source = all().find((t) => t.id === fromId);
      if (source === undefined) throw new TaskStoreError(`no task/template "${fromId}".`);
      const id = freshId();
      const draft: Record<string, unknown> = {
        ...source,
        id,
        source: "user_local",
        ...(overrides?.name !== undefined ? { name: overrides.name } : {}),
        ...(overrides?.goal !== undefined ? { goal: overrides.goal } : {}),
      };
      const task = validate(draft, id);
      userTasks.set(id, task);
      await persist();
      return task;
    },
  };
}
