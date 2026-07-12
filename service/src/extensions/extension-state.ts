/**
 * ExtensionState — the SINGLE source of truth for extension STATUS + DIAGNOSTICS (CGHC-026).
 *
 * One map keyed by `${kind}:${id}` holds every extension's {@link ExtensionStatus}
 * (enabled/disabled/failed); one ordered list holds every captured {@link ExtensionDiagnostic}.
 * The skill registry, MCP registry, and template registry ALL read/write this one store — there
 * is no parallel per-domain status map (architecture invariant: one source of truth per state
 * type). Template CONTENT lives in the separate TemplateStore (a different state type); STATUS
 * for all three kinds lives HERE.
 *
 * `fail` is the RE5 choke point: it marks an extension `failed` (quarantined) AND appends a
 * secret-free diagnostic, returning the diagnostic so the caller can hand it back as a typed
 * error instead of throwing.
 *
 * Un-quarantine is DELIBERATE, never accidental. Quarantine (`failed`) is sticky: `disable`
 * refuses to overwrite it. There is exactly ONE intended clear route per kind, and no other:
 *   - skill:    `SkillRegistry.clearQuarantine(id)` (resets `failed` → `disabled`).
 *   - mcp:      `McpRegistry.remove(id)` then re-`add(config)` (a fresh entry).
 *   - template: `TemplateRegistry.save(template)` again (re-register → `enabled`).
 * Keeping these single and explicit is what preserves the RE5 "quarantined, not retried"
 * invariant across the public API.
 */

import type { ExtensionDiagnostic, ExtensionKind, ExtensionStatus } from "./types.js";

/** A status record for one extension (name is carried for honest diagnostics/listing). */
export interface ExtensionRecord {
  readonly kind: ExtensionKind;
  readonly id: string;
  readonly name: string;
  readonly status: ExtensionStatus;
}

export interface ExtensionStateOptions {
  /** Injectable clock for diagnostic timestamps (deterministic tests). */
  readonly now?: () => string;
}

export interface ExtensionState {
  /** Register (or re-register) an extension with an initial status. */
  register(kind: ExtensionKind, id: string, name: string, status: ExtensionStatus): void;
  /** Update the status of a known extension; no-op if the id is unknown. */
  setStatus(kind: ExtensionKind, id: string, status: ExtensionStatus): void;
  /** The current status of an extension, or `undefined` if it is not registered. */
  status(kind: ExtensionKind, id: string): ExtensionStatus | undefined;
  /** The full record for an extension, or `undefined`. */
  get(kind: ExtensionKind, id: string): ExtensionRecord | undefined;
  /** True when the extension is quarantined (`failed`) — callers must skip it (RE5). */
  isQuarantined(kind: ExtensionKind, id: string): boolean;
  /** All status records (snapshot; one source of truth). */
  list(): readonly ExtensionRecord[];
  /**
   * RE5 choke point: mark the extension `failed` and append a secret-free diagnostic. The
   * `reason` MUST already be redacted by the caller (via {@link import("./isolation.js")}).
   * Returns the stored diagnostic so the caller can surface it as a typed error (no throw).
   */
  fail(kind: ExtensionKind, id: string, name: string, reason: string): ExtensionDiagnostic;
  /** All captured diagnostics, oldest first (snapshot). */
  diagnostics(): readonly ExtensionDiagnostic[];
  /** Remove an extension's status record entirely (e.g. MCP remove). Returns whether it existed. */
  remove(kind: ExtensionKind, id: string): boolean;
}

function key(kind: ExtensionKind, id: string): string {
  return `${kind}:${id}`;
}

export function createExtensionState(options: ExtensionStateOptions = {}): ExtensionState {
  const now = options.now ?? (() => new Date().toISOString());
  const records = new Map<string, ExtensionRecord>();
  const diagnostics: ExtensionDiagnostic[] = [];

  return {
    register(kind, id, name, status) {
      records.set(key(kind, id), { kind, id, name, status });
    },

    setStatus(kind, id, status) {
      const existing = records.get(key(kind, id));
      if (existing === undefined) return;
      records.set(key(kind, id), { ...existing, status });
    },

    status: (kind, id) => records.get(key(kind, id))?.status,
    get: (kind, id) => records.get(key(kind, id)),
    isQuarantined: (kind, id) => records.get(key(kind, id))?.status === "failed",
    list: () => [...records.values()],

    fail(kind, id, name, reason) {
      const diagnostic: ExtensionDiagnostic = { kind, name, reason, at: now() };
      diagnostics.push(diagnostic);
      // Mark quarantined. Register on the fly so a failure is never lost even if the extension
      // was never formally registered (honest: a failure always lands in the one source of truth).
      records.set(key(kind, id), { kind, id, name, status: "failed" });
      return diagnostic;
    },

    diagnostics: () => [...diagnostics],
    remove: (kind, id) => records.delete(key(kind, id)),
  };
}
