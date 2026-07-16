/**
 * Maps a single OpenCode `message.part.updated` part onto EV events (EV2/EV3/EV4).
 *
 * Split out of {@link ./ev-mapper} to keep both files cohesive and < 250 lines. Every
 * event here is FORWARDED from a real runtime part — nothing is synthesized. A file
 * mutation (EV4) is emitted only for a real file tool that has actually COMPLETED with a
 * concrete path, so the UI never sees a mutation the runtime did not perform.
 */

import type {
  EvBase,
  EvEvent,
  FileMutationOp,
  StepStatus,
  TurnMetrics,
} from "@cowork-ghc/contracts";
import { asRecord, readString, type RawPart } from "./opencode-events.js";

/** Read a finite number from a raw record field (ignores strings/NaN). */
function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Allocates the next {@link EvBase} (sessionId + monotonic seq + timestamp). */
export type BaseAllocator = () => EvBase;

/** Real OpenCode tool `state.status` → EV {@link StepStatus} (reference status set). */
function toolStatus(status: string | undefined): StepStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "error":
      return "errored";
    default:
      // Unknown/absent status: a tool part exists, so it is in-flight — never terminal.
      return "pending";
  }
}

const APPLY_PATCH_TOOL_NAMES = new Set(["patch", "apply_patch"]);

/** File-writing tools → the EV file-mutation op they represent (create vs in-place edit). */
const FILE_TOOL_OPS: Readonly<Record<string, FileMutationOp>> = {
  write: "create",
  edit: "edit",
  patch: "edit",
  apply_patch: "edit",
  multiedit: "edit",
  delete: "delete",
  remove: "delete",
  rm: "delete",
  unlink: "delete",
};

function toolInputPath(state: RawPart["state"]): string | undefined {
  const input = asRecord(state?.input);
  return (
    readString(input, "filePath") ??
    readString(input, "path") ??
    readString(input, "file")
  );
}

/** Parse OpenCode `apply_patch` marker lines for the affected relative path + op. */
export function parseApplyPatchMarker(
  patchText: string | undefined,
): { path?: string; operation?: FileMutationOp } {
  if (patchText === undefined || patchText.trim().length === 0) return {};
  const deleteMatch = /^\*\*\* Delete File:\s*(.+)$/m.exec(patchText);
  if (deleteMatch?.[1] !== undefined) {
    return { path: deleteMatch[1].trim(), operation: "delete" };
  }
  const addMatch = /^\*\*\* Add File:\s*(.+)$/m.exec(patchText);
  if (addMatch?.[1] !== undefined) {
    return { path: addMatch[1].trim(), operation: "create" };
  }
  const updateMatch = /^\*\*\* Update File:\s*(.+)$/m.exec(patchText);
  if (updateMatch?.[1] !== undefined) {
    return { path: updateMatch[1].trim(), operation: "edit" };
  }
  return {};
}

function applyPatchMarkerFromState(state: RawPart["state"]): ReturnType<typeof parseApplyPatchMarker> {
  const input = asRecord(state?.input);
  return parseApplyPatchMarker(
    readString(input, "patchText") ?? readString(input, "patch") ?? readString(input, "content"),
  );
}

/** Map a `step-start` / `step-finish` part to an EV2 step event. */
function mapStepPart(part: RawPart, alloc: BaseAllocator): readonly EvEvent[] {
  const isFinish = part.type === "step-finish";
  return [
    {
      ...alloc(),
      kind: "step",
      stepId: part.id ?? `${part.messageID ?? "msg"}:${part.type}`,
      label: isFinish ? "Step finished" : "Step started",
      status: isFinish ? "completed" : "running",
    },
  ];
}

/** Map a `tool` part to an EV3 tool-call event (+ an EV4 file mutation when applicable). */
function mapToolPart(part: RawPart, alloc: BaseAllocator): readonly EvEvent[] {
  const status = toolStatus(part.state?.status);
  const toolName = part.tool ?? "tool";
  let path = toolInputPath(part.state);
  let op = FILE_TOOL_OPS[toolName];
  if (APPLY_PATCH_TOOL_NAMES.has(toolName)) {
    const marker = applyPatchMarkerFromState(part.state);
    if (marker.path !== undefined) path = marker.path;
    if (marker.operation !== undefined) op = marker.operation;
  }
  const summary = path ?? part.state?.title;
  const events: EvEvent[] = [
    {
      ...alloc(),
      kind: "tool_call",
      callId: part.callID ?? part.id ?? `${part.messageID ?? "msg"}:tool`,
      toolName,
      status,
      ...(summary ? { summary } : {}),
    },
  ];

  // Only surface a file mutation once the real tool COMPLETED against a concrete path.
  if (op && path && status === "completed") {
    events.push({ ...alloc(), kind: "file_mutation", operation: op, path });
  }
  return events;
}

/**
 * Map a `step-finish` part's token/cost usage to a per-turn {@link MetricsEvent} (issue #4).
 * OpenCode carries usage on the raw `step-finish` part as `tokens` + `cost`; only non-secret
 * COUNTS are forwarded (never prompt/response content). Returns `[]` when no usage is present.
 */
export function mapStepMetrics(
  part: RawPart,
  partRaw: Record<string, unknown>,
  alloc: BaseAllocator,
): readonly EvEvent[] {
  if (part.type !== "step-finish") return [];
  const tokens = asRecord(partRaw["tokens"]);
  const input = readNumber(tokens, "input");
  const output = readNumber(tokens, "output");
  const total = readNumber(tokens, "total");
  const reasoning = readNumber(tokens, "reasoning");
  const cost = readNumber(partRaw, "cost");
  // OpenCode reports prompt-cache usage as a nested `{ read, write }`; sum to one non-secret count.
  const cacheRec = asRecord(tokens["cache"]);
  const cacheRead = readNumber(cacheRec, "read");
  const cacheWrite = readNumber(cacheRec, "write");
  const cache =
    cacheRead !== undefined || cacheWrite !== undefined
      ? (cacheRead ?? 0) + (cacheWrite ?? 0)
      : undefined;
  const metrics: TurnMetrics = {
    ...(input !== undefined ? { tokensInput: input } : {}),
    ...(output !== undefined ? { tokensOutput: output } : {}),
    ...(total !== undefined ? { tokensTotal: total } : {}),
    ...(reasoning !== undefined ? { tokensReasoning: reasoning } : {}),
    ...(cache !== undefined ? { tokensCache: cache } : {}),
    ...(cost !== undefined ? { costUsd: cost } : {}),
  };
  if (Object.keys(metrics).length === 0) return [];
  return [{ ...alloc(), kind: "metrics", metrics }];
}

/**
 * Map a `message.part.updated` part. Tool + step parts become EV events; text/reasoning
 * parts are intentionally not tokenized here (S2 tokens flow from `message.part.delta`),
 * so they return `[]` rather than being reported as unmapped.
 */
export function mapPart(part: RawPart, alloc: BaseAllocator): readonly EvEvent[] {
  if (part.type === "tool") return mapToolPart(part, alloc);
  if (part.type === "step-start" || part.type === "step-finish") {
    return mapStepPart(part, alloc);
  }
  return [];
}

/** Whether a part type is one we deliberately handle (vs a truly unknown shape). */
export function isHandledPartType(type: string | undefined): boolean {
  return (
    type === "tool" ||
    type === "step-start" ||
    type === "step-finish" ||
    type === "text" ||
    type === "reasoning" ||
    type === "file"
  );
}
