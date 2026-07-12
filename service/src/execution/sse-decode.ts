/**
 * Minimal SSE wire-frame decoder for OpenCode `/event` frames.
 *
 * The `@opencode-ai/sdk` event client (ADR 0001 §3) yields already-parsed
 * `{ type, properties }` objects, so the live two-hop path (CGHC-014) can feed the
 * mapper directly. This decoder exists so CGHC-024 can replay CAPTURED RAW SSE wire
 * text (the exact bytes off the socket) through the SAME mapper — the re-capture seam.
 * It parses only what the EventSource spec needs for our use: `data:` lines joined by
 * `\n`, terminated by a blank line, then `JSON.parse`d into a {@link RawOpencodeEvent}.
 *
 * It never throws on malformed input: a bad frame yields `null` (caller logs + drops),
 * so a corrupt stream can never fabricate an event.
 */

import { isRawOpencodeEvent, type RawOpencodeEvent } from "./opencode-events.js";

/** Split a raw SSE stream chunk into individual frame blocks (blank-line separated). */
export function splitSseFrames(raw: string): readonly string[] {
  return raw
    .replace(/\r\n/g, "\n")
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

/**
 * Decode one SSE frame block into a raw OpenCode event, or `null` when the block has no
 * `data:` payload or the payload is not a JSON object with a string `type`.
 */
export function decodeSseFrame(block: string): RawOpencodeEvent | null {
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) {
      // Per the SSE spec, a single leading space after the colon is stripped.
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n");
  try {
    const parsed: unknown = JSON.parse(payload);
    return isRawOpencodeEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Decode a full raw SSE chunk into every well-formed frame it contains. */
export function decodeSseChunk(raw: string): readonly RawOpencodeEvent[] {
  const out: RawOpencodeEvent[] = [];
  for (const block of splitSseFrames(raw)) {
    const frame = decodeSseFrame(block);
    if (frame) out.push(frame);
  }
  return out;
}
