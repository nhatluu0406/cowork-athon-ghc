/**
 * Ms365SessionScope: one source of truth for WHICH sessions may call MS365 tools (PO decision
 * 2026-07-14, P5.5 Task 5). Only a session registered by the Microsoft 365 tab may reach
 * `handleToolCall`; every other session is fail-closed. In-memory Set<sessionId>, NOT persisted
 * — sessions are ephemeral per app run, so there is nothing meaningful to restore on restart
 * (mirrors the small-factory style of `write-mode-store.ts`, but with no persistence dep since
 * there is nothing to persist).
 */
export interface Ms365SessionScope {
  allow(sessionId: string): void;
  revoke(sessionId: string): void;
  isAllowed(sessionId: string): boolean;
}

export function createMs365SessionScope(): Ms365SessionScope {
  const allowed = new Set<string>();
  return {
    allow(sessionId: string): void {
      allowed.add(sessionId);
    },
    revoke(sessionId: string): void {
      allowed.delete(sessionId);
    },
    isAllowed(sessionId: string): boolean {
      return allowed.has(sessionId);
    },
  };
}
