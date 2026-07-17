/**
 * Maps OpenCode `message.part.updated` text parts onto S2 token deltas.
 *
 * OpenCode may deliver assistant text only via committed `message.part.updated` frames
 * (no `message.part.delta`), especially after tool/permission turns. This module emits
 * incremental token deltas from growing text snapshots without double-counting prior deltas.
 *
 * Cursor keys prefer stable part IDs. Message IDs are used only when a part ID is absent,
 * so delta+commit of the same part cannot double-append, while distinct parts on one
 * message remain independent.
 */

import type { EvEvent } from "@cowork-ghc/contracts";
import { readString, type RawPart } from "./opencode-events.js";
import type { BaseAllocator } from "./part-mapper.js";

/** Per-part cursor of text already forwarded as token deltas. */
export type TextPartCursorMap = Map<string, string>;

function cursorKeys(partId?: string, messageId?: string): readonly string[] {
  if (partId !== undefined && partId.length > 0) return [partId];
  if (messageId !== undefined && messageId.length > 0) return [messageId];
  return ["text"];
}

function keysForPart(part: RawPart): readonly string[] {
  return cursorKeys(part.id, part.messageID);
}

function longestCursor(cursors: TextPartCursorMap, keys: readonly string[]): string {
  let best = "";
  for (const key of keys) {
    const value = cursors.get(key) ?? "";
    if (value.length > best.length) best = value;
  }
  return best;
}

function writeCursor(cursors: TextPartCursorMap, keys: readonly string[], value: string): void {
  for (const key of keys) cursors.set(key, value);
}

/**
 * Record streamed delta text under stable part/message keys.
 * Returns false when the delta was empty (no EV emit).
 */
export function noteTextPartDelta(
  cursors: TextPartCursorMap,
  input: { readonly partId?: string; readonly messageId?: string; readonly delta: string },
): boolean {
  if (input.delta.length === 0) return false;
  const keys = cursorKeys(input.partId, input.messageId);
  const prev = longestCursor(cursors, keys);
  writeCursor(cursors, keys, prev + input.delta);
  return true;
}

/**
 * Emit token delta(s) for a text part snapshot. Returns `[]` when there is nothing new.
 */
export function mapTextPartSnapshot(
  part: RawPart,
  partRaw: Record<string, unknown>,
  alloc: BaseAllocator,
  cursors: TextPartCursorMap,
): readonly EvEvent[] {
  if (part.type !== "text") return [];
  const full = readString(partRaw, "text") ?? "";
  const keys = keysForPart(part);
  const prev = longestCursor(cursors, keys);
  if (full === prev) {
    writeCursor(cursors, keys, full);
    return [];
  }
  if (!full.startsWith(prev) && prev.length > 0) {
    // Divergent snapshot — cannot append safely; rely on post-terminal fetch.
    return [];
  }
  const delta = full.slice(prev.length);
  if (delta.length === 0) {
    writeCursor(cursors, keys, full);
    return [];
  }
  writeCursor(cursors, keys, full);
  return [{ ...alloc(), kind: "token", delta }];
}
