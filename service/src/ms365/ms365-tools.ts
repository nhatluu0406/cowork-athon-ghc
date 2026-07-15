/**
 * MS365 tool definitions + `handleToolCall` dispatch (Task 9, extended by Task 3 of the
 * Planner CRUD slice, then by Task 2 of the Teams messaging slice). The runtime invokes this to
 * run SharePoint/Outlook/Planner/Lists/Teams tools. Reads (`search`, `list_site_files`,
 * `get_file_summary`, `planner_list_plans`, `planner_list_tasks`, `teams_list_chats`, …) run
 * directly once connected. Writes (`sharepoint_upload_file`, `planner_create_task`,
 * `planner_edit_task`, `planner_delete_task`, `lists_add_item`, `lists_edit_item`,
 * `lists_delete_item`, `teams_post_message`) are routed through the existing `PermissionGate`
 * at the execution boundary: the Graph mutation runs ONLY behind a recorded Allow
 * (`gate.proceed`), so a Deny — or no decision at all — actually blocks it. There is NO second
 * confirmation mechanism; the gate is the single authority.
 *
 * Secret discipline: every `ToolResult` carries only non-secret, user-safe strings (tool
 * results, `Ms365Error.message`/`.recovery`, or fixed copy). No token, no raw Graph body.
 *
 * Session gating (P5.5 Task 5, PO decision 2026-07-14): `handleToolCall` checks
 * `deps.sessionAllowed(call.sessionId)` FIRST, before `connectionState` or anything else —
 * only sessions registered by the Microsoft 365 tab (`Ms365SessionScope`, in-memory, fail-closed
 * by default) may call MS365 tools at all.
 */
import type { PermissionAction } from "@cowork-ghc/contracts";

import type { Ms365ConnectionState } from "./ms365-connector.js";
import { Ms365Error } from "./ms365-errors.js";
import type { SharePointService } from "./sharepoint-service.js";
import type { JoinedSite, SiteScopeService } from "./site-scope-service.js";
import type { OutlookService } from "./outlook-service.js";
import type { PlannerService } from "./planner-service.js";
import type { ListsService } from "./lists-service.js";
import type { MessageTarget, TeamsService } from "./teams-service.js";
import { createPermissionRequest, type PermissionGate } from "../permission/index.js";
import { handlePlannerCreateTasks } from "./ms365-batch-tools.js";
import { awaitGateDecision, defaultWait } from "./ms365-gate-wait.js";
import type { Ms365WriteMode } from "./write-mode-store.js";

export { defaultWait };

export type Ms365ToolName =
  | "sharepoint_search"
  | "sharepoint_list_site_files"
  | "sharepoint_get_file_summary"
  | "sharepoint_upload_file"
  | "ms365_list_joined_sites"
  | "outlook_search_messages"
  | "outlook_get_message"
  | "outlook_summarize_message"
  | "planner_list_plans"
  | "planner_list_tasks"
  | "planner_create_task"
  | "planner_create_tasks"
  | "planner_edit_task"
  | "planner_delete_task"
  | "lists_get_lists"
  | "lists_get_items"
  | "lists_add_item"
  | "lists_edit_item"
  | "lists_delete_item"
  | "teams_list_chats"
  | "teams_list_teams"
  | "teams_list_channels"
  | "teams_list_members"
  | "teams_get_messages"
  | "teams_post_message";

export interface ToolCall {
  name: Ms365ToolName;
  args: Record<string, unknown>;
  sessionId: string;
  requestId: string;
}

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { kind: string; message: string; recovery?: string } };

export interface ToolDeps {
  sharepoint: SharePointService;
  siteScope: Pick<SiteScopeService, "listJoinedSites">;
  outlook: OutlookService;
  planner: PlannerService;
  lists: ListsService;
  teams: TeamsService;
  connectionState: () => Ms365ConnectionState;
  gate: PermissionGate;
  now: () => string;
  /** Batch-write confirmation mode (Task 1 store). `manual` (default) makes the batch tool
   * refuse with `manual_mode` BEFORE any permission request. Enforced at this execution
   * boundary, never in the prompt. */
  writeMode: () => Ms365WriteMode;
  /** Seam chờ giữa các lần poll gate (test tiêm instant). Default: setTimeout thật. */
  wait?: (ms: number) => Promise<void>;
  /** Session gating (P5.5 Task 5, PO decision 2026-07-14): only sessions registered by the
   * Microsoft 365 tab may call MS365 tools. Checked FIRST in `handleToolCall`, before
   * `connectionState` or anything else runs — fail-closed for any unregistered session id. */
  sessionAllowed: (sessionId: string) => boolean;
}

