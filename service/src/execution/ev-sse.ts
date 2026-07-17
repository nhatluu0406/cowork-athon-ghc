/**
 * Hop-2 SSE wire framing for EV events (CGHC-014).
 *
 * The renderer-facing transport serializes each {@link EvEvent} as one Server-Sent-Events
 * frame using the SAME conventions the hop-1 decoder ({@link ./sse-decode}) parses: a
 * `data:`-prefixed JSON line terminated by a blank line, plus an `event:` type line so a
 * browser `EventSource` can dispatch by name. Kept transport-agnostic here (pure string in/
 * out) so the coordinator core stays socket-free and a thin endpoint just writes these bytes.
 *
 * `decodeEvSseChunk` is the symmetric reader (used by tests / a renderer client): it never
 * throws on malformed input — a bad frame is dropped, so a corrupt stream cannot fabricate
 * an EV event (mirrors the hop-1 decoder's fail-safe posture).
 */

import type { EvEvent, EvEventKind } from "@cowork-ghc/contracts";

/** SSE `event:` name carried on every EV frame (a stable channel name for the renderer). */
export const EV_SSE_EVENT_NAME = "ev";

/** Serialize one EV event as a single SSE frame (`event:`/`data:` + blank-line terminator). */
export function encodeEvSseFrame(event: EvEvent): string {
  return `event: ${EV_SSE_EVENT_NAME}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** An SSE comment line — a heartbeat that keeps the socket alive without an EV payload. */
export function encodeSseHeartbeat(): string {
  return `: keep-alive\n\n`;
}

const EV_KINDS: ReadonlySet<string> = new Set<EvEventKind>([
  "plan",
  "step",
  "tool_call",
  "file_mutation",
  "token",
  "progress",
  "metrics",
  "error",
  "terminal",
]);

/** Terminal states the reducer accepts; a `terminal` frame missing a valid one is corrupt. */
const TERMINAL_STATES: ReadonlySet<string> = new Set([
  "completed",
  "errored",
  "cancelled",
  "denied",
]);

/**
 * Structural guard: a decoded payload has the base EV shape (`kind` + numeric `seq` +
 * `sessionId`) AND the required fields the reducer relies on for the state-bearing kinds.
 * Validating those fields is what makes the "a corrupt stream cannot fabricate an EV event"
 * guarantee true: e.g. a `terminal` with no valid `state` would otherwise fold to a bogus
 * terminal status (review LOW). Non-state kinds stay structural (a missing field there cannot
 * fabricate a terminal/status).
 */
function isEvEvent(value: unknown): value is EvEvent {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record["kind"] !== "string" || !EV_KINDS.has(record["kind"])) return false;
  if (typeof record["seq"] !== "number" || typeof record["sessionId"] !== "string") return false;
  switch (record["kind"]) {
    case "terminal":
      return typeof record["state"] === "string" && TERMINAL_STATES.has(record["state"]);
    case "token":
      return typeof record["delta"] === "string";
    case "error":
      return typeof record["message"] === "string";
    default:
      return true;
  }
}

/** Decode one SSE frame block into an EV event, or `null` when it has no valid EV payload. */
export function decodeEvSseFrame(block: string): EvEvent | null {
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(dataLines.join("\n"));
    return isEvEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Decode a raw SSE chunk into every well-formed EV event it contains (bad frames dropped). */
export function decodeEvSseChunk(raw: string): readonly EvEvent[] {
  const out: EvEvent[] = [];
  for (const block of raw.replace(/\r\n/g, "\n").split(/\n\n+/)) {
    const trimmed = block.trim();
    if (trimmed.length === 0) continue;
    const event = decodeEvSseFrame(trimmed);
    if (event) out.push(event);
  }
  return out;
}
