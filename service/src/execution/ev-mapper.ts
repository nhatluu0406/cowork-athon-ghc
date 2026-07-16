/**
 * OpenCode SSE → EV mapper (CGHC-012, ADR 0001 §3).
 *
 * A stateful, per-session mapper that folds a raw OpenCode `/event` frame into zero or
 * more Cowork-GHC EV events. Core rules (EV7 / testing.md "no fabricated completed"):
 *  - Events are FORWARDED, never fabricated. A terminal `completed` is emitted ONLY from
 *    a real `session.idle` frame; `errored` / `cancelled` only from a real `session.error`.
 *  - Unknown / unmapped frames are handled explicitly: reported to `onUnmapped` and
 *    dropped. The mapper NEVER invents a terminal event the runtime did not send.
 *  - `seq` is monotonic per session (for CGHC-014 resync). Resume from `startSeq`.
 *
 * The mapper is transport-agnostic: feed it parsed `{ type, properties }` objects (live
 * SDK path) or objects decoded from captured wire text via {@link ./sse-decode}
 * (CGHC-024 re-capture seam) — the mapping is identical.
 */

import type {
  ErrorEvent,
  EvBase,
  EvEvent,
  RecoveryAction,
  SessionId,
  TerminalEvent,
} from "@cowork-ghc/contracts";
import {
  asRecord,
  frameSessionId,
  isRawOpencodeEvent,
  readArray,
  readPart,
  readString,
  type RawOpencodeEvent,
} from "./opencode-events.js";
import { mapPart, mapStepMetrics, type BaseAllocator } from "./part-mapper.js";
import { mapTodos } from "./todo-mapper.js";
import { mapTextPartSnapshot, noteTextPartDelta, type TextPartCursorMap } from "./text-part-mapper.js";
import { sanitizeErrorMessage } from "./error-sanitize.js";
import {
  createMessageRoleTracker,
  isAssistantMessageRole,
  type MessageRoleTracker,
} from "./message-role-tracker.js";

export interface EvMapperOptions {
  /** The session this mapper is bound to; frames for other sessions are dropped. */
  readonly sessionId: SessionId;
  /** Timestamp source for `EvBase.at` (injectable for deterministic tests). */
  readonly now?: () => string;
  /** Called for any frame that is not mapped to an EV event (log-and-drop, no throw). */
  readonly onUnmapped?: (frame: RawOpencodeEvent) => void;
  /** Resume the monotonic `seq` after a reconnect/resync (defaults to 0 → first seq is 1). */
  readonly startSeq?: number;
  /**
   * Redactor applied to the human-facing message of a `session.error` frame at this single
   * choke point (HIGH-S1/HIGH-S2). Because BOTH the live EV stream and the reducer-derived
   * snapshot flow through the mapper, redacting here covers both without a second pass.
   *
   * Defaults to the shared SHAPE-based {@link sanitizeErrorMessage}, so there is ALWAYS a
   * server-side redaction layer even before real credential VALUES are known. The composition
   * root replaces it with a COMPOSED redactor — VALUE-based `SecretScrubber.scrub` THEN
   * `sanitizeErrorMessage` — giving shape-independent redaction of the real seeded keys.
   */
  readonly redactError?: (message: string) => string;
}

export interface EvMapper {
  /** Map one raw frame (parsed or of unknown shape) to EV events. */
  readonly map: (frame: unknown) => readonly EvEvent[];
  /** The highest `seq` emitted so far (authoritative cursor for resync). */
  readonly lastSeq: () => number;
}

/** Map an OpenCode `session.error` name to a UI recovery action (EV6). */
function recoveryFor(name: string | undefined): RecoveryAction {
  switch (name) {
    case "ProviderAuthError":
      return { kind: "reconfigure_credential", label: "Reconfigure credential" };
    case "ContextOverflowError":
    case "MessageOutputLengthError":
      return { kind: "switch_model", label: "Switch model" };
    default:
      return { kind: "retry", label: "Retry" };
  }
}

