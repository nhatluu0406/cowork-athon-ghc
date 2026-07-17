/**
 * PlannerService: Planner CRUD over Microsoft Graph. Reads via /me/planner/plans (no group
 * enumeration → no Group.Read.All). Writes require the task's ETag (If-Match). Reuses
 * Ms365Connector.graph(); model text (title/due) only enters the JSON body, never the path.
 */
import { Ms365Error } from "./ms365-errors.js";
import type { Ms365Connector } from "./ms365-connector.js";

const DEFAULT_MAX_RESULTS = 50;

export interface PlannerPlan { id: string; title: string }
export interface PlannerTask {
  id: string; title: string; planId: string;
  percentComplete: number; dueDateTime: string; etag: string;
}
export interface PlannerService {
  listPlans(): Promise<PlannerPlan[]>;
  listTasks(planId: string): Promise<PlannerTask[]>;
  createTask(input: { planId: string; title: string; dueDateTime?: string; assigneeUserIds?: string[] }): Promise<PlannerTask>;
  editTask(input: { taskId: string; etag: string; title?: string; dueDateTime?: string; percentComplete?: number }): Promise<void>;
  deleteTask(input: { taskId: string; etag: string }): Promise<void>;
}

interface RawPlan { id?: unknown; title?: unknown }
interface RawTask {
  id?: unknown; title?: unknown; planId?: unknown;
  percentComplete?: unknown; dueDateTime?: unknown; "@odata.etag"?: unknown;
}
interface ListResponse<T> { value?: T[] }

function asArray<T>(v: T[] | undefined): T[] { return Array.isArray(v) ? v : []; }
function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function num(v: unknown): number { return typeof v === "number" && Number.isFinite(v) ? v : 0; }

function toTask(raw: RawTask): PlannerTask | null {
  if (typeof raw?.id !== "string" || typeof raw?.title !== "string") return null;
  return {
    id: raw.id, title: raw.title, planId: str(raw.planId),
    percentComplete: num(raw.percentComplete), dueDateTime: str(raw.dueDateTime),
    etag: str(raw["@odata.etag"]),
  };
}

export function createPlannerService(deps: { connector: Ms365Connector; maxResults?: number }): PlannerService {
  const cap = deps.maxResults ?? DEFAULT_MAX_RESULTS;
  const graph = () => deps.connector.graph();

  return {
    async listPlans() {
      const res = await graph().json<ListResponse<RawPlan>>({ method: "GET", path: "/me/planner/plans" });
      const out: PlannerPlan[] = [];
      for (const raw of asArray(res.value)) {
        if (typeof raw?.id !== "string" || typeof raw?.title !== "string") continue;
        out.push({ id: raw.id, title: raw.title });
        if (out.length >= cap) break;
      }
      return out;
    },
    async listTasks(planId: string) {
      const res = await graph().json<ListResponse<RawTask>>({
        method: "GET", path: `/planner/plans/${encodeURIComponent(planId)}/tasks`,
      });
      const out: PlannerTask[] = [];
      for (const raw of asArray(res.value)) {
        const t = toTask(raw);
        if (t !== null) out.push(t);
        if (out.length >= cap) break;
      }
      return out;
    },
    async createTask(input) {
      const body: Record<string, unknown> = { planId: input.planId, title: input.title };
      if (input.dueDateTime !== undefined) body.dueDateTime = input.dueDateTime;
      if (input.assigneeUserIds !== undefined && input.assigneeUserIds.length > 0) {
        const assignments: Record<string, unknown> = {};
        for (const uid of input.assigneeUserIds) {
          assignments[uid] = { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" };
        }
        body.assignments = assignments;
      }
      const raw = await graph().json<RawTask>({ method: "POST", path: "/planner/tasks", body });
      const t = toTask(raw);
      if (t === null) {
        throw new Ms365Error("graph_error", "Planner create response missing id/title.",
          "Thử lại; nếu tiếp diễn hãy kết nối lại Microsoft 365.", false);
      }
      return t;
    },
    async editTask(input) {
      const body: Record<string, unknown> = {};
      if (input.title !== undefined) body.title = input.title;
      if (input.dueDateTime !== undefined) body.dueDateTime = input.dueDateTime;
      if (input.percentComplete !== undefined) body.percentComplete = input.percentComplete;
      await graph().noContent({
        method: "PATCH", path: `/planner/tasks/${encodeURIComponent(input.taskId)}`,
        ifMatch: input.etag, body,
      });
    },
    async deleteTask(input) {
      await graph().noContent({
        method: "DELETE", path: `/planner/tasks/${encodeURIComponent(input.taskId)}`,
        ifMatch: input.etag,
      });
    },
  };
}
