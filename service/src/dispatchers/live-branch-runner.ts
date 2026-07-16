/**
 * Live branch runner — the real {@link BranchRunner} the composition wires when a supervised
 * OpenCode child is attached. One branch = one REAL child session: create it, send the branch
 * prompt (the agent's system prompt is prepended — the child seam has no per-session system
 * slot), then wait for the session's authoritative view to reach a terminal state. Every
 * permission the branch triggers flows through the ONE existing gate (permission bridge on the
 * event pump); this runner adds no second permission path and never fabricates a terminal.
 *
 * All wire calls sit behind narrow injected seams so the unit suite runs with no child, no
 * network, and no LLM (the same discipline as the session service).
 *
 * D1 fix (ADR 0011 Open item): the branch's {@link BranchPlan.preset} is bound to the child
 * session id (via {@link LiveBranchRunnerSeams.bindPreset}) BEFORE `sendPrompt`, so every
 * tool-permission event this session raises can be checked against it at the ONE execution
 * boundary (`files/tool-permission-proxy.ts`). If binding itself fails, the branch fails
 * honestly (errored) and the prompt is NEVER sent — never running a branch with an unenforced
 * (wider) preset.
 *
 * D1 fix, follow-up finding 1 — RELEASE IS ASYMMETRIC WITH BIND, ON PURPOSE. A released binding
 * is fail-OPEN: `ToolPermissionProxy` stops auto-denying, so the NEXT tool-permission event for
 * that session id becomes an ordinary Allow/Deny ask (allow-able by a human, or a paired phone).
 * A binding that stays bound past its branch is, at worst, an inert bounded leak — the session is
 * presumably dead, and OpenCode always hands a NEW branch a NEW session id, never a reused one —
 * so a stale binding can never widen anything for anyone. Given that asymmetry, the ONLY point
 * this runner ever releases a binding is when it has GENUINE confirmation from the authoritative
 * session view that the session reached a real terminal via ORDINARY polling (never having asked
 * the child to stop). Concretely, the binding is deliberately RETAINED (never released) when:
 *  - the group is aborted/cancelled: requesting `cancelSession` proves nothing — it is
 *    best-effort, can fail, and even on success there is a window before the real child actually
 *    stops (the LOCAL session view's own "cancelled" terminal is synthesized by
 *    `session/task-registry.ts` independently of the real child, and does not stop
 *    `permissionBridge.handleFrame` from still forwarding a live `permission.asked` frame to the
 *    gate — see `composition/compose-live.ts`);
 *  - `sendPrompt` fails (the POST could have reached the child before the response was lost);
 *  - the session "disappears" mid-poll (`terminal()` returns `undefined` — unknown, not
 *    confirmed dead);
 *  - any other, unanticipated exception propagates out of this runner (there is deliberately no
 *    blanket `finally` — the safe DEFAULT is "do not release", not an exhaustive allow-list of
 *    exceptions that are assumed safe).
 * Only a real terminal object observed by the normal poll loop (never having gone through the
 * abort branch) is genuine proof the run is over, so only that path calls
 * {@link LiveBranchRunnerSeams.releasePreset}.
 */

import type { PermissionPreset } from "@cowork-ghc/contracts";
import type { BranchPlan, BranchRunner, BranchRunResult } from "./fanout.js";

/** The terminal slice of the authoritative session view this runner needs. */
export interface BranchTerminal {
  readonly state: string;
  readonly message?: string;
}

export interface LiveBranchRunnerSeams {
  /** Create a real child session; returns its id. */
  readonly createSession: (input: { readonly title: string }) => Promise<{ readonly id: string }>;
  /** POST the prompt to the child session (the live SendPrompt seam). */
  readonly sendPrompt: (sessionId: string, text: string) => Promise<void>;
  /**
   * The session's terminal from the authoritative view: `undefined` = session unknown,
   * `null` = still running, object = terminal reached.
   */
  readonly terminal: (sessionId: string) => BranchTerminal | null | undefined;
  /** Cancel the child session (S3 path) — used when the group is aborted. */
  readonly cancelSession: (sessionId: string) => Promise<void>;
  /**
   * D1 fix: bind the branch's {@link BranchPlan.preset} to the just-created session id, called
   * BEFORE `sendPrompt`. Required (not optional) so a live composition can never wire this
   * runner without also wiring enforcement — a missing/failing bind fails the branch honestly
   * rather than silently running it unbound (fail closed, never fail open).
   */
  readonly bindPreset: (sessionId: string, preset: PermissionPreset) => void;
  /**
   * D1 fix: release the binding registered by {@link bindPreset}. Called ONLY when this runner
   * has genuine confirmation (a real terminal observed via ordinary polling) that the session is
   * done — deliberately NOT on every exit path. See the module doc ("RELEASE IS ASYMMETRIC WITH
   * BIND") for why an uncertain case (abort/cancel, a send failure, a disappeared session) must
   * retain the binding rather than release it: a stale binding is an inert leak, but an
   * early-released one is fail-open.
   */
  readonly releasePreset: (sessionId: string) => void;
  /**
   * Optional: workspace-relative paths the session's authoritative view recorded as mutated
   * (real EV `file_mutation` events, not an LLM claim). Read ONLY on a completed terminal and
   * attached to the {@link BranchRunResult} as the run's declared evidence for the
   * `retry_until_verified` disk-evidence hook. Absent/empty = no evidence claimed.
   */
  readonly fileMutationPaths?: (sessionId: string) => readonly string[];
  /** Poll interval while waiting for the terminal. Default 500ms. */
  readonly pollIntervalMs?: number;
}

