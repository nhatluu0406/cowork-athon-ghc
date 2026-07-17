/**
 * ms-chat-controller — MS365 tab chat state machine (P5.6).
 *
 * Pure state/logic controller: no DOM, no direct service-client import. Everything the
 * controller needs (preflight, workspace id, session lifecycle, session-scope grant/revoke,
 * message send, streaming, dispatch-prompt building, and the render hook) comes in through
 * the injected `MsChatDeps` seams so the state machine is unit-testable without a network.
 *
 * Ordering invariant per `send`: createSession -> setSessionScope(id, true) -> startStream(id)
 * -> sendMessage(id, dispatchText). Session-scope is registered BEFORE the prompt is
 * dispatched because the first MS365 tool call can arrive as soon as the runtime starts
 * planning — the allowlist must already be open (P5.5 gating).
 *
 * Scope is always revoked on every terminal path (stream terminal view, cancel, reset with a
 * live session, and onDisconnected) so the MS365 tool allowlist never leaks a session past its
 * turn. Revoke failures (e.g. a network blip while shutting down) are deliberately swallowed —
 * they must never surface as an unhandled rejection or block the stream from stopping.
 *
 * Single-settlement per turn: the stream's terminal view and a not-accepted `sendMessage`
 * result are two independent async sources racing to conclude the same turn. Each turn gets a
 * token; whichever source settles first "wins" (records the outcome, revokes once) and the
 * other becomes a no-op. This also covers the gap while `send` awaits `createSession` — if
 * `cancel()` is called before a session exists, it only sets a flag; `send` checks that flag as
 * soon as it resumes and settles the turn as cancelled before ever granting scope or sending.
 */

export interface MsChatMessage {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  error?: string;
}

export interface MsChatState {
  readonly messages: readonly MsChatMessage[];
  readonly phase: "idle" | "running" | "error";
  readonly sessionId: string | null;
  readonly errorMessage: string | null;
}

export interface MsChatDeps {
  /** Wraps `assessSendPreflight` from app-shell (service ready + workspace + provider). */
  preflight(): { canSend: boolean; message: string };
  workspaceId(): string | null;
  createSession(input: { workspaceId: string; title: string }): Promise<{ id: string }>;
  setSessionScope(sessionId: string, enabled: boolean): Promise<void>;
  sendMessage(sessionId: string, text: string): Promise<{ accepted: boolean; reason?: string }>;
  cancelSession(sessionId: string): Promise<void>;
  startStream(
    sessionId: string,
    onView: (view: { text: string; terminal: string | null }) => void,
  ): { stop(): void };
  /** Wraps `planDispatchPrompt(prior, [], prompt, undefined, [], true)` — budget/fail-fast seam. */
  buildDispatch(
    prior: readonly MsChatMessage[],
    prompt: string,
  ): { ok: true; text: string } | { ok: false; message: string };
  /** View re-render hook — called once per state mutation. */
  onStateChange(state: MsChatState): void;
}

export interface MsChatController {
  state(): MsChatState;
  send(prompt: string): Promise<void>;
  cancel(): Promise<void>;
  /** revoke + clear transcript */
  reset(): Promise<void>;
  /** revoke + stop stream, keeps transcript, phase idle */
  onDisconnected(): Promise<void>;
}

const MSG_SEND_REJECTED_RUNNING = "Đang xử lý lượt trước — vui lòng đợi rồi thử lại.";
const MSG_TURN_CANCELLED = "Đã hủy lượt này.";
const MSG_SEND_NOT_ACCEPTED_FALLBACK = "Không thể gửi tin nhắn tới phiên MS365.";
const MSG_TURN_FAILED_FALLBACK = "Có lỗi xảy ra khi xử lý phiên MS365 — vui lòng thử lại.";

