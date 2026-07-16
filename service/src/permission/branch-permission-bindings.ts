/**
 * `BranchPermissionBindings` — session→preset registry (D1 fix, ADR 0011 Open item "apply
 * `permissionPreset` per-branch at dispatch time").
 *
 * A dispatch branch's child session id is only known AFTER `createSession` (see
 * `dispatchers/live-branch-runner.ts`). This registry lets the live branch runner record that
 * session's {@link AgentDefinition.permissionPreset} BEFORE the first prompt is sent, and lets
 * `ToolPermissionProxy` (the ONE execution boundary every tool-permission event already flows
 * through) look it up to auto-deny a tool the agent's own preset forbids — without ever asking
 * the user (see `files/tool-permission-proxy.ts`).
 *
 * This is a narrow, in-memory, pure lookup — no I/O, no child/network/LLM dependency, so it is
 * trivially unit-testable and safe to construct once per service instance. It is NOT a second
 * permission authority: it only ever feeds a narrowing input into the ONE `PermissionGate`.
 *
 * A binding MUST be released when its branch reaches a terminal / is cancelled / errors (the live
 * branch runner does this in a `finally`), so a later session — even a numerically recycled id —
 * never inherits a stale preset (no leak across branches or into ordinary interactive sessions,
 * which are simply never bound here).
 */

import type { PermissionPreset } from "@cowork-ghc/contracts";

export interface BranchPermissionBindings {
  /** Register `preset` for `sessionId`. Overwrites any prior binding for the same id. */
  bind(sessionId: string, preset: PermissionPreset): void;
  /** Remove the binding (branch terminal/cancelled/errored). No-op if the id was never bound. */
  release(sessionId: string): void;
  /** The bound preset for `sessionId`, or `undefined` when this session is not a branch session. */
  presetFor(sessionId: string): PermissionPreset | undefined;
}

export function createBranchPermissionBindings(): BranchPermissionBindings {
  const bindings = new Map<string, PermissionPreset>();
  return {
    bind(sessionId, preset) {
      bindings.set(sessionId, preset);
    },
    release(sessionId) {
      bindings.delete(sessionId);
    },
    presetFor(sessionId) {
      return bindings.get(sessionId);
    },
  };
}
