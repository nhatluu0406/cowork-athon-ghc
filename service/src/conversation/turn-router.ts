/**
 * Conversation-turn orchestrator (#21) — the SERVER-side "start a new turn on this conversation"
 * endpoint the remote/web PWA drives so a phone or a local browser can actually chat with Cowork.
 *
 * WHY THIS EXISTS: OpenCode sessions are single-turn. The desktop UI owns the full turn dance
 * (create session → link it to the conversation → append the user message → dispatch the prompt →
 * persist the assistant summary on terminal). A remote client has no way to run that dance — it can
 * only POST to an already-live session — so most conversations (no live session, or a terminal one)
 * left the remote composer disabled or returning 409. That is issue #21: "không thể send message
 * cho Cowork" from the web.
 *
 * WHAT THIS DOES: it performs the SAME dance the desktop does, on the service side, reusing the ONE
 * session mechanism (no fabricated runtime): create a session bound to the ACTIVE workspace, link it
 * to the conversation, persist the user message, dispatch the prompt, and — via a server-side
 * subscription to the live stream — persist the assistant summary + complete the runtime turn when
 * the session goes terminal. The EV response still streams to the client over the existing SSE route.
 *
 * HONESTY / BOUNDARY invariants:
 *  - The live OpenCode child is bound to ONE workspace (its launch cwd). A conversation for a
 *    DIFFERENT workspace cannot run here, so this returns an honest 409 `workspace_mismatch` rather
 *    than silently answering in the wrong workspace. Switching workspace stays a desktop action.
 *  - No prompt is "accepted" unless a real session was created and the prompt was dispatched — a
 *    runtime that is not attached/ready surfaces as 503, never a fake 202.
 *  - Persists user-visible messages + a durable turn summary only (never raw tokens), same as the
 *    desktop path.
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { ConversationStore } from "./store.js";
import type { RuntimeTurnRecord } from "./types.js";

export const CONVERSATION_TURN_PATH = "/v1/conversations/{id}/turn";

/** Same strict-UUID guard the conversation router uses: the store turns an id into a file path. */
const CONVERSATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Bound the prompt so a remote client cannot push an unbounded body through the turn path. */
const MAX_TURN_TEXT = 8000;

/** How long to keep the server-side terminal subscription before giving up (leak backstop). */
const TURN_PERSIST_TTL_MS = 15 * 60 * 1000;

export class ConversationTurnRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "ConversationTurnRequestError";
  }
}

/** Narrow session seam (a subset of {@link import("../session/index.js").SessionService}). */
export interface TurnSessionPort {
  create(input: { workspaceId: string; title?: string }): Promise<{ id: string }>;
  view(sessionId: string): { readonly terminal: string | null; readonly text: string } | undefined;
  bindStream(sessionId: string, handle: { id: string }): void;
}

/** The prompt-dispatch seam ({@link import("../session/router.js").SendPrompt}). */
export interface TurnPromptPort {
  send(sessionId: string, text: string): Promise<void>;
}

/** The live-stream subscribe seam ({@link import("../server/session-stream-hub.js").SessionEventSource}). */
export interface TurnStreamPort {
  subscribe(
    sessionId: string,
    listener: (event: { readonly kind: string }) => void,
  ): { close(): void } | undefined;
}

export interface ConversationTurnRouterOptions {
  readonly store: ConversationStore;
  readonly session: TurnSessionPort;
  readonly prompt: TurnPromptPort;
  readonly stream: TurnStreamPort;
  /** The workspace the live runtime is bound to (its launch cwd); `undefined` when none is open. */
  readonly activeWorkspaceRoot: () => string | undefined;
  readonly now?: () => string;
  /** Secret-free diagnostic sink for background persistence failures. */
  readonly log?: (line: string) => void;
  /** Injectable timer for the persistence leak-backstop (default global setTimeout). */
  readonly setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
  readonly clearTimer?: (handle: { unref?: () => void }) => void;
}

function requireId(params: Readonly<Record<string, string>>): string {
  const id = params["id"];
  if (id === undefined || id.length === 0) throw new ConversationTurnRequestError("id is required.");
  if (!CONVERSATION_ID_PATTERN.test(id)) {
    throw new ConversationTurnRequestError("id is not a valid conversation id.");
  }
  return id;
}

