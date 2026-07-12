/**
 * Model config + switch service (CGHC-019, PR4/PR5/PR6/P5).
 *
 * A thin coordinator over the existing {@link ProviderPort} selection store — it does NOT
 * add a second store. It owns exactly the four CGHC-019 concerns:
 *
 *  - PR4 precedence: {@link ModelConfigService.activeModelFor} resolves the EFFECTIVE model
 *    for a session. A per-session override GOVERNS that session; absent an override the
 *    DEFAULT governs. One source of truth: it reads the port's in-memory selection map.
 *  - PR5 switch-without-restart: selections live in the port's in-memory map and are read at
 *    request time, so a change takes effect for the NEXT request with no process restart.
 *    {@link ModelConfigService.activeModel} is the read the UI uses to CONFIRM the active
 *    provider/model after a switch (non-secret display labels included).
 *  - PR6 health (SHOULD): {@link ModelConfigService.checkHealth} surfaces a provider
 *    reachability signal via the injected connector (CGHC-011 `testConnection`). It NEVER
 *    blocks a switch — it is a separate, read-only query.
 *  - P5 audit: every default/session model change records a secret-free
 *    {@link ModelChangeAuditEvent} (old → new, scope, sessionId?, timestamp) to an injectable
 *    {@link ModelAuditSink}. No key, no `CredentialRef`, no base_url ever enters the event.
 */

import type {
  ModelRef,
  ModelSelection,
  ModelSelectionScope,
  ProviderId,
  TestResult,
} from "@cowork-ghc/contracts";
import type { ProviderPort } from "./provider-port.js";
import type { ModelAuditSink, ModelChangeAuditEvent } from "./model-audit.js";

/**
 * The UI-confirm view of the model in effect for a scope (PR5). Carries the resolved
 * {@link ModelRef}, WHICH scope actually governs (a per-session override vs the default),
 * and non-secret display labels from the provider descriptor when known.
 */
export interface ActiveModel {
  readonly model: ModelRef;
  /** The scope that actually governs: `"session"` when a per-session override wins, else `"default"`. */
  readonly resolvedScope: ModelSelectionScope;
  /** Non-secret provider display name (from the descriptor), when the provider is known. */
  readonly providerDisplayName?: string;
  /** Non-secret model display name (from the descriptor's curated list), when known. */
  readonly modelDisplayName?: string;
}

export interface ModelConfigServiceOptions {
  /** The existing selection store + connector-backed health probe (the single source of truth). */
  readonly port: ProviderPort;
  /** Injectable P5 audit sink; every change is recorded here (secret-free by construction). */
  readonly audit: ModelAuditSink;
  /** Injectable clock for deterministic audit timestamps in tests. */
  readonly now?: () => string;
}

export interface ModelConfigService {
  /**
   * Select a model for the default scope or a session (PR4/PR5) and RECORD the change (P5).
   * Delegates storage to the port (one source of truth); reads the prior selection first so
   * the audit event captures old → new. Takes effect for the next request with no restart.
   */
  configureModel(selection: ModelSelection): void;
  /**
   * Clear a per-session model override (CGHC-019 review LOW-1) so the session REVERTS to the
   * global default. One source of truth: delegates the delete to the port's selection store.
   * Records a secret-free audit event (previous → default) when an override actually existed.
   * Returns whether an override was present. A no-op (nothing to clear) records nothing.
   */
  clearSessionModel(sessionId: string): boolean;
  /**
   * PR4 precedence resolver — the EFFECTIVE {@link ModelRef} for a request. A per-session
   * override beats the default for that session; with no session (or no override) the default
   * governs. Returns `undefined` when neither a session override nor a default is configured.
   */
  activeModelFor(sessionId?: string): ModelRef | undefined;
  /**
   * PR5 UI-confirm read — the active model plus which scope governs and non-secret display
   * labels, so the UI can confirm the provider/model after a switch. `undefined` when no model
   * is configured for the resolved scope.
   */
  activeModel(sessionId?: string): ActiveModel | undefined;
  /**
   * PR6 (SHOULD) — a provider reachability signal via the injected connector. Read-only; it
   * NEVER blocks or gates {@link ModelConfigService.configureModel}.
   */
  checkHealth(providerId: ProviderId): Promise<TestResult>;
  /**
   * PR6 convenience — reachability of the provider behind the currently ACTIVE model for a
   * session. `undefined` when no model is active (nothing to probe). Never blocks a switch.
   */
  checkActiveHealth(sessionId?: string): Promise<TestResult | undefined>;
}

