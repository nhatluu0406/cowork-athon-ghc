/**
 * Tier 2 injection seams for the composition root (CGHC-028 / the OpenCode supervisor task).
 *
 * The Tier 1 composition wires every REAL in-process implementation that already exists. The
 * four boundaries that genuinely require a LIVE OpenCode child process are left here as
 * constructor-injection points with HONEST defaults — a default NEVER pretends a live run
 * succeeded:
 *
 *  - {@link RuntimeReplyPort}  — POSTs an Allow/Deny back to the running child. Default: a port
 *    that REJECTS every reply with a typed {@link RuntimeNotAttachedError} (a Deny is still
 *    recorded server-side by the gate before the outbound reply is attempted).
 *  - {@link RuntimeHealth}     — reports whether the supervised child is alive. Default:
 *    `isAlive()` returns `false` (honest "no runtime yet"), so session status is `runtime_down`.
 *  - {@link SessionStore}      — the OpenCode-store seam (create/list/replay). Default: every
 *    method throws {@link RuntimeNotAttachedError} — no fabricated sessions/transcripts.
 *  - {@link ProviderConnector} — the wire probe/cancel over the child. Default: `probe` returns
 *    an honest `{ ok: false, unavailable }` TestResult; `cancel` is a no-op.
 *
 * The live supervisor injects real implementations (with launch-time credential injection into
 * the child env via the credential service) once the child is up. Until then the service runs,
 * mounts every router, and enforces the boundary — it simply cannot reach a runtime.
 */

import type { PermissionReply, SessionId, TestResult } from "@cowork-ghc/contracts";
import type { BranchRunner, BranchRunResult } from "../dispatchers/index.js";
import type { RuntimeReplyPort } from "../permission/index.js";
import type { ProviderConnector, StreamHandle } from "../provider/index.js";
import type { WorkflowDraftGenerator } from "../tasks/index.js";
import type {
  CreateSessionInput,
  RuntimeHealth,
  SendPrompt,
  SessionStore,
  StoredSession,
} from "../session/index.js";

/** Typed failure raised by every Tier 2 default seam. Carries no secret and no live detail. */
export class RuntimeNotAttachedError extends Error {
  readonly code = "runtime_not_attached" as const;
  constructor(operation: string) {
    super(
      `OpenCode runtime is not attached; "${operation}" needs the live supervisor (CGHC-028).`,
    );
    this.name = "RuntimeNotAttachedError";
  }
}

/** Honest default {@link RuntimeHealth}: the supervised child is not alive until Tier 2 attaches. */
export function downRuntimeHealth(): RuntimeHealth {
  return { isAlive: () => false };
}

/**
 * Honest default {@link RuntimeReplyPort}: rejects every reply so a caller sees the transport is
 * unavailable. The permission gate records a Deny BEFORE it forwards, so a Deny still blocks even
 * when this reply cannot be delivered (the gate treats a failed deny reply as report-and-swallow,
 * so a successful server-side Deny never surfaces to the UI as a transport 500 — see FIX-3).
 *
 * FIX-6 (value-scrub invariant): when the live supervisor (CGHC-028) replaces THIS port + the
 * session-store seam, it MUST resolve any credential VALUE through `credentialService.resolveInjection`
 * (which registers the value with the shared scrubber) and MUST NOT read the OS keyring directly —
 * otherwise a short/unshaped custom-endpoint key could reach a `session.error` EV message before the
 * value-scrubber learns it, leaving only the shape sanitizer to catch it.
 */
export function notAttachedRuntimeReplyPort(): RuntimeReplyPort {
  return {
    reply(_reply: PermissionReply): Promise<void> {
      return Promise.reject(new RuntimeNotAttachedError("permission.reply"));
    },
  };
}