function parseText(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    throw new ConversationTurnRequestError("Body must be a JSON object.");
  }
  const text = (body as Record<string, unknown>)["text"];
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new ConversationTurnRequestError("text is required.");
  }
  if (text.length > MAX_TURN_TEXT) {
    throw new ConversationTurnRequestError("text is too long.");
  }
  return text;
}

/** Case/slash-insensitive path compare — the runtime cwd and the stored path may differ trivially. */
function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => p.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

function isRuntimeNotAttached(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "runtime_not_attached"
  );
}

function isRuntimeUnavailable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return (
    code === "opencode_http_error" ||
    code === "opencode_unreachable" ||
    code === "runtime_not_ready" ||
    code === "runtime_not_attached"
  );
}

/** Map a terminal state + accumulated view text to the durable assistant summary (non-empty). */
function assistantSummary(
  view: { readonly terminal: string | null; readonly text: string } | undefined,
  terminal: string,
): string {
  const t = (view?.text ?? "").trim();
  if (t.length > 0) return t;
  if (terminal === "denied") return "Yêu cầu đã bị từ chối.";
  if (terminal === "cancelled") return "Phiên đã bị hủy.";
  if (terminal === "completed") return "(Phiên hoàn tất nhưng không có nội dung phản hồi.)";
  return "Có lỗi xảy ra trong phiên.";
}

function turnStatusFor(terminal: string): RuntimeTurnRecord["status"] {
  if (terminal === "completed") return "completed";
  if (terminal === "cancelled" || terminal === "denied") return "cancelled";
  return "errored";
}

/**
 * Build the conversation-turn router. Wired by the LIVE composition (the session/prompt/stream
 * seams only exist there); Tier 1 does not mount it, so the desktop path is byte-for-byte unchanged.
 */