/** Read the `{ name, message }` off a `session.error` frame's error payload. */
function readSessionError(
  frame: RawOpencodeEvent,
): { name: string | undefined; message: string | undefined } {
  const props = asRecord(frame.properties);
  const error = asRecord(props.error ?? props);
  const data = asRecord(error.data);
  const name = readString(error, "name") ?? readString(error, "type") ?? readString(data, "name");
  const message =
    readString(error, "message") ?? readString(data, "message") ?? readString(error, "detail");
  return { name, message };
}

export function createEvMapper(options: EvMapperOptions): EvMapper {
  const clock = options.now ?? (() => new Date().toISOString());
  // Always redact the untrusted runtime error message; default to the shared shape-based
  // sanitizer so a leak is impossible even before real secret VALUES are seeded (HIGH-S1).
  const redactError = options.redactError ?? sanitizeErrorMessage;
  let seq = options.startSeq ?? 0;
  const textPartCursors: TextPartCursorMap = new Map();
  const messageRoles: MessageRoleTracker = createMessageRoleTracker();

  const alloc: BaseAllocator = (): EvBase => ({
    sessionId: options.sessionId,
    seq: ++seq,
    at: clock(),
  });

  function mapSessionError(frame: RawOpencodeEvent): readonly EvEvent[] {
    const { name, message } = readSessionError(frame);
    // A real interruption is a `cancelled` terminal, NOT an error and NOT `completed`. Its
    // message derives from the same untrusted `session.error` payload, so it is redacted too.
    if (name === "MessageAbortedError") {
      const terminal: TerminalEvent = {
        ...alloc(),
        kind: "terminal",
        state: "cancelled",
        message: redactError(message ?? "The run was cancelled."),
      };
      return [terminal];
    }
    const errorEvent: ErrorEvent = {
      ...alloc(),
      kind: "error",
      message: redactError(message ?? "The runtime reported an error."),
      recovery: recoveryFor(name),
    };
    const terminal: TerminalEvent = { ...alloc(), kind: "terminal", state: "errored" };
    return [errorEvent, terminal];
  }

  function dispatch(frame: RawOpencodeEvent): readonly EvEvent[] {
    switch (frame.type) {
      case "todo.updated": {
        const todos = readArray(asRecord(frame.properties), "todos");
        return [{ ...alloc(), kind: "plan", todos: mapTodos(todos) }];
      }
      case "message.part.updated": {
        const part = readPart(frame);
        if (!part) return [];
        const partRaw = asRecord(asRecord(frame.properties).part);
        const toolEvents = mapPart(part, alloc);
        const role = messageRoles.roleOf(part.messageID);
        if (!isAssistantMessageRole(role)) return toolEvents;
        const metricsEvents = mapStepMetrics(part, partRaw, alloc);
        const textEvents = mapTextPartSnapshot(part, partRaw, alloc, textPartCursors);
        return [...toolEvents, ...metricsEvents, ...textEvents];
      }
      case "message.part.delta": {
        const props = asRecord(frame.properties);
        const delta = readString(props, "delta");
        if (!delta) return [];
        // Only the answer's `text` field becomes visible tokens. Reasoning/"thinking" deltas
        // (`field: "reasoning"`, emitted by DeepSeek/GLM-style models) must NOT leak into the
        // assistant bubble. A frame without a `field` is treated as text (older runtime frames).
        const field = readString(props, "field");
        if (field !== undefined && field !== "text") return [];
        const messageId = readString(props, "messageID");
        if (!isAssistantMessageRole(messageRoles.roleOf(messageId))) return [];
        const partId = readString(props, "partID");
        const noted = noteTextPartDelta(textPartCursors, {
          delta,
          ...(partId !== undefined ? { partId } : {}),
          ...(messageId !== undefined ? { messageId } : {}),
        });
        if (!noted) return [];
        return [{ ...alloc(), kind: "token", delta }];
      }
      case "session.idle": {
        // The ONLY honest source of a `completed` terminal (a run finished).
        const terminal: TerminalEvent = { ...alloc(), kind: "terminal", state: "completed" };
        return [terminal];
      }
      case "session.error":
        return mapSessionError(frame);
      default:
        return [];
    }
  }

  function map(frame: unknown): readonly EvEvent[] {
    if (!isRawOpencodeEvent(frame)) {
      options.onUnmapped?.({ type: "<non-event>", properties: frame });
      return [];
    }
    const owner = frameSessionId(frame);
    // Terminal-producing frames MUST be positively attributed to this bound session
    // (MEDIUM-2). On the multiplexed `/event` stream an unresolvable (`undefined`) or
    // mismatched owner must NOT consume a seq or emit a terminal — otherwise a stray
    // `session.idle`/`session.error` would fabricate a `completed`/terminal for this
    // session. Attribution must be exact, not merely "not a different session".
    if (isTerminalProducingType(frame.type) && owner !== options.sessionId) {
      return [];
    }
    // Non-terminal frames: drop only on a positive mismatch (an unresolvable owner is
    // tolerated so activity events on a single-session stream still flow).
    if (owner && owner !== options.sessionId) return [];

    const events = dispatch(frame);
    // Track message roles from housekeeping frames before unmapped reporting.
    messageRoles.noteFrame(frame);
    // A frame that produced nothing is reported as unmapped ONLY when it is neither a
    // dispatched type nor a recognised-but-ignored housekeeping type. This keeps drift
    // detection meaningful: a genuinely NEW frame type still surfaces via onUnmapped.
    if (
      events.length === 0 &&
      !isDispatchedType(frame.type) &&
      !isKnownIgnoredType(frame.type)
    ) {
      options.onUnmapped?.(frame);
    }
    return events;
  }

  return { map, lastSeq: () => seq };
}