export function createMsChatController(deps: MsChatDeps): MsChatController {
  let state: MsChatState = {
    messages: [],
    phase: "idle",
    sessionId: null,
    errorMessage: null,
  };

  // Handle of the currently-live stream, if any — used by cancel/terminal/reset/disconnect
  // to guarantee the stream is always stopped before/while the scope is revoked.
  let activeStream: { stop(): void } | null = null;
  // The assistant message index being streamed into, for the currently-live session.
  let activeAssistantIndex: number | null = null;

  // Per-turn settlement guard. Each call to `send` mints a new token; the turn is "settled"
  // exactly once, by whichever of {stream terminal view, sendMessage-not-accepted, cancel}
  // reaches the check first. Also doubles as the "cancel requested before session exists" flag
  // for the createSession gap (see module doc).
  let turnToken = 0;
  let settledToken = 0;
  let cancelRequestedToken = 0;

  function isSettled(token: number): boolean {
    return settledToken >= token;
  }

  /** Claims settlement for `token`. Returns true if this caller won the race. */
  function claimSettlement(token: number): boolean {
    if (isSettled(token)) return false;
    settledToken = token;
    return true;
  }

  /** Stops whatever stream handle exists right now — safe whether or not it has been assigned yet. */
  function stopCurrent(): void {
    stopStream();
  }

  function setState(next: MsChatState): void {
    state = next;
    deps.onStateChange(state);
  }

  function patch(partial: Partial<MsChatState>): void {
    setState({ ...state, ...partial });
  }

  function replaceMessage(index: number, message: MsChatMessage): void {
    const messages = state.messages.slice();
    messages[index] = message;
    patch({ messages });
  }

  async function revokeScope(sessionId: string): Promise<void> {
    try {
      await deps.setSessionScope(sessionId, false);
    } catch {
      // Deliberately swallowed: revoke is best-effort cleanup. A network failure here must
      // never block the stream from stopping or surface as an unhandled rejection — the
      // session is single-turn and short-lived regardless of whether revoke succeeded.
    }
  }

  function stopStream(): void {
    if (activeStream) {
      activeStream.stop();
      activeStream = null;
    }
    activeAssistantIndex = null;
  }

  async function send(prompt: string): Promise<void> {
    if (state.phase === "running") {
      patch({ errorMessage: MSG_SEND_REJECTED_RUNNING });
      return;
    }

    const preflight = deps.preflight();
    if (!preflight.canSend) {
      setState({ ...state, phase: "error", errorMessage: preflight.message });
      return;
    }

    const dispatch = deps.buildDispatch(state.messages, prompt);
    if (!dispatch.ok) {
      setState({ ...state, phase: "error", errorMessage: dispatch.message });
      return;
    }

    const workspaceId = deps.workspaceId();
    if (!workspaceId) {
      setState({
        ...state,
        phase: "error",
        errorMessage: "Chưa chọn workspace — không thể bắt đầu phiên MS365.",
      });
      return;
    }

    const userMessage: MsChatMessage = { role: "user", content: prompt };
    const assistantMessage: MsChatMessage = { role: "assistant", content: "", pending: true };
    const messages = [...state.messages, userMessage, assistantMessage];
    const assistantIndex = messages.length - 1;
    setState({ messages, phase: "running", sessionId: null, errorMessage: null });

    const token = ++turnToken;

    async function settleWithError(sessionId: string | null, message: string): Promise<void> {
      if (!claimSettlement(token)) return;
      stopCurrent();
      if (sessionId) await revokeScope(sessionId);
      replaceMessage(assistantIndex, {
        ...assistantMessage,
        pending: false,
        error: message,
      });
      patch({ phase: "error", errorMessage: message });
    }

    async function settleCancelled(sessionId: string | null): Promise<void> {
      if (!claimSettlement(token)) return;
      stopCurrent();
      if (sessionId) await revokeScope(sessionId);
      replaceMessage(assistantIndex, {
        ...assistantMessage,
        pending: false,
        error: MSG_TURN_CANCELLED,
      });
      patch({ phase: "idle" });
    }

    let session: { id: string };
    try {
      session = await deps.createSession({ workspaceId, title: "Microsoft 365" });
    } catch (err) {
      await settleWithError(null, describeError(err));
      return;
    }

    // reset()/onDisconnected() may have claimed this turn while createSession was in flight.
    // Scope was never granted, so there is nothing to revoke — just abandon the orphan session.
    if (isSettled(token)) {
      return;
    }

    // cancel() may have run while createSession was in flight — session.id did not exist yet,
    // so cancel() could only record the request. Honor it now, before scope is ever granted —
    // there is nothing to revoke yet, so pass null (revoke-if-granted).
    if (cancelRequestedToken === token) {
      await settleCancelled(null);
      return;
    }

    setState({ ...state, sessionId: session.id });

    try {
      await deps.setSessionScope(session.id, true);

      // reset()/onDisconnected() may have claimed this turn while the grant was in flight —
      // their revoke may have raced (and lost against) our grant, so revoke again here to
      // guarantee the allowlist never keeps a session past its torn-down turn.
      if (isSettled(token)) {
        await revokeScope(session.id);
        return;
      }

      if (cancelRequestedToken === token) {
        await settleCancelled(session.id);
        return;
      }

      activeAssistantIndex = assistantIndex;
      const handle = deps.startStream(session.id, (view) => {
        // Late views from a session that is no longer the active one (e.g. after reset/cancel)
        // must not resurrect stale state.
        if (state.sessionId !== session.id) return;
        onStreamView(token, session.id, assistantIndex, view);
      });
      // startStream's onView can fire synchronously (before the return value is assigned) and
      // settle the turn — e.g. an immediate terminal view. If that happened, `activeStream` was
      // never set to this handle, so `stopCurrent()` inside that settlement couldn't stop it.
      // Stop it now rather than leaking the underlying stream resource.
      if (isSettled(token)) {
        handle.stop();
      } else {
        activeStream = handle;
      }

      const result = await deps.sendMessage(session.id, dispatch.text);
      if (!result.accepted) {
        await settleWithError(session.id, result.reason ?? MSG_SEND_NOT_ACCEPTED_FALLBACK);
      }
    } catch (err) {
      await settleWithError(session.id, describeError(err));
    }
  }

  function describeError(err: unknown): string {
    // Diagnostics: the raw error goes to the console only (DevTools) — never into the bubble.
    // eslint-disable-next-line no-console
    console.error("[ms365-chat] turn failed:", err);
    // Adapter/service-client errors carry curated, user-safe messages (our own Vietnamese copy
    // or loopback HTTP status text — no token, no stack). Surface them bounded so a failure is
    // diagnosable from the UI; anything shapeless falls back to the generic copy.
    if (err instanceof Error && err.message.length > 0 && err.message.length <= 300) {
      return `${MSG_TURN_FAILED_FALLBACK} (${err.message})`;
    }
    return MSG_TURN_FAILED_FALLBACK;
  }

  function onStreamView(
    token: number,
    sessionId: string,
    assistantIndex: number,
    view: { text: string; terminal: string | null },
  ): void {
    if (isSettled(token)) return; // this turn was already settled by another path

    replaceMessage(assistantIndex, {
      role: "assistant",
      content: view.text,
      pending: view.terminal === null,
    });

    if (view.terminal !== null) {
      if (!claimSettlement(token)) return;
      stopCurrent();
      void revokeScope(sessionId).then(() => {
        patch({ phase: "idle" });
      });
    }
  }

  async function cancel(): Promise<void> {
    const token = turnToken;
    const sessionId = state.sessionId;

    if (!sessionId) {
      // send() is between createSession-call-site and session existing (the awaited gap), or
      // there is no in-flight turn at all. Recording the token is a no-op in the latter case
      // (send() checks cancelRequestedToken === its own token, and token 0 never matches).
      if (token > 0) cancelRequestedToken = token;
      return;
    }

    if (!claimSettlement(token)) return; // already settled by terminal view or not-accepted

    const assistantIndex = activeAssistantIndex;
    stopCurrent();
    try {
      await deps.cancelSession(sessionId);
    } catch {
      // Best-effort: still revoke + settle UI honestly even if the cancel call itself failed.
    }
    await revokeScope(sessionId);

    if (assistantIndex !== null && state.messages[assistantIndex]) {
      const current = state.messages[assistantIndex];
      replaceMessage(assistantIndex, { ...current, pending: false, error: MSG_TURN_CANCELLED });
    }
    patch({ phase: "idle" });
  }

  async function reset(): Promise<void> {
    const sessionId = state.sessionId;
    const token = turnToken;
    const shouldRevoke = sessionId !== null && (token === 0 || claimSettlement(token));
    stopStream();
    if (shouldRevoke && sessionId) {
      await revokeScope(sessionId);
    }
    setState({ messages: [], phase: "idle", sessionId: null, errorMessage: null });
  }

  async function onDisconnected(): Promise<void> {
    const sessionId = state.sessionId;
    const token = turnToken;
    const shouldRevoke = sessionId !== null && (token === 0 || claimSettlement(token));
    stopStream();
    if (shouldRevoke && sessionId) {
      await revokeScope(sessionId);
    }
    patch({ phase: "idle" });
  }

  return {
    state: () => state,
    send,
    cancel,
    reset,
    onDisconnected,
  };
}