export function createConversationTurnRouter(
  options: ConversationTurnRouterOptions,
): BoundaryRouter {
  const { store, session, prompt, stream } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const log = options.log ?? (() => {});
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as unknown as NodeJS.Timeout));

  /**
   * Persist the assistant summary + complete the runtime turn once the session goes terminal.
   * Runs exactly once per turn (guarded), tears down the subscription + backstop timer, and never
   * throws into the request path — persistence failures are logged, not surfaced as a fake reply.
   *
   * Returns a `cancel()` the caller MUST invoke if the prompt never dispatched: otherwise the
   * 15-minute backstop timer would later fire `finalize` and inject a phantom "an error occurred"
   * assistant message long after the client already saw an honest 503 (review #21, finding 1).
   */
  function bindTerminalPersistence(
    conversationId: string,
    sessionId: string,
  ): { cancel(): void } {
    let done = false;
    let unsub: { close(): void } | undefined;
    let timer: { unref?: () => void } | undefined;

    const teardown = (): void => {
      unsub?.close();
      if (timer !== undefined) clearTimer(timer);
    };

    const finalize = (fallbackTerminal?: string): void => {
      if (done) return;
      done = true;
      teardown();
      const view = session.view(sessionId);
      const terminal = view?.terminal ?? fallbackTerminal ?? "completed";
      const text = assistantSummary(view, terminal);
      const status = turnStatusFor(terminal);
      void (async () => {
        try {
          await store.appendMessage(conversationId, { role: "assistant", text });
          // Only move the CONVERSATION status if this turn is still the active one — an overlapping
          // later turn may have re-bound `runtimeSessionId`, and a stale turn's terminal must not
          // clobber a live turn's "running" status (review #21, finding 2). The turn's own
          // `runtimeTurns` entry is always completed (it is keyed by this sessionId).
          const current = await store.get(conversationId);
          const stillActive = current?.runtimeSessionId === sessionId;
          await store.patch(conversationId, {
            ...(stillActive ? { status } : {}),
            completeRuntimeTurn: { runtimeSessionId: sessionId, completedAt: now(), status },
          });
        } catch (err) {
          log(
            `conversation-turn: persist failed for ${conversationId}: ${
              err instanceof Error ? err.message : "unknown"
            }`,
          );
        }
      })();
    };

    unsub = stream.subscribe(sessionId, () => {
      const view = session.view(sessionId);
      if (view !== undefined && view.terminal !== null) finalize();
    });
    // The run may already be terminal (or have no live stream) by the time we subscribe.
    const immediate = session.view(sessionId);
    if (unsub === undefined || (immediate !== undefined && immediate.terminal !== null)) {
      finalize();
      return { cancel: teardown };
    }
    timer = setTimer(() => finalize("errored"), TURN_PERSIST_TTL_MS);
    timer.unref?.();
    // cancel() marks done so a later backstop/terminal event is a no-op, and tears down resources.
    return {
      cancel: () => {
        done = true;
        teardown();
      },
    };
  }

  return {
    name: "conversation-turn",
    routes: [
      {
        method: "POST",
        path: CONVERSATION_TURN_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const conversationId = requireId(ctx.params);
          const text = parseText(ctx.body);

          const conversation = await store.get(conversationId);
          if (conversation === undefined) {
            return { status: 404, data: { accepted: false, error: "not_found" } };
          }

          const activeRoot = options.activeWorkspaceRoot();
          if (activeRoot === undefined || activeRoot.length === 0) {
            return {
              status: 503,
              data: {
                accepted: false,
                code: "no_active_workspace",
                message: "Chưa mở workspace nào trên desktop.",
              },
            };
          }
          if (!samePath(conversation.workspacePath, activeRoot)) {
            return {
              status: 409,
              data: {
                accepted: false,
                code: "workspace_mismatch",
                message:
                  "Hội thoại thuộc workspace khác — hãy mở đúng workspace trên desktop rồi thử lại.",
              },
            };
          }

          // Reject an overlapping turn (review #21, finding 2): if this conversation already has a
          // live (non-terminal) runtime session, starting another would clobber its status and race
          // its persistence. A completed/absent session's view is terminal/undefined → allowed.
          const priorSessionId = conversation.runtimeSessionId;
          if (priorSessionId !== null && session.view(priorSessionId)?.terminal === null) {
            return {
              status: 409,
              data: {
                accepted: false,
                code: "turn_in_progress",
                message: "Lượt trước đang chạy — đợi phản hồi xong rồi gửi tiếp.",
              },
            };
          }

          // Create a fresh single-turn session bound to the active workspace (the ONE mechanism).
          let sessionId: string;
          try {
            const meta = await session.create({ workspaceId: activeRoot, title: conversation.title });
            sessionId = meta.id;
          } catch (err) {
            if (isRuntimeNotAttached(err)) {
              return { status: 503, data: { accepted: false, code: "runtime_not_attached" } };
            }
            if (isRuntimeUnavailable(err)) {
              return { status: 503, data: { accepted: false, code: "runtime_unavailable" } };
            }
            throw err;
          }

          // Persist the user message + link the runtime turn BEFORE dispatch, so history is intact
          // even if the prompt dispatch fails.
          await store.appendMessage(conversationId, { role: "user", text });
          await store.patch(conversationId, {
            runtimeSessionId: sessionId,
            status: "running",
            registerRuntimeTurn: { runtimeSessionId: sessionId, startedAt: now(), status: "running" },
          });
          await store.setLastActiveId(conversationId);

          // Watch the live stream so the assistant reply is persisted server-side (the remote
          // client only observes the stream; nobody else drives persistence for this turn).
          const persistence = bindTerminalPersistence(conversationId, sessionId);
          // Bind a stream handle keyed by the session so a later cancel aborts the run at source.
          session.bindStream(sessionId, { id: sessionId });

          try {
            await prompt.send(sessionId, text);
          } catch (err) {
            // The prompt never dispatched: cancel the terminal watcher (no frames will ever arrive,
            // so its 15-min backstop would otherwise inject a phantom reply — review #21, finding 1)
            // and mark the turn errored honestly (the user message stays).
            persistence.cancel();
            await store
              .patch(conversationId, {
                status: "errored",
                completeRuntimeTurn: {
                  runtimeSessionId: sessionId,
                  completedAt: now(),
                  status: "errored",
                },
              })
              .catch(() => undefined);
            if (isRuntimeNotAttached(err)) {
              return { status: 503, data: { accepted: false, code: "runtime_not_attached", sessionId } };
            }
            if (isRuntimeUnavailable(err)) {
              return { status: 503, data: { accepted: false, code: "runtime_unavailable", sessionId } };
            }
            throw err;
          }

          return { status: 202, data: { accepted: true, sessionId, conversationId } };
        },
      },
    ],
  };
}
