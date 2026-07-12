/**
 * `@cowork-ghc/service` execution module — OpenCode SSE → EV mapping + EV state machine
 * (CGHC-012, ADR 0001 §3, S6/EV1–EV7).
 *
 * Local barrel. The top-level service barrel (`service/src/index.ts`) is owned by the
 * orchestrator; this module is imported directly (`../src/execution/index.js`) by tests
 * and mounted by downstream tasks:
 *  - CGHC-013 (session) consumes {@link createEvMapper} + {@link foldEv} to own the
 *    authoritative {@link SessionView} and derive `SessionStatus`.
 *  - CGHC-014 (two-hop SSE + resync) reuses one mapper per tracked session (resume via
 *    `startSeq`) and returns {@link SessionView} (`lastSeq`) from the resync endpoint;
 *    it may also replay captured wire text via {@link decodeSseChunk}.
 *  - CGHC-015 (timeline UI) renders {@link SessionView} (todos/steps/toolCalls/
 *    fileMutations/text/error/status) — never a fabricated `completed`.
 *  - CGHC-024 replays captured REAL OpenCode SSE frames through the same mapper (the
 *    frame-shape is pinned to the reference in {@link ./opencode-events}).
 */

export {
  isRawOpencodeEvent,
  frameSessionId,
  MAPPED_OPENCODE_EVENT_TYPES,
  type RawOpencodeEvent,
  type RawPart,
} from "./opencode-events.js";

export {
  splitSseFrames,
  decodeSseFrame,
  decodeSseChunk,
} from "./sse-decode.js";

export {
  createEvMapper,
  TERMINAL_STATE_COVERAGE,
  KNOWN_IGNORED_FRAME_TYPES,
  type EvMapper,
  type EvMapperOptions,
} from "./ev-mapper.js";

// Shared, browser-safe EV error sanitizer (single source of truth for the mapper AND the UI).
export {
  sanitizeErrorMessage,
  REDACTED,
  MAX_INPUT_LENGTH,
  MAX_OUTPUT_LENGTH,
} from "./error-sanitize.js";

export { mapTodos } from "./todo-mapper.js";
export { mapPart, isHandledPartType, type BaseAllocator } from "./part-mapper.js";

export {
  initialSessionView,
  reduceEv,
  foldEv,
  type SessionView,
  type ToolCallView,
  type StepView,
  type FileMutationView,
  type ErrorView,
  type ProgressView,
} from "./ev-reducer.js";

// CGHC-014 — hop 2 (coalescing/backpressure), resync, EV5 progress, and SSE framing.
export {
  createStreamCoordinator,
  realScheduler,
  type StreamCoordinator,
  type StreamCoordinatorOptions,
  type CoalesceScheduler,
  type CancelTimer,
} from "./stream-coordinator.js";

export { planResync, type ResyncResult } from "./session-resync.js";

export {
  createProgressTicker,
  type ProgressTicker,
  type ProgressTickerOptions,
} from "./progress-ticker.js";

export {
  createSessionStream,
  type SessionStream,
  type SessionStreamOptions,
} from "./session-stream.js";

export {
  encodeEvSseFrame,
  encodeSseHeartbeat,
  decodeEvSseFrame,
  decodeEvSseChunk,
  EV_SSE_EVENT_NAME,
} from "./ev-sse.js";