interface UploadArgs {
  siteId: string;
  relativeLocalPath: string;
  targetName: string;
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

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Validates + narrows the upload args; returns null when any required field is missing. */
function readUploadArgs(args: Record<string, unknown>): UploadArgs | null {
  if (!nonEmptyString(args.siteId)) return null;
  if (!nonEmptyString(args.relativeLocalPath)) return null;
  if (!nonEmptyString(args.targetName)) return null;
  return { siteId: args.siteId, relativeLocalPath: args.relativeLocalPath, targetName: args.targetName };
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => nonEmptyString(v));
}

interface CreateTaskArgs {
  planId: string;
  title: string;
  dueDateTime?: string;
  assigneeUserIds?: string[];
}

/** Validates + narrows `planner_create_task` args; null when required fields are missing or an
 * optional field is present but the wrong shape. */
function readCreateTaskArgs(args: Record<string, unknown>): CreateTaskArgs | null {
  if (!nonEmptyString(args.planId)) return null;
  if (!nonEmptyString(args.title)) return null;
  if (args.dueDateTime !== undefined && !nonEmptyString(args.dueDateTime)) return null;
  if (args.assigneeUserIds !== undefined && !isNonEmptyStringArray(args.assigneeUserIds)) return null;
  const out: CreateTaskArgs = { planId: args.planId, title: args.title };
  if (nonEmptyString(args.dueDateTime)) out.dueDateTime = args.dueDateTime;
  if (isNonEmptyStringArray(args.assigneeUserIds)) out.assigneeUserIds = args.assigneeUserIds;
  return out;
}

interface EditTaskArgs {
  taskId: string;
  etag: string;
  title?: string;
  dueDateTime?: string;
  percentComplete?: number;
}