/**
 * Honest default {@link SessionStore}: no live OpenCode store, so every call REJECTS (no fakes).
 *
 * The live supervisor (CGHC-028) that replaces this seam MUST obtain any credential VALUE via
 * `credentialService.resolveInjection` (which registers the value with the shared scrubber) and
 * MUST NOT read the OS keyring directly — otherwise a short/unshaped custom-endpoint key could
 * reach a `session.error` EV message before the value-scrubber has learned it (only the shape
 * sanitizer would run). See FIX-6 / `notAttachedRuntimeReplyPort`.
 */
export function notAttachedSessionStore(): SessionStore {
  // Every method returns a REJECTED promise (LOW-1: uniform async seam contract) — a caller that
  // does `.catch` without `await` still observes a rejection rather than a synchronous throw.
  return {
    create: (_input: CreateSessionInput): Promise<StoredSession> =>
      Promise.reject(new RuntimeNotAttachedError("sessionStore.create")),
    list: (): Promise<readonly StoredSession[]> =>
      Promise.reject(new RuntimeNotAttachedError("sessionStore.list")),
    get: (_id: SessionId): Promise<StoredSession | undefined> =>
      Promise.reject(new RuntimeNotAttachedError("sessionStore.get")),
    rename: (_id: SessionId, _title: string): Promise<StoredSession> =>
      Promise.reject(new RuntimeNotAttachedError("sessionStore.rename")),
    replay: (_id: SessionId): Promise<readonly unknown[]> =>
      Promise.reject(new RuntimeNotAttachedError("sessionStore.replay")),
  };
}

/**
 * Honest default {@link SendPrompt}: no live child to POST a prompt to, so `send` REJECTS with the
 * typed {@link RuntimeNotAttachedError} (`code === "runtime_not_attached"`). The session router
 * duck-types that code and surfaces an honest 503 — it never fabricates a "prompt sent". The live
 * composition (CGHC-028) replaces this with the real OpenCode `POST /session/{id}/message`.
 */
export function notAttachedSendPrompt(): SendPrompt {
  return {
    send: (_sessionId: SessionId, _text: string): Promise<void> =>
      Promise.reject(new RuntimeNotAttachedError("session.sendPrompt")),
  };
}

/**
 * Honest default {@link BranchRunner} (dispatch fan-out, Task 5.2): with no live child a branch
 * can only report an honest error — the run registry shows the branch as `errored` with this
 * summary, never a fabricated completed.
 */
export function notAttachedBranchRunner(): BranchRunner {
  return async (): Promise<BranchRunResult> => ({
    status: "errored",
    summary: 'OpenCode runtime is not attached; dispatch branches need the live supervisor.',
  });
}

/**
 * Honest default {@link WorkflowDraftGenerator} (Task 4.3): no live LLM call is wired at Tier 1,
 * so a draft request REJECTS with the typed {@link RuntimeNotAttachedError} rather than fabricating
 * a TaskDefinition. `createWorkflowBuilder` surfaces this as an honest `{ ok: false, error }` — no
 * path ever reaches the task store from an unattached generator. Wiring a REAL generator (e.g. a
 * one-shot child-session prompt through the live supervisor) is a Tier 2 / CGHC-028 concern, same
 * as `sendPrompt`/`branchRunner` above.
 */
export function notAttachedWorkflowDraftGenerator(): WorkflowDraftGenerator {
  return (): Promise<never> => Promise.reject(new RuntimeNotAttachedError("tasks.draftFromPrompt"));
}

/** Honest default {@link ProviderConnector}: an unreachable probe (no runtime), no-op cancel. */
export function notAttachedConnector(): ProviderConnector {
  const unavailable: TestResult = {
    ok: false,
    error: {
      kind: "unavailable",
      message: "The local runtime is not attached yet.",
      retryable: false,
      recovery: "Start the runtime, then retry the connection test.",
    },
  };
  return {
    probe: (): Promise<TestResult> => Promise.resolve(unavailable),
    cancel: (_handle: StreamHandle): Promise<void> => Promise.resolve(),
  };
}
