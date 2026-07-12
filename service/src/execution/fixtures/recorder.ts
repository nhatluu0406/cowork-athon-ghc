/**
 * Provider-neutral RECORDER core for CGHC-024 captures. Decodes a live OpenCode SSE byte
 * stream (raw `data:` frames) into validated {@link CapturedFrame}s and packs them with a
 * header into a {@link CapturedFrameFile}. The live HTTP transport + credential resolution
 * live in `tools/capture-frames/` (opt-in); this core is pure over its inputs so it is
 * type-checked and unit-testable WITHOUT any network.
 *
 * It reuses the SAME `decodeSseChunk` the live replay/decode path uses, so what is recorded
 * is exactly what the mapper will later consume — no re-shaping, no fabrication. Frames for
 * other sessions on the multiplexed `/event` stream are filtered out when a `sessionFilter`
 * is given.
 */

import { decodeSseChunk } from "../sse-decode.js";
import { frameSessionId, type RawOpencodeEvent } from "../opencode-events.js";
import {
  CAPTURE_FRAME_KIND,
  CAPTURE_META_KIND,
  type CapturedFrame,
  type CapturedFrameFile,
  type CapturedMeta,
} from "./schema.js";

export interface RecordFramesInput {
  /** Header fields for the fixture (scenario, pin, sessionId, prompt, timestamps). */
  readonly meta: Omit<CapturedMeta, "kind">;
  /** The live SSE stream as async text chunks (each may hold 0..N frame blocks). */
  readonly chunks: AsyncIterable<string>;
  /** When set, keep only frames whose resolved owner is this session (or unresolved). */
  readonly sessionFilter?: string;
  /** Clock for per-frame `recordedAt` (injectable for deterministic tests). */
  readonly now?: () => string;
  /** Stop after this many frames (safety bound so a capture cannot run unbounded). */
  readonly maxFrames?: number;
}

/** Keep a frame when there is no filter, or its owner is the filtered session (or unknown). */
function keepFrame(frame: RawOpencodeEvent, sessionFilter: string | undefined): boolean {
  if (sessionFilter === undefined) return true;
  const owner = frameSessionId(frame);
  return owner === undefined || owner === sessionFilter;
}

/**
 * Consume the SSE stream and build a {@link CapturedFrameFile}. Resolves when the stream
 * ends or `maxFrames` is reached. Never fabricates: a chunk that decodes to zero frames
 * simply contributes nothing.
 */
export async function recordFrames(input: RecordFramesInput): Promise<CapturedFrameFile> {
  const clock = input.now ?? (() => new Date().toISOString());
  const max = input.maxFrames ?? 5000;
  const frames: CapturedFrame[] = [];

  for await (const chunk of input.chunks) {
    for (const raw of decodeSseChunk(chunk)) {
      if (!keepFrame(raw, input.sessionFilter)) continue;
      frames.push({ kind: CAPTURE_FRAME_KIND, raw, recordedAt: clock() });
      if (frames.length >= max) {
        return { meta: { kind: CAPTURE_META_KIND, ...input.meta }, frames };
      }
    }
  }
  return { meta: { kind: CAPTURE_META_KIND, ...input.meta }, frames };
}
