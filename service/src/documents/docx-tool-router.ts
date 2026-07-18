/**
 * Docx document-generation boundary router (mounts on the CGHC-002 loopback boundary, ADR 0003/0005).
 *
 * SECURITY: the single route is TOKEN-GUARDED — no `publicUnauthenticated` (a public docx route
 * would let any loopback caller write a file into the active workspace, so it is forbidden here
 * exactly like the MS365 and provider routers). This is an INTERNAL SERVICE TOOL surface reached
 * over the loopback HTTP boundary, NOT an MCP server — the runtime calls `DOCX_TOOL_CALL_PATH`
 * the same way it calls any other boundary route, holding a token scoped to THIS path only.
 *
 * The file mutation runs through the SAME `PermissionGate` as every other file write: the
 * `createDocx` call happens ONLY behind a recorded Allow (`gate.proceed`), so a Deny — or no
 * decision at all — actually blocks it. This mirrors `ms365-tools.ts#handleUpload` exactly; the
 * gate is the single authority (no second confirmation mechanism).
 *
 * The plugin tool advertises the target path as `path` (so `part-mapper.ts#toolInputPath` picks
 * it up for File Work Review); the docx service expects `relativePath`, so the incoming `path` is
 * mapped to `relativePath` when calling `createDocx`.
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { PermissionAction } from "@cowork-ghc/contracts";
import { createPermissionRequest, type PermissionGate } from "../permission/index.js";
import { awaitGateDecision, defaultWait } from "../ms365/ms365-gate-wait.js";
import { createDocx, type CreateDocxInput } from "./docx-service.js";

export const DOCX_TOOL_CALL_PATH = "/v1/documents/create-docx";
export const DOCX_TOOL_NAME = "create_docx";

/** The boundary envelope every docx tool call returns (mirrors the MS365 `ToolResult`). */
export type DocxToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { kind: string; message: string; recovery?: string } };

/** One parsed, validated `create_docx` call. */
export interface DocxToolCall {
  args: Record<string, unknown>;
  sessionId: string;
  requestId: string;
}

export interface DocxRouterDeps {
  readonly gate: PermissionGate;
  readonly workspaceRoot: () => string | undefined;
  readonly now: () => string;
  /** Seam chờ giữa các lần poll gate (test tiêm instant). Default: setTimeout thật. */
  readonly wait?: (ms: number) => Promise<void>;
}

/**
 * Malformed docx request body (bad client input). Extends {@link BadRequestError} so the boundary
 * dispatcher maps it to HTTP 400 (not a misleading 500). The message stays generic and never
 * carries a secret/token.
 */
export class DocxRouterRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "DocxRouterRequestError";
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseCreateDocxBody(body: unknown): DocxToolCall {
  if (typeof body !== "object" || body === null) {
    throw new DocxRouterRequestError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  if (record.name !== DOCX_TOOL_NAME) {
    throw new DocxRouterRequestError(`name must be "${DOCX_TOOL_NAME}".`);
  }
  if (typeof record.args !== "object" || record.args === null || Array.isArray(record.args)) {
    throw new DocxRouterRequestError("args must be a JSON object.");
  }
  if (!nonEmptyString(record.sessionId)) {
    throw new DocxRouterRequestError("sessionId is required.");
  }
  if (!nonEmptyString(record.requestId)) {
    throw new DocxRouterRequestError("requestId is required.");
  }
  return { args: record.args as Record<string, unknown>, sessionId: record.sessionId, requestId: record.requestId };
}

function invalid(message: string): DocxToolResult {
  return {
    ok: false,
    error: { kind: "invalid_input", message, recovery: "Kiểm tra lại tham số của công cụ rồi thử lại." },
  };
}

function denied(): DocxToolResult {
  return {
    ok: false,
    error: {
      kind: "denied",
      message: "Yêu cầu tạo tệp Word chưa được cho phép.",
      recovery: "Chấp thuận yêu cầu quyền rồi chạy lại công cụ.",
    },
  };
}

/**
 * The gated docx write. Mirrors `ms365-tools.ts#handleUpload`'s exact permission pattern:
 * validate args → build the `file_create` {@link PermissionAction} → `gate.submit` →
 * `awaitGateDecision` → `gate.proceed` runs `createDocx` ONLY behind a recorded Allow.
 * `PermissionGate.proceed` runs `perform` SYNCHRONOUSLY and returns `{ performed, result }`;
 * `createDocx` is async, so `perform` RETURNS the promise and we await it OUTSIDE `proceed`.
 */
async function handleCreateDocx(deps: DocxRouterDeps, call: DocxToolCall): Promise<DocxToolResult> {
  const path = call.args.path;
  if (!nonEmptyString(path)) {
    return invalid("create_docx cần path là chuỗi không rỗng.");
  }
  const title = call.args.title;
  if (title !== undefined && typeof title !== "string") {
    return invalid("create_docx: title phải là chuỗi khi có mặt.");
  }
  const sections = call.args.sections;
  if (!Array.isArray(sections)) {
    return invalid("create_docx cần sections là một mảng.");
  }

  const action: PermissionAction = {
    kind: "file_create",
    targetPath: path,
    description: `Tạo tệp Word ${path}`,
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
    return denied();
  }

  // Map the plugin's `path` arg to the docx service's `relativePath`. `sections` is validated
  // in-depth by the docx service itself (bounds + shape); we pass it through unchanged.
  const input: CreateDocxInput = {
    relativePath: path,
    sections: sections as CreateDocxInput["sections"],
    ...(typeof title === "string" ? { title } : {}),
  };
  const outcome = deps.gate.proceed(call.requestId, () =>
    createDocx({ workspaceRoot: deps.workspaceRoot }, input),
  );
  if (!outcome.performed) {
    return denied();
  }
  // `createDocx` already returns `{ ok: true, data } | { ok: false, error }` — the boundary
  // envelope shape — so it is forwarded unchanged.
  return await outcome.result;
}

/** Build the docx router. The orchestrator mounts it via `service.mount`. */
export function createDocxRouter(deps: DocxRouterDeps): BoundaryRouter {
  return {
    name: "documents",
    routes: [
      {
        method: "POST",
        path: DOCX_TOOL_CALL_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<DocxToolResult>> => {
          const call = parseCreateDocxBody(ctx.body);
          const result = await handleCreateDocx(deps, call);
          return { status: 200, data: result };
        },
      },
    ],
  };
}