function isPercentComplete(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

/** Validates + narrows `planner_edit_task` args; null when taskId/etag are missing, an optional
 * field is present but the wrong shape, or none of title/dueDateTime/percentComplete is set. */
function readEditTaskArgs(args: Record<string, unknown>): EditTaskArgs | null {
  if (!nonEmptyString(args.taskId)) return null;
  if (!nonEmptyString(args.etag)) return null;
  if (args.title !== undefined && !nonEmptyString(args.title)) return null;
  if (args.dueDateTime !== undefined && !nonEmptyString(args.dueDateTime)) return null;
  if (args.percentComplete !== undefined && !isPercentComplete(args.percentComplete)) return null;
  const out: EditTaskArgs = { taskId: args.taskId, etag: args.etag };
  if (nonEmptyString(args.title)) out.title = args.title;
  if (nonEmptyString(args.dueDateTime)) out.dueDateTime = args.dueDateTime;
  if (isPercentComplete(args.percentComplete)) out.percentComplete = args.percentComplete;
  if (out.title === undefined && out.dueDateTime === undefined && out.percentComplete === undefined) return null;
  return out;
}

interface DeleteTaskArgs {
  taskId: string;
  etag: string;
}

function readDeleteTaskArgs(args: Record<string, unknown>): DeleteTaskArgs | null {
  if (!nonEmptyString(args.taskId)) return null;
  if (!nonEmptyString(args.etag)) return null;
  return { taskId: args.taskId, etag: args.etag };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface AddItemArgs {
  siteId: string;
  listId: string;
  fields: Record<string, unknown>;
}

/** Validates + narrows `lists_add_item` args; null when siteId/listId are missing or fields is
 * not a plain object (object, non-null, non-array). */
function readAddItemArgs(args: Record<string, unknown>): AddItemArgs | null {
  if (!nonEmptyString(args.siteId)) return null;
  if (!nonEmptyString(args.listId)) return null;
  if (!isPlainObject(args.fields)) return null;
  return { siteId: args.siteId, listId: args.listId, fields: args.fields };
}

interface EditItemArgs {
  siteId: string;
  listId: string;
  itemId: string;
  fields: Record<string, unknown>;
}

/** Validates + narrows `lists_edit_item` args; null when any required field is missing or
 * fields is not a plain object. */
function readEditItemArgs(args: Record<string, unknown>): EditItemArgs | null {
  if (!nonEmptyString(args.siteId)) return null;
  if (!nonEmptyString(args.listId)) return null;
  if (!nonEmptyString(args.itemId)) return null;
  if (!isPlainObject(args.fields)) return null;
  return { siteId: args.siteId, listId: args.listId, itemId: args.itemId, fields: args.fields };
}

interface DeleteItemArgs {
  siteId: string;
  listId: string;
  itemId: string;
}

function readDeleteItemArgs(args: Record<string, unknown>): DeleteItemArgs | null {
  if (!nonEmptyString(args.siteId)) return null;
  if (!nonEmptyString(args.listId)) return null;
  if (!nonEmptyString(args.itemId)) return null;
  return { siteId: args.siteId, listId: args.listId, itemId: args.itemId };
}

/** Validates + narrows a Teams message target: exactly one of `{chatId}` or
 * `{teamId, channelId}` must be present as non-empty strings — both forms given, neither form
 * given, or a partial channel form (only one of teamId/channelId) all return null. */
function readTarget(args: Record<string, unknown>): MessageTarget | null {
  const hasChatId = nonEmptyString(args.chatId);
  const hasTeamId = nonEmptyString(args.teamId);
  const hasChannelId = nonEmptyString(args.channelId);
  if (hasChatId && !hasTeamId && !hasChannelId) {
    return { chatId: args.chatId as string };
  }
  if (!hasChatId && hasTeamId && hasChannelId) {
    return { teamId: args.teamId as string, channelId: args.channelId as string };
  }
  return null;
}

interface MentionInput {
  userId: string;
  displayName: string;
}

function isMentionArray(value: unknown): value is MentionInput[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      nonEmptyString((m as Record<string, unknown>).userId) &&
      nonEmptyString((m as Record<string, unknown>).displayName),
  );
}

interface PostMessageArgs {
  target: MessageTarget;
  content: string;
  mentions?: MentionInput[];
}

/** Validates + narrows `teams_post_message` args; null when the target is ambiguous/missing,
 * content is missing, or mentions is present but not an array of `{userId, displayName}`. */
function readPostMessageArgs(args: Record<string, unknown>): PostMessageArgs | null {
  const target = readTarget(args);
  if (target === null) return null;
  if (!nonEmptyString(args.content)) return null;
  if (args.mentions !== undefined && !isMentionArray(args.mentions)) return null;
  const out: PostMessageArgs = { target, content: args.content };
  if (isMentionArray(args.mentions)) out.mentions = args.mentions;
  return out;
}

function deniedResult(message: string): ToolResult {
  return {
    ok: false,
    error: {
      kind: "denied",
      message,
      recovery: "Chấp thuận yêu cầu quyền rồi chạy lại công cụ.",
    },
  };
}

/**
 * The gated SharePoint write. `PermissionGate.proceed` runs `perform` SYNCHRONOUSLY and
 * returns `{ performed, result }`; `upload` is async, so `perform` RETURNS the upload promise
 * and we await that promise OUTSIDE `proceed`. Without a recorded Allow, `proceed` returns
 * `{ performed: false }` and the upload never runs → denied.
 */
async function handleUpload(deps: ToolDeps, call: ToolCall): Promise<ToolResult> {
  const input = readUploadArgs(call.args);
  if (input === null) {
    return invalid("Upload cần siteId, relativeLocalPath và targetName là chuỗi không rỗng.");
  }

  const action: PermissionAction = {
    kind: "ms365_write",
    description: `Upload ${input.targetName} lên SharePoint`,
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
        message: "Yêu cầu upload lên SharePoint chưa được cho phép.",
        recovery: "Chấp thuận yêu cầu quyền rồi chạy lại công cụ.",
      },
    };
  }
  const outcome = deps.gate.proceed(call.requestId, () => deps.sharepoint.upload(input));
  if (!outcome.performed) {
    return {
      ok: false,
      error: {
        kind: "denied",
        message: "Yêu cầu upload lên SharePoint chưa được cho phép.",
        recovery: "Chấp thuận yêu cầu quyền rồi chạy lại công cụ.",
      },
    };
  }
  return { ok: true, data: await outcome.result };
}