/** Frame types that can emit a terminal EV — require exact session attribution (MEDIUM-2). */
function isTerminalProducingType(type: string): boolean {
  return type === "session.idle" || type === "session.error";
}

/** Frame types the mapper's `switch` handles (used to decide unmapped reporting). */
function isDispatchedType(type: string): boolean {
  return (
    type === "todo.updated" ||
    type === "message.part.updated" ||
    type === "message.part.delta" ||
    type === "session.idle" ||
    type === "session.error"
  );
}

/**
 * Housekeeping frame types the pinned OpenCode multiplexes onto `/event` that carry NO EV
 * meaning for Cowork GHC — recognised, intentionally not surfaced. Confirmed against the
 * CGHC-024 live captures (simple-chat / tool-call / error / cancel, pin v1.17.11). Kept as
 * an EXACT set (not a prefix match) so a genuinely NEW frame type still surfaces via
 * `onUnmapped` (drift detection) instead of being silently swallowed.
 *
 * `file.edited` / `file.watcher.updated` are ignored ON PURPOSE: the authoritative EV4
 * file_mutation is emitted from the COMPLETED write/edit tool part (part-mapper), so mapping
 * the watcher signal too would double-count the same mutation.
 */
const KNOWN_IGNORED_TYPES: ReadonlySet<string> = new Set([
  "server.connected",
  "server.heartbeat",
  "session.updated",
  "session.status",
  "session.diff",
  "session.next.agent.switched",
  "session.next.model.switched",
  "message.updated",
  "plugin.added",
  "catalog.updated",
  "integration.updated",
  "reference.updated",
  "file.edited",
  "file.watcher.updated",
  "permission.asked",
  "permission.replied",
]);

/** True for a recognised housekeeping frame the mapper deliberately drops (not drift). */
function isKnownIgnoredType(type: string): boolean {
  return KNOWN_IGNORED_TYPES.has(type);
}

/** The recognised housekeeping vocabulary (review-visible; sourced from CGHC-024 captures). */
export const KNOWN_IGNORED_FRAME_TYPES: readonly string[] = Object.freeze([...KNOWN_IGNORED_TYPES]);

/** Terminal states the mapper can produce from real frames (review-visible manifest). */
export const TERMINAL_STATE_COVERAGE = ["completed", "errored", "cancelled"] as const;
