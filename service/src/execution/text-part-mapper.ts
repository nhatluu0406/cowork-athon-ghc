/**
 * Maps OpenCode `message.part.updated` text parts onto S2 token deltas.
 *
 * OpenCode may deliver assistant text only via committed `message.part.updated` frames
 * (no `message.part.delta`), especially after tool/permission turns. This module emits
 * incremental token deltas from growing text snapshots without double-counting prior deltas.
 */

import type { EvEvent } from "@cowork-ghc/contracts";
import { readString, type RawPart } from "./opencode-events.js";
import type { BaseAllocator } from "./part-mapper.js";

/** Per-part cursor of text already forwarded as token deltas. */
export type TextPartCursorMap = Map<string, string>;

function partKey(part: RawPart): string {
  return part.id ?? part.messageID ?? "text";
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
  const key = partKey(part);
  const prev = cursors.get(key) ?? "";
  if (full === prev) return [];
  if (!full.startsWith(prev) && prev.length > 0) {
    // Divergent snapshot — cannot append safely; rely on post-terminal fetch.
    return [];
  }
  const delta = full.slice(prev.length);
  if (delta.length === 0) return [];
  cursors.set(key, full);
  return [{ ...alloc(), kind: "token", delta }];
}