/** Structural equality for two optional model refs (audit only fires on a real change). */
function sameRef(a: ModelRef | undefined, b: ModelRef): boolean {
  return a !== undefined && a.providerID === b.providerID && a.modelID === b.modelID;
}

export function createModelConfigService(options: ModelConfigServiceOptions): ModelConfigService {
  const { port, audit } = options;
  const clock = options.now ?? (() => new Date().toISOString());

  /** Non-secret display labels for a ref, sourced from the provider descriptor when present. */
  function labelsFor(model: ModelRef): Pick<ActiveModel, "providerDisplayName" | "modelDisplayName"> {
    const descriptor = port.describe(model.providerID);
    if (descriptor === undefined) return {};
    const modelDisplayName = descriptor.models.find((m) => m.ref.modelID === model.modelID)?.displayName;
    return modelDisplayName === undefined
      ? { providerDisplayName: descriptor.displayName }
      : { providerDisplayName: descriptor.displayName, modelDisplayName };
  }

  /**
   * PR4 precedence resolver (single implementation, reused by every read): a session override
   * governs its session; otherwise the default governs. Also reports WHICH scope won so the
   * UI-confirm read does not have to re-derive the precedence (review LOW-3: no duplication).
   */
  function resolveWithScope(
    sessionId?: string,
  ): { model: ModelRef; scope: ModelSelectionScope } | undefined {
    if (sessionId !== undefined) {
      const override = port.modelSelection("session", sessionId);
      if (override !== undefined) return { model: override, scope: "session" };
    }
    const fallback = port.modelSelection("default");
    return fallback === undefined ? undefined : { model: fallback, scope: "default" };
  }

  function resolveActive(sessionId?: string): ModelRef | undefined {
    return resolveWithScope(sessionId)?.model;
  }

  return {
    configureModel(selection) {
      // Read the prior selection for THIS scope before mutating, so the audit is old → new.
      const previous = port.modelSelection(selection.scope, selection.sessionId) ?? null;
      // Storage stays in the port (one source of truth); it also validates the sessionId rule.
      port.configureModel(selection);
      // Skip auditing a no-op re-selection of the identical ref (keeps the trail meaningful).
      if (sameRef(previous ?? undefined, selection.model)) return;
      const event: ModelChangeAuditEvent = {
        type: "model_selection_changed",
        scope: selection.scope,
        // Only a session-scope change is session-specific; do NOT copy a stray sessionId onto a
        // default-scope event (review LOW-2: keeps the audit record internally consistent).
        ...(selection.scope === "session" && selection.sessionId !== undefined
          ? { sessionId: selection.sessionId }
          : {}),
        previous,
        next: selection.model,
        at: clock(),
      };
      audit.record(event);
    },

    clearSessionModel(sessionId) {
      const previous = port.modelSelection("session", sessionId);
      if (previous === undefined) return false; // nothing to clear — no audit noise
      port.clearModel("session", sessionId);
      // The session now falls back to the default, or to NOTHING when no default is set. Audit
      // the revert whenever the EFFECTIVE model actually changed — including clear-to-nothing
      // (next: null), which is a real state change the P5 trail must record (review LOW).
      const next = port.modelSelection("default") ?? null;
      const unchanged = next !== null && sameRef(previous, next);
      if (!unchanged) {
        audit.record({
          type: "model_selection_changed",
          scope: "session",
          sessionId,
          previous,
          next,
          at: clock(),
        });
      }
      return true;
    },

    activeModelFor: (sessionId) => resolveActive(sessionId),

    activeModel(sessionId) {
      const resolved = resolveWithScope(sessionId);
      if (resolved === undefined) return undefined;
      return { model: resolved.model, resolvedScope: resolved.scope, ...labelsFor(resolved.model) };
    },

    checkHealth: (providerId) => port.testConnection(providerId),

    async checkActiveHealth(sessionId) {
      const model = resolveActive(sessionId);
      if (model === undefined) return undefined;
      return port.testConnection(model.providerID);
    },
  };
}