/**
 * The gated Planner writes (create/edit/delete task) — ONE function for all 3, mirroring
 * {@link handleUpload}'s exact permission pattern: validate args → build the `PermissionAction`
 * → `gate.submit` → `gate.proceed` runs the Planner mutation ONLY behind a recorded Allow.
 * `edit`/`delete` resolve `void`; their `ToolResult.data` is a fixed `{ done: true }` marker.
 */
async function handlePlannerWrite(
  deps: ToolDeps,
  call: ToolCall & { name: "planner_create_task" | "planner_edit_task" | "planner_delete_task" },
): Promise<ToolResult> {
  switch (call.name) {
    case "planner_create_task": {
      const input = readCreateTaskArgs(call.args);
      if (input === null) {
        return invalid("planner_create_task cần planId và title là chuỗi không rỗng.");
      }
      const action: PermissionAction = {
        kind: "ms365_write",
        description: `Tạo task "${input.title}" trong Planner`,
      };
      deps.gate.submit(
        createPermissionRequest({ requestId: call.requestId, sessionId: call.sessionId, action, requestedAt: deps.now() }),
      );
      const decision = await awaitGateDecision(deps.gate, call.requestId, deps.wait ?? defaultWait);
      if (decision === "denied") {
        return deniedResult("Yêu cầu tạo task Planner chưa được cho phép.");
      }
      const outcome = deps.gate.proceed(call.requestId, () => deps.planner.createTask(input));
      if (!outcome.performed) {
        return deniedResult("Yêu cầu tạo task Planner chưa được cho phép.");
      }
      return { ok: true, data: await outcome.result };
    }
    case "planner_edit_task": {
      const input = readEditTaskArgs(call.args);
      if (input === null) {
        return invalid(
          "planner_edit_task cần taskId, etag, và ít nhất một trong title/dueDateTime/percentComplete.",
        );
      }
      const action: PermissionAction = {
        kind: "ms365_write",
        description: `Sửa task ${input.taskId} trong Planner`,
      };
      deps.gate.submit(
        createPermissionRequest({ requestId: call.requestId, sessionId: call.sessionId, action, requestedAt: deps.now() }),
      );
      const decision = await awaitGateDecision(deps.gate, call.requestId, deps.wait ?? defaultWait);
      if (decision === "denied") {
        return deniedResult("Yêu cầu sửa task Planner chưa được cho phép.");
      }
      const outcome = deps.gate.proceed(call.requestId, () => deps.planner.editTask(input));
      if (!outcome.performed) {
        return deniedResult("Yêu cầu sửa task Planner chưa được cho phép.");
      }
      await outcome.result;
      return { ok: true, data: { done: true } };
    }
    case "planner_delete_task": {
      const input = readDeleteTaskArgs(call.args);
      if (input === null) {
        return invalid("planner_delete_task cần taskId và etag là chuỗi không rỗng.");
      }
      const action: PermissionAction = {
        kind: "ms365_write",
        description: `Xóa task ${input.taskId} trong Planner`,
      };
      deps.gate.submit(
        createPermissionRequest({ requestId: call.requestId, sessionId: call.sessionId, action, requestedAt: deps.now() }),
      );
      const decision = await awaitGateDecision(deps.gate, call.requestId, deps.wait ?? defaultWait);
      if (decision === "denied") {
        return deniedResult("Yêu cầu xóa task Planner chưa được cho phép.");
      }
      const outcome = deps.gate.proceed(call.requestId, () => deps.planner.deleteTask(input));
      if (!outcome.performed) {
        return deniedResult("Yêu cầu xóa task Planner chưa được cho phép.");
      }
      await outcome.result;
      return { ok: true, data: { done: true } };
    }
    default: {
      const exhaustive: never = call.name;
      return invalid(`Công cụ không được hỗ trợ: ${exhaustive}`);
    }
  }
}

/**
 * The gated Lists writes (add/edit/delete item) — mirrors {@link handlePlannerWrite}'s exact
 * permission pattern: validate args → build the `PermissionAction` → `gate.submit` →
 * `gate.proceed` runs the Lists mutation ONLY behind a recorded Allow. `edit`/`delete` resolve
 * `void`; their `ToolResult.data` is a fixed `{ done: true }` marker.
 */
