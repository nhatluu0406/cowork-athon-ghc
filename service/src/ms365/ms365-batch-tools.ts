/**
 * MS365 batch write tool: `planner_create_tasks` — ONE PermissionGate request that
 * transparently declares all N creates, then N sequential Graph calls under that single
 * recorded Allow. Per-item honest results: a failing item never breaks the batch; the model
 * relays exactly which items were created and which failed.
 *
 * Write-mode enforcement lives HERE at the execution boundary (not in the prompt): in
 * `manual` mode (default) the batch refuses with a structured `manual_mode` error BEFORE any
 * permission request, so the model falls back to per-item `planner_create_task` calls (one
 * permission card each). There is no path for a batch to bypass manual mode.
 *
 * Only `import type` from ms365-tools (no runtime cycle: ms365-tools imports this handler
 * as a value; this module imports only types back).
 */
import type { PermissionAction } from "@cowork-ghc/contracts";

import { Ms365Error } from "./ms365-errors.js";
import type { PlannerTask } from "./planner-service.js";
import type { ToolCall, ToolDeps, ToolResult } from "./ms365-tools.js";
import { awaitGateDecision, defaultWait } from "./ms365-gate-wait.js";
import { createPermissionRequest } from "../permission/index.js";

const MAX_BATCH_SIZE = 20;
const DESCRIPTION_TITLES_MAX_CHARS = 500;

interface BatchTaskInput {
  title: string;
  dueDateTime?: string;
  assigneeUserIds?: string[];
}

interface CreateTasksBatchArgs {
  planId: string;
  tasks: BatchTaskInput[];
}

export interface BatchCreateFailure {
  index: number;
  title: string;
  error: { kind: string; message: string };
}

export interface BatchCreateResult {
  created: PlannerTask[];
  failed: BatchCreateFailure[];
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => nonEmptyString(v));
}

function readBatchTask(value: unknown): BatchTaskInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!nonEmptyString(record.title)) return null;
  if (record.dueDateTime !== undefined && !nonEmptyString(record.dueDateTime)) return null;
  if (record.assigneeUserIds !== undefined && !isNonEmptyStringArray(record.assigneeUserIds)) return null;
  const out: BatchTaskInput = { title: record.title };
  if (nonEmptyString(record.dueDateTime)) out.dueDateTime = record.dueDateTime;
  if (isNonEmptyStringArray(record.assigneeUserIds)) out.assigneeUserIds = record.assigneeUserIds;
  return out;
}

/** Validates + narrows `planner_create_tasks` args; null when planId/tasks are missing or an
 * item is malformed. Size limits (empty, cap) are reported separately for clearer messages. */
function readCreateTasksBatchArgs(args: Record<string, unknown>): CreateTasksBatchArgs | null {
  if (!nonEmptyString(args.planId)) return null;
  if (!Array.isArray(args.tasks)) return null;
  const tasks: BatchTaskInput[] = [];
  for (const raw of args.tasks) {
    const task = readBatchTask(raw);
    if (task === null) return null;
    tasks.push(task);
  }
  return { planId: args.planId, tasks };
}

/** Permission description: ALWAYS states the total count; the title list is bounded to
 * ~500 chars so a huge batch cannot blow up the permission card. */
export function buildBatchDescription(planId: string, tasks: readonly BatchTaskInput[]): string {
  let titles = "";
  let included = 0;
  for (const task of tasks) {
    const next = titles.length === 0 ? `"${task.title}"` : `${titles}, "${task.title}"`;
    if (next.length > DESCRIPTION_TITLES_MAX_CHARS) break;
    titles = next;
    included += 1;
  }
  const rest = tasks.length - included;
  const suffix = rest > 0 ? `, … (+${rest} task khác)` : "";
  const assigned = tasks.some((t) => t.assigneeUserIds !== undefined && t.assigneeUserIds.length > 0)
    ? " (có gán người phụ trách)"
    : "";
  return `Tạo ${tasks.length} task trong Planner (plan ${planId})${assigned}: ${titles}${suffix}`;
}

