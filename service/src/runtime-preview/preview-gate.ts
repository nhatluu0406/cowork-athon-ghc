/**
 * A dedicated PermissionGate for user-initiated preview launches.
 *
 * A preview `command_exec` is NOT an OpenCode tool call: no runtime is waiting on a reply and
 * no session must be driven terminal. So the reply/session ports are honest no-ops, while the
 * AUDIT sink is shared with the rest of the app (every launch Allow/Deny is recorded) and the
 * fail-closed timeout still applies. Enforcement is identical to any other gate: the launch
 * runs only inside {@link PermissionGate.proceed} after a recorded Allow.
 */

import { createPermissionGate, type PermissionGate } from "../permission/permission-gate.js";
import type { PermissionAuditSink, TimerScheduler } from "../permission/ports.js";

export interface PreviewGateOptions {
  readonly audit: PermissionAuditSink;
  readonly scheduler: TimerScheduler;
  readonly now: () => string;
  /** Decision window before a fail-closed auto-deny. */
  readonly timeoutMs?: number;
}

/** Two minutes is generous for a human to approve/deny a preview launch. */
const DEFAULT_TIMEOUT_MS = 120_000;

export function createPreviewGate(options: PreviewGateOptions): PermissionGate {
  return createPermissionGate({
    reply: { reply: async () => undefined },
    session: { denySession: () => undefined },
    audit: options.audit,
    scheduler: options.scheduler,
    now: options.now,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
}
