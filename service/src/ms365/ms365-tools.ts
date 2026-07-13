/**
 * MS365 tool definitions + `handleToolCall` dispatch (Task 9). The runtime invokes this to
 * run SharePoint tools. Reads (`search`, `list_site_files`, `get_file_summary`) run directly
 * once connected. The ONE write (`sharepoint_upload_file`) is routed through the existing
 * `PermissionGate` at the execution boundary: the Graph mutation runs ONLY behind a recorded
 * Allow (`gate.proceed`), so a Deny — or no decision at all — actually blocks it. There is NO
 * second confirmation mechanism; the gate is the single authority.
 *
 * Secret discipline: every `ToolResult` carries only non-secret, user-safe strings (tool
 * results, `Ms365Error.message`/`.recovery`, or fixed copy). No token, no raw Graph body.
 */
import type { PermissionAction } from "@cowork-ghc/contracts";

import type { Ms365ConnectionState } from "./ms365-connector.js";
import { Ms365Error } from "./ms365-errors.js";
import type { SharePointService } from "./sharepoint-service.js";
import { createPermissionRequest, type PermissionGate } from "../permission/index.js";

export type Ms365ToolName =
  | "sharepoint_search"
  | "sharepoint_list_site_files"
  | "sharepoint_get_file_summary"
  | "sharepoint_upload_file";

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
  connectionState: () => Ms365ConnectionState;
  gate: PermissionGate;
  now: () => string;
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
    default: {
      const exhaustive: "sharepoint_upload_file" = call.name;
      return invalid(`Công cụ không được hỗ trợ: ${exhaustive}`);
    }
  }
}

/**
 * Dispatch entry point. Fails closed when the connector is not `connected` (no throw), maps a
 * thrown {@link Ms365Error} to its non-secret kind/message/recovery, and routes the write
 * through the permission gate.
 */
export async function handleToolCall(deps: ToolDeps, call: ToolCall): Promise<ToolResult> {
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
    return await handleRead(deps, call);
  } catch (err) {
    if (err instanceof Ms365Error) {
      return { ok: false, error: { kind: err.kind, message: err.message, recovery: err.recovery } };
    }
    throw err;
  }
}