function invalid(message: string): ToolResult {
  return {
    ok: false,
    error: {
      kind: "invalid_input",
      message,
      recovery: "Kiểm tra lại tham số của công cụ rồi thử lại.",
    },
  };
}

async function runBatch(deps: ToolDeps, input: CreateTasksBatchArgs): Promise<BatchCreateResult> {
  const created: PlannerTask[] = [];
  const failed: BatchCreateFailure[] = [];
  for (const [index, task] of input.tasks.entries()) {
    try {
      const createInput: Parameters<ToolDeps["planner"]["createTask"]>[0] = {
        planId: input.planId,
        title: task.title,
      };
      if (task.dueDateTime !== undefined) createInput.dueDateTime = task.dueDateTime;
      if (task.assigneeUserIds !== undefined) createInput.assigneeUserIds = task.assigneeUserIds;
      created.push(await deps.planner.createTask(createInput));
    } catch (err) {
      failed.push({
        index,
        title: task.title,
        error:
          err instanceof Ms365Error
            ? { kind: err.kind, message: err.message }
            : { kind: "unknown", message: "Lỗi không xác định khi tạo task." },
      });
    }
  }
  return { created, failed };
}

/**
 * The gated batch write. Mirrors `handleUpload`'s exact permission pattern: `gate.proceed`
 * runs `perform` SYNCHRONOUSLY; `perform` returns the batch promise and we await it OUTSIDE
 * `proceed`. Deny → `performed: false` → zero Graph calls.
 */
export async function handlePlannerCreateTasks(
  deps: ToolDeps,
  call: ToolCall & { name: "planner_create_tasks" },
): Promise<ToolResult> {
  const input = readCreateTasksBatchArgs(call.args);
  if (input === null) {
    return invalid(
      "planner_create_tasks cần planId là chuỗi không rỗng và tasks là mảng {title, dueDateTime?, assigneeUserIds?}.",
    );
  }
  if (input.tasks.length === 0) {
    return invalid("planner_create_tasks cần ít nhất 1 task.");
  }
  if (input.tasks.length > MAX_BATCH_SIZE) {
    return invalid(
      `planner_create_tasks tối đa ${MAX_BATCH_SIZE} task mỗi lần — hãy chia nhỏ thành nhiều batch.`,
    );
  }

  if (deps.writeMode() === "manual") {
    return {
      ok: false,
      error: {
        kind: "manual_mode",
        message: "Đang ở chế độ duyệt thủ công — tạo từng task riêng lẻ để user xác nhận từng cái.",
        recovery:
          "Dùng planner_create_task cho từng task (mỗi task một lần xác nhận), hoặc user bật chế độ Tự động ở thanh soạn tin Microsoft 365.",
      },
    };
  }

  const action: PermissionAction = {
    kind: "ms365_write",
    description: buildBatchDescription(input.planId, input.tasks),
  };
  deps.gate.submit(
    createPermissionRequest({
      requestId: call.requestId,
      sessionId: call.sessionId,
      action,
      requestedAt: deps.now(),
    }),
  );
  const decision = await awaitGateDecision(deps.gate, call.requestId, deps.wait ?? defaultWait);
  if (decision === "denied") {
    return {
      ok: false,
      error: {
        kind: "denied",
        message: "Yêu cầu tạo hàng loạt task Planner chưa được cho phép.",
        recovery: "Chấp thuận yêu cầu quyền rồi chạy lại công cụ.",
      },
    };
  }
  const outcome = deps.gate.proceed(call.requestId, () => runBatch(deps, input));
  if (!outcome.performed) {
    return {
      ok: false,
      error: {
        kind: "denied",
        message: "Yêu cầu tạo hàng loạt task Planner chưa được cho phép.",
        recovery: "Chấp thuận yêu cầu quyền rồi chạy lại công cụ.",
      },
    };
  }
  return { ok: true, data: await outcome.result };
}
