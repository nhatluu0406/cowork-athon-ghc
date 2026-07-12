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
} from "@cowork-ghc/contracts";
import { asRecord, readString, type RawPart } from "./opencode-events.js";

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

/** File-writing tools → the EV file-mutation op they represent (create vs in-place edit). */
const FILE_TOOL_OPS: Readonly<Record<string, FileMutationOp>> = {
  write: "create",
  edit: "edit",
  patch: "edit",
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
  const events: EvEvent[] = [
    {
      ...alloc(),
      kind: "tool_call",
      callId: part.callID ?? part.id ?? `${part.messageID ?? "msg"}:tool`,
      toolName,
      status,
      ...(part.state?.title ? { summary: part.state.title } : {}),
    },
  ];

  const op = FILE_TOOL_OPS[toolName];
  const path = toolInputPath(part.state);
  // Only surface a file mutation once the real tool COMPLETED against a concrete path.
  if (op && path && status === "completed") {
    events.push({ ...alloc(), kind: "file_mutation", operation: op, path });
  }
  return events;
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