async function handleListsWrite(
  deps: ToolDeps,
  call: ToolCall & { name: "lists_add_item" | "lists_edit_item" | "lists_delete_item" },
): Promise<ToolResult> {
  switch (call.name) {
    case "lists_add_item": {
      const input = readAddItemArgs(call.args);
      if (input === null) {
        return invalid("lists_add_item cần siteId, listId là chuỗi không rỗng và fields là object.");
      }
      const action: PermissionAction = {
        kind: "ms365_write",
        description: `Thêm item vào list ${input.listId}`,
      };
      deps.gate.submit(
        createPermissionRequest({ requestId: call.requestId, sessionId: call.sessionId, action, requestedAt: deps.now() }),
      );
      const decision = await awaitGateDecision(deps.gate, call.requestId, deps.wait ?? defaultWait);
      if (decision === "denied") {
        return deniedResult("Yêu cầu thêm item vào list chưa được cho phép.");
      }
      const outcome = deps.gate.proceed(call.requestId, () => deps.lists.addItem(input));
      if (!outcome.performed) {
        return deniedResult("Yêu cầu thêm item vào list chưa được cho phép.");
      }
      return { ok: true, data: await outcome.result };
    }
    case "lists_edit_item": {
      const input = readEditItemArgs(call.args);
      if (input === null) {
        return invalid("lists_edit_item cần siteId, listId, itemId là chuỗi không rỗng và fields là object.");
      }
      const action: PermissionAction = {
        kind: "ms365_write",
        description: `Sửa item ${input.itemId} trong list ${input.listId}`,
      };
      deps.gate.submit(
        createPermissionRequest({ requestId: call.requestId, sessionId: call.sessionId, action, requestedAt: deps.now() }),
      );
      const decision = await awaitGateDecision(deps.gate, call.requestId, deps.wait ?? defaultWait);
      if (decision === "denied") {
        return deniedResult("Yêu cầu sửa item trong list chưa được cho phép.");
      }
      const outcome = deps.gate.proceed(call.requestId, () => deps.lists.editItem(input));
      if (!outcome.performed) {
        return deniedResult("Yêu cầu sửa item trong list chưa được cho phép.");
      }
      await outcome.result;
      return { ok: true, data: { done: true } };
    }
    case "lists_delete_item": {
      const input = readDeleteItemArgs(call.args);
      if (input === null) {
        return invalid("lists_delete_item cần siteId, listId, itemId là chuỗi không rỗng.");
      }
      const action: PermissionAction = {
        kind: "ms365_write",
        description: `Xóa item ${input.itemId} khỏi list ${input.listId}`,
      };
      deps.gate.submit(
        createPermissionRequest({ requestId: call.requestId, sessionId: call.sessionId, action, requestedAt: deps.now() }),
      );
      const decision = await awaitGateDecision(deps.gate, call.requestId, deps.wait ?? defaultWait);
      if (decision === "denied") {
        return deniedResult("Yêu cầu xóa item khỏi list chưa được cho phép.");
      }
      const outcome = deps.gate.proceed(call.requestId, () => deps.lists.deleteItem(input));
      if (!outcome.performed) {
        return deniedResult("Yêu cầu xóa item khỏi list chưa được cho phép.");
      }
      await outcome.result;
      return { ok: true, data: { done: true } };
    }
    default: {
      const exhaustive: never = call.name;
      return invalid(`Công cụ không được hỗ trợ: ${exhaustive}`);
    }
  }
}

/**
 * The gated Teams write (`teams_post_message`) — mirrors {@link handleListsWrite}'s exact
 * permission pattern: validate args → build the `PermissionAction` → `gate.submit` →
 * `gate.proceed` runs the Teams post ONLY behind a recorded Allow. Resolves `{ id }` from the
 * service; `ToolResult.data` carries that `{ id }` unchanged.
 */
async function handleTeamsWrite(
  deps: ToolDeps,
  call: ToolCall & { name: "teams_post_message" },
): Promise<ToolResult> {
  const input = readPostMessageArgs(call.args);
  if (input === null) {
    return invalid(
      "teams_post_message cần đúng một trong chatId hoặc (teamId và channelId), content là chuỗi không rỗng, và mentions (nếu có) là mảng {userId, displayName}.",
    );
  }
  const { target, content, mentions } = input;
  const targetDesc = "chatId" in target ? `chat ${target.chatId}` : `channel ${target.channelId}`;
  const mentionsDesc = mentions !== undefined && mentions.length > 0 ? ` (mention ${mentions.length} người)` : "";
  const action: PermissionAction = {
    kind: "ms365_write",
    description: `Gửi tin nhắn Teams tới ${targetDesc}${mentionsDesc}`,
  };
  deps.gate.submit(
    createPermissionRequest({ requestId: call.requestId, sessionId: call.sessionId, action, requestedAt: deps.now() }),
  );
  const decision = await awaitGateDecision(deps.gate, call.requestId, deps.wait ?? defaultWait);
  if (decision === "denied") {
    return deniedResult("Yêu cầu gửi tin nhắn Teams chưa được cho phép.");
  }
  const outcome = deps.gate.proceed(call.requestId, () =>
    deps.teams.postMessage(mentions !== undefined ? { target, content, mentions } : { target, content }),
  );
  if (!outcome.performed) {
    return deniedResult("Yêu cầu gửi tin nhắn Teams chưa được cho phép.");
  }
  return { ok: true, data: await outcome.result };
}