/** The prompt actually sent: agent persona first, then the task goal. Secret-free by contract. */
export function composeBranchPrompt(plan: BranchPlan): string {
  return `[Agent: ${plan.agentName}]\n${plan.systemPrompt}\n\n---\n\n${plan.prompt}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

export function createLiveBranchRunner(seams: LiveBranchRunnerSeams): BranchRunner {
  const interval = seams.pollIntervalMs ?? 500;

  return async (plan, signal): Promise<BranchRunResult> => {
    if (signal.aborted) return { status: "errored", summary: "Branch aborted before start." };

    let sessionId: string;
    try {
      const created = await seams.createSession({ title: `Dispatch ${plan.branchId}: ${plan.agentName}` });
      sessionId = created.id;
    } catch (err) {
      return { status: "errored", summary: err instanceof Error ? err.message : "Session create failed." };
    }

    // D1 fix: bind BEFORE any prompt reaches the session. A bind failure fails the branch
    // honestly — the prompt is never sent with an unenforced (wider) preset (fail closed).
    try {
      seams.bindPreset(sessionId, plan.preset);
    } catch (err) {
      return {
        status: "errored",
        summary: `Preset binding failed for session ${sessionId}: ${err instanceof Error ? err.message : "unknown error"}.`,
      };
    }

    // D1 fix, follow-up finding 1: release is the callee's responsibility, called ONLY at the
    // one point genuine confirmation exists (see `runBoundSession`). Deliberately NO blanket
    // `finally` here — an unanticipated exception must also retain the binding, not release it;
    // "do not release" is the DEFAULT, not an exhaustive list of exceptions assumed safe.
    return runBoundSession(seams, plan, sessionId, signal, interval);
  };
}

/** The bound-session lifecycle: send the prompt, then wait for the authoritative terminal. */
async function runBoundSession(
  seams: LiveBranchRunnerSeams,
  plan: BranchPlan,
  sessionId: string,
  signal: AbortSignal,
  interval: number,
): Promise<BranchRunResult> {
  try {
    await seams.sendPrompt(sessionId, composeBranchPrompt(plan));
  } catch (err) {
    // D1 fix, finding 1: a send failure is NOT proof the child never received the turn (the POST
    // could have reached it before the response was lost) — retain the binding.
    return { status: "errored", summary: err instanceof Error ? err.message : "Prompt dispatch failed." };
  }

  // Wait for the AUTHORITATIVE terminal. The loop guardrails (maxDurationMs) own the overall
  // time budget and abort this signal — the runner itself imposes no second timeout.
  for (;;) {
    if (signal.aborted) {
      // D1 fix, finding 1: best-effort child cancel — its outcome is NEVER used to decide
      // whether to release. Success only means the request was accepted, not that the real
      // child actually stopped (see module doc); a failure must not be silently read as "the
      // child is gone" either. The binding stays RETAINED on this path, always.
      const cancelled = await seams
        .cancelSession(sessionId)
        .then(() => true)
        .catch(() => false);
      return {
        status: "errored",
        summary: cancelled
          ? `Branch cancelled (session ${sessionId}); preset binding retained (child stop unconfirmed).`
          : `Branch cancelled (session ${sessionId}); cancel request FAILED — preset binding retained.`,
      };
    }
    const terminal = seams.terminal(sessionId);
    if (terminal === undefined) {
      // D1 fix, finding 1: "disappeared" is unknown, not confirmed dead — retain the binding.
      return { status: "errored", summary: `Session ${sessionId} disappeared before a terminal.` };
    }
    if (terminal !== null) {
      // The ONLY release point: a REAL terminal observed by ORDINARY polling — this branch was
      // never aborted — is genuine confirmation the session is done.
      seams.releasePreset(sessionId);
      if (terminal.state !== "completed") {
        return { status: "errored", summary: `Session ${sessionId} ended: ${terminal.state}.` };
      }
      const mutated = seams.fileMutationPaths?.(sessionId) ?? [];
      return {
        status: "completed",
        summary: `Session ${sessionId} completed.`,
        ...(mutated.length > 0 ? { mutatedPaths: mutated } : {}),
      };
    }
    await sleep(interval, signal);
  }
}
