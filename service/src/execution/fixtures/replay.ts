/**
 * Replay captured RAW frames through the SAME pipeline the live two-hop path uses
 * (`createEvMapper` → `reduceEv`/`foldEv`). This is the load-bearing guarantee of PR10:
 * a fixture is validated against the REAL mapper contract, not a bespoke test double, so a
 * captured `session.idle` (and only that) yields `completed`, an error yields `errored`, and
 * a cancel yields `cancelled` — the "no fabricated completed" invariant (EV7) proven on real
 * bytes.
 *
 * `replayCapturedFrames` is pure over its input file and performs no I/O; the loader/gate
 * own file access. It records any unmapped frame so a capture that drifts from the pinned
 * frame shape surfaces loudly instead of being silently dropped.
 */

import type { EvEvent, SessionId } from "@cowork-ghc/contracts";
import { createEvMapper } from "../ev-mapper.js";
import { foldEv, type SessionView } from "../ev-reducer.js";
import type { RawOpencodeEvent } from "../opencode-events.js";
import type { CapturedFrameFile } from "./schema.js";

export interface ReplayResult {
  /** The authoritative folded view (status/terminal/text/tool calls/mutations). */
  readonly view: SessionView;
  /** Every EV event the mapper forwarded, in order. */
  readonly events: readonly EvEvent[];
  /** Raw frames the mapper did not recognise (should be empty for a clean capture). */
  readonly unmapped: readonly RawOpencodeEvent[];
}

/**
 * Feed a captured fixture's raw frames through the production mapper + reducer. The mapper
 * is bound to the fixture's real `sessionId`; a fixed clock keeps `EvBase.at` deterministic
 * for assertions. Frames the mapper cannot map are collected in `unmapped`.
 */
export function replayCapturedFrames(
  file: CapturedFrameFile,
  options?: { readonly now?: () => string },
): ReplayResult {
  const sessionId = file.meta.sessionId as SessionId;
  const unmapped: RawOpencodeEvent[] = [];
  const mapper = createEvMapper({
    sessionId,
    now: options?.now ?? (() => file.meta.capturedAt),
    onUnmapped: (frame) => unmapped.push(frame),
  });

  const events: EvEvent[] = [];
  for (const frame of file.frames) {
    events.push(...mapper.map(frame.raw));
  }
  const view = foldEv(sessionId, events);
  return { view, events, unmapped };
}