/** Dispatches one read tool; validates args, then calls the SharePoint method directly. */
async function handleRead(deps: ToolDeps, call: ToolCall): Promise<ToolResult> {
  switch (call.name) {
    case "sharepoint_search": {
      if (!nonEmptyString(call.args.query)) return invalid("search cần query là chuỗi không rỗng.");
      return { ok: true, data: await deps.sharepoint.search(call.args.query) };
    }
    case "sharepoint_list_site_files": {
      if (!nonEmptyString(call.args.siteId)) return invalid("list_site_files cần siteId là chuỗi.");
      return { ok: true, data: await deps.sharepoint.listSiteFiles(call.args.siteId) };
    }
    case "sharepoint_get_file_summary": {
      if (!nonEmptyString(call.args.driveItemId)) return invalid("get_file_summary cần driveItemId là chuỗi.");
      return { ok: true, data: await deps.sharepoint.getFileSummaryText(call.args.driveItemId) };
    }
    case "ms365_list_joined_sites": {
      const sites: JoinedSite[] = await deps.siteScope.listJoinedSites();
      return { ok: true, data: sites };
    }
    case "outlook_search_messages": {
      if (!nonEmptyString(call.args.query)) return invalid("outlook_search_messages cần query là chuỗi không rỗng.");
      return { ok: true, data: await deps.outlook.searchMessages(call.args.query) };
    }
    case "outlook_get_message": {
      if (!nonEmptyString(call.args.id)) return invalid("outlook_get_message cần id là chuỗi.");
      return { ok: true, data: await deps.outlook.getMessage(call.args.id) };
    }
    case "outlook_summarize_message": {
      if (!nonEmptyString(call.args.id)) return invalid("outlook_summarize_message cần id là chuỗi.");
      return { ok: true, data: await deps.outlook.getMessageSummaryText(call.args.id) };
    }
    case "planner_list_plans": {
      return { ok: true, data: await deps.planner.listPlans() };
    }
    case "planner_list_tasks": {
      if (!nonEmptyString(call.args.planId)) return invalid("planner_list_tasks cần planId là chuỗi.");
      return { ok: true, data: await deps.planner.listTasks(call.args.planId) };
    }
    case "lists_get_lists": {
      if (!nonEmptyString(call.args.siteId)) return invalid("lists_get_lists cần siteId là chuỗi.");
      return { ok: true, data: await deps.lists.getLists(call.args.siteId) };
    }
    case "lists_get_items": {
      if (!nonEmptyString(call.args.siteId)) return invalid("lists_get_items cần siteId là chuỗi.");
      if (!nonEmptyString(call.args.listId)) return invalid("lists_get_items cần listId là chuỗi.");
      if (call.args.filter !== undefined && !nonEmptyString(call.args.filter)) {
        return invalid("lists_get_items: filter phải là chuỗi không rỗng khi có mặt.");
      }
      return {
        ok: true,
        data: await deps.lists.getItems(call.args.siteId, call.args.listId, call.args.filter),
      };
    }
    case "teams_list_chats": {
      return { ok: true, data: await deps.teams.listChats() };
    }
    case "teams_list_teams": {
      return { ok: true, data: await deps.teams.listTeams() };
    }
    case "teams_list_channels": {
      if (!nonEmptyString(call.args.teamId)) return invalid("teams_list_channels cần teamId là chuỗi.");
      return { ok: true, data: await deps.teams.listChannels(call.args.teamId) };
    }
    case "teams_list_members": {
      const hasChatId = nonEmptyString(call.args.chatId);
      const hasTeamId = nonEmptyString(call.args.teamId);
      if (hasChatId === hasTeamId) {
        return invalid("teams_list_members cần đúng một trong chatId hoặc teamId là chuỗi không rỗng.");
      }
      return {
        ok: true,
        data: await deps.teams.listMembers(
          hasChatId ? { chatId: call.args.chatId as string } : { teamId: call.args.teamId as string },
        ),
      };
    }
    case "teams_get_messages": {
      const target = readTarget(call.args);
      if (target === null) {
        return invalid("teams_get_messages cần đúng một trong chatId hoặc (teamId và channelId).");
      }
      return { ok: true, data: await deps.teams.getMessages(target) };
    }
    default: {
      const exhaustive:
        | "sharepoint_upload_file"
        | "planner_create_task"
        | "planner_create_tasks"
        | "planner_edit_task"
        | "planner_delete_task"
        | "lists_add_item"
        | "lists_edit_item"
        | "lists_delete_item"
        | "teams_post_message" = call.name;
      return invalid(`Công cụ không được hỗ trợ: ${exhaustive}`);
    }
  }
}

