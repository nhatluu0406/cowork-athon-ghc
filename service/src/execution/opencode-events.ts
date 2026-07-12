/**
 * Raw OpenCode `/event` SSE frame shapes — the EXTERNAL runtime contract (ADR 0001 §3).
 *
 * These mirror the REAL OpenCode wire events as observed in the read-only reference
 * source (`.loop-engineer/source/openwork/**`, never imported / never a build dep).
 * We treat this schema as untrusted and never let a raw frame leak past the mapper.
 *
 * Reference citations (read-only; frame-shape is pinned to these for CGHC-024 re-capture):
 *  - envelope `{ type, properties }` + the event-name set (`session.idle`, `session.error`,
 *    `todo.updated`, `message.part.updated`, `message.part.delta`, …):
 *    apps/app/src/react-app/domains/session/sync/session-sync.ts:591-905
 *  - tool part `{ type:"tool", id, sessionID, messageID, callID, tool, state:{ status,input,… } }`
 *    with `status ∈ pending|running|completed|error`:
 *    apps/app/tests/session-sync-tool-parts.test.ts:26-84
 *  - step parts `step-start` / `step-finish`: apps/app/src/app/utils/index.ts:1082-1089
 *  - delta `{ sessionID, messageID, partID, field, delta }`: session-sync.ts:859-885
 *  - `session.idle { sessionID }` (a run finished): session-sync.ts:887-904
 *  - `session.error` error names `MessageAbortedError` / `ProviderAuthError`:
 *    apps/app/src/react-app/domains/session/sync/usechat-adapter.ts:39-46
 */

/** The OpenCode SSE envelope. `properties` is validated per-`type` before use. */
export interface RawOpencodeEvent {
  readonly type: string;
  readonly properties?: unknown;
}

/** The event names this task maps onto the EV model (all others are unmapped). */
export const MAPPED_OPENCODE_EVENT_TYPES = [
  "todo.updated",
  "message.part.updated",
  "message.part.delta",
  "session.idle",
  "session.error",
] as const;

/** Structural guard: is this an OpenCode SSE envelope with a string `type`? */
export function isRawOpencodeEvent(value: unknown): value is RawOpencodeEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** Coerce an unknown into a readonly record without asserting a wider shape. */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** Read a string field, or `undefined` when absent / wrong type. */
export function readString(rec: Record<string, unknown>, key: string): string | undefined {
  const value = rec[key];
  return typeof value === "string" ? value : undefined;
}

/** Read an array field, or `[]` when absent / wrong type. */
export function readArray(rec: Record<string, unknown>, key: string): readonly unknown[] {
  const value = rec[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Extract the session id a frame is about, across the several places OpenCode puts it
 * (`properties.sessionID`, `properties.part.sessionID`, `properties.info.sessionID`).
 * Used to drop frames that belong to another session on the multiplexed `/event` stream.
 */
export function frameSessionId(frame: RawOpencodeEvent): string | undefined {
  const props = asRecord(frame.properties);
  const direct = readString(props, "sessionID");
  if (direct) return direct;
  const part = readString(asRecord(props.part), "sessionID");
  if (part) return part;
  return readString(asRecord(props.info), "sessionID");
}

/** A message part as seen on `message.part.updated` (`properties.part`). */
export interface RawPart {
  readonly type?: string;
  readonly id?: string;
  readonly sessionID?: string;
  readonly messageID?: string;
  readonly callID?: string;
  readonly tool?: string;
  readonly state?: RawToolState;
}

/** The `state` object on a tool part (`part.state`). */
export interface RawToolState {
  readonly status?: string;
  readonly input?: unknown;
  readonly error?: string;
  readonly title?: string;
}

/** Narrow `properties.part` from a `message.part.updated` frame. */
export function readPart(frame: RawOpencodeEvent): RawPart | undefined {
  const part = asRecord(frame.properties).part;
  return typeof part === "object" && part !== null ? (part as RawPart) : undefined;
}