type PlannerWriteName = "planner_create_task" | "planner_edit_task" | "planner_delete_task";
type ListsWriteName = "lists_add_item" | "lists_edit_item" | "lists_delete_item";
type TeamsWriteName = "teams_post_message";

/** The 3 Planner writes, routed through {@link handlePlannerWrite} before any read dispatch. A
 * type-guard on the whole `call` (not just `call.name`) so the write handler's switch default
 * narrows to `never` without a cast. */
function isPlannerWrite(call: ToolCall): call is ToolCall & { name: PlannerWriteName } {
  return (
    call.name === "planner_create_task" || call.name === "planner_edit_task" || call.name === "planner_delete_task"
  );
}

/** The 3 Lists writes, routed through {@link handleListsWrite} before any read dispatch. A
 * type-guard on the whole `call` (not just `call.name`) so the write handler's switch default
 * narrows to `never` without a cast. */
function isListsWrite(call: ToolCall): call is ToolCall & { name: ListsWriteName } {
  return call.name === "lists_add_item" || call.name === "lists_edit_item" || call.name === "lists_delete_item";
}

/** The Teams write, routed through {@link handleTeamsWrite} before any read dispatch. A
 * type-guard on the whole `call` (not just `call.name`) so the write handler's switch default
 * narrows to `never` without a cast. */
function isTeamsWrite(call: ToolCall): call is ToolCall & { name: TeamsWriteName } {
  return call.name === "teams_post_message";
}

/** The Planner batch write, routed through `handlePlannerCreateTasks` (ms365-batch-tools.ts)
 * before any read dispatch. */
function isPlannerBatchWrite(call: ToolCall): call is ToolCall & { name: "planner_create_tasks" } {
  return call.name === "planner_create_tasks";
}

/**
 * Dispatch entry point. Fails closed when the connector is not `connected` (no throw), maps a
 * thrown {@link Ms365Error} to its non-secret kind/message/recovery, and routes the write
 * through the permission gate.
 */
export async function handleToolCall(deps: ToolDeps, call: ToolCall): Promise<ToolResult> {
  if (!deps.sessionAllowed(call.sessionId)) {
    return {
      ok: false,
      error: {
        kind: "session_not_allowed",
        message: "Tool Microsoft 365 chỉ dùng được trong tab Microsoft 365.",
        recovery: "Mở tab Microsoft 365 và chat từ đó.",
      },
    };
  }

  if (deps.connectionState() !== "connected") {
    return {
      ok: false,
      error: {
        kind: "not_connected",
        message: "Chưa kết nối Microsoft 365.",
        recovery: "Kết nối Microsoft 365 rồi thử lại.",
      },
    };
  }

  try {
    if (call.name === "sharepoint_upload_file") return await handleUpload(deps, call);
    if (isPlannerBatchWrite(call)) return await handlePlannerCreateTasks(deps, call);
    if (isPlannerWrite(call)) return await handlePlannerWrite(deps, call);
    if (isListsWrite(call)) return await handleListsWrite(deps, call);
    if (isTeamsWrite(call)) return await handleTeamsWrite(deps, call);
    return await handleRead(deps, call);
  } catch (err) {
    if (err instanceof Ms365Error) {
      return { ok: false, error: { kind: err.kind, message: err.message, recovery: err.recovery } };
    }
    throw err;
  }
}
