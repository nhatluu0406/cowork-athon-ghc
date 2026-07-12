/**
 * `ProviderPort` — the thin, provider-neutral management port over the reused OpenCode
 * runtime (CGHC-010, ADR 0005 §Decision). The runtime owns the wire calls; this port owns
 * config, credential-ref orchestration, the SSRF guard for a custom `base_url`, the PR7
 * error taxonomy, and redaction hints. It is screen-independent: no method encodes a
 * vendor; consumers iterate {@link ProviderDescriptor} data (PR1).
 *
 * Secret discipline: `configureCredential` stores a {@link CredentialRef} HANDLE only — no
 * key bytes ever enter the port's state (ADR 0005:39,52-55). The value is resolved and
 * injected only at the launch/connect boundary by the credential service (CGHC-009).
 *
 * Wire delegation: streaming/probe/cancel are performed by the runtime via an injected
 * {@link ProviderConnector} seam. For a custom endpoint the port wraps every connect in
 * {@link ProviderPort.guardedConnect}, which RE-RESOLVES and RE-CHECKS the base_url against
 * the SSRF policy at connect time (the DNS-rebinding guard). CGHC-011 (test connection) and
 * CGHC-012 (streamChat) route their runtime calls through `guardedConnect`.
 */

import type {
  CredentialRef,
  ModelRef,
  ModelSelection,
  ModelSelectionScope,
  ProviderDescriptor,
  ProviderError,
  ProviderId,
  TestResult,
} from "@cowork-ghc/contracts";
import {
  PROVIDER_DESCRIPTORS,
  isCustomEndpoint,
  requiresBaseUrl,
} from "./descriptors.js";
import type { ConnectTarget, SsrfPolicy } from "./ssrf-policy.js";
import { mapProviderError } from "./error-map.js";

/** Opaque handle for an in-flight runtime stream (aborted on cancel; S3). */
export interface StreamHandle {
  readonly id: string;
}

/**
 * The OpenCode-delegating wire seam. CGHC-011/012 supply the real implementation that
 * talks to the runtime; tests supply a fake. The port never builds HTTP itself.
 */
export interface ProviderConnector {
  /** Bounded connection probe against the runtime (PR3). */
  probe(id: ProviderId, target: ConnectTarget | null): Promise<TestResult>;
  /** Abort a runtime stream (S3). */
  cancel(handle: StreamHandle): Promise<void>;
}

/** Non-secret detection hints for the value-based scrubber (CGHC-021 owns the real one). */
export interface RedactPattern {
  readonly label: string;
  readonly test: RegExp;
}

export interface ProviderPort {
  /** All configured provider descriptors (PR1). */
  list(): readonly ProviderDescriptor[];
  /** One descriptor by id, or `undefined`. */
  describe(id: ProviderId): ProviderDescriptor | undefined;
  /** Bind a credential HANDLE to a provider (never key bytes; PR2/PR9). */
  configureCredential(id: ProviderId, ref: CredentialRef): void;
  /** The bound handle for a provider, or `undefined`. */
  credentialRefFor(id: ProviderId): CredentialRef | undefined;
  /** Remove a provider's credential binding. */
  removeCredential(id: ProviderId): void;
  /**
   * Configure the custom endpoint's `base_url`. SSRF-validated at config time (require
   * https; block RFC-1918/link-local/loopback/metadata). Rejects a non-custom id.
   */
  configureEndpoint(id: ProviderId, input: { baseUrl: string }): Promise<void>;
  /** The configured base_url for the custom endpoint, or `undefined`. */
  baseUrlFor(id: ProviderId): string | undefined;
  /** Select a model (default or per-session; PR4/PR5). Secret-free, safe to persist. */
  configureModel(selection: ModelSelection): void;
  /**
   * Remove a model selection for a scope (CGHC-019 review LOW-1). Clearing a session scope
   * drops that session's override so it reverts to the default; returns whether a selection
   * existed. Requires a `sessionId` for the session scope.
   */
  clearModel(scope: ModelSelectionScope, sessionId?: string): boolean;
  /** The selected model for a scope, or `undefined`. */
  modelSelection(scope: ModelSelectionScope, sessionId?: string): ModelRef | undefined;
  /**
   * Run a wire call through the SSRF guard. For a custom endpoint the stored base_url is
   * RE-RESOLVED and RE-CHECKED at connect time (DNS-rebinding guard) before `connect`
   * runs; built-ins pass `null` (the runtime uses the vendor default host).
   */
  guardedConnect<T>(id: ProviderId, connect: (target: ConnectTarget | null) => Promise<T>): Promise<T>;
  /** Bounded connection probe (PR3) — delegates to the connector through the SSRF guard. */
  testConnection(id: ProviderId): Promise<TestResult>;
  /** Abort a runtime stream (S3). */
  cancel(handle: StreamHandle): Promise<void>;
  /** Canonical PR7 error mapping enforced at the boundary. */
  mapError(raw: unknown): ProviderError;
  /** Detection hints feeding the value-based scrubber (PR8). */
  redactionPatterns(): readonly RedactPattern[];
}

export interface ProviderPortOptions {
  readonly ssrf: SsrfPolicy;
  readonly connector: ProviderConnector;
  /** Override the descriptor list (tests); defaults to the five targets. */
  readonly descriptors?: readonly ProviderDescriptor[];
}

const REDACTION_PATTERNS: readonly RedactPattern[] = Object.freeze([
  { label: "anthropic_key", test: /sk-ant-[A-Za-z0-9-_]{8,}/ },
  { label: "openai_key", test: /sk-[A-Za-z0-9]{16,}/ },
  { label: "openrouter_key", test: /sk-or-[A-Za-z0-9-_]{8,}/ },
]);

function selectionKey(scope: ModelSelectionScope, sessionId?: string): string {
  return scope === "session" ? `session:${sessionId ?? ""}` : "default";
}

export function createProviderPort(options: ProviderPortOptions): ProviderPort {
  const descriptors = options.descriptors ?? PROVIDER_DESCRIPTORS;
  const byId = new Map(descriptors.map((d) => [d.id, d] as const));
  const credentialRefs = new Map<ProviderId, CredentialRef>();
  const baseUrls = new Map<ProviderId, string>();
  const models = new Map<string, ModelRef>();

  function requireKnown(id: ProviderId): ProviderDescriptor {
    const descriptor = byId.get(id);
    if (descriptor === undefined) throw new Error(`Unknown provider id: ${JSON.stringify(id)}`);
    return descriptor;
  }

  async function guardedConnect<T>(
    id: ProviderId,
    connect: (target: ConnectTarget | null) => Promise<T>,
  ): Promise<T> {
    requireKnown(id);
    if (!isCustomEndpoint(id)) return connect(null);
    const baseUrl = baseUrls.get(id);
    if (baseUrl === undefined) {
      throw new Error(`Custom endpoint ${JSON.stringify(id)} has no configured base_url.`);
    }
    // DNS-rebinding guard: re-resolve + re-validate the base_url at connect time.
    const target = await options.ssrf.assertAllowed(baseUrl);
    return connect(target);
  }

  return {
    list: () => descriptors,
    describe: (id) => byId.get(id),

    configureCredential(id, ref) {
      requireKnown(id);
      credentialRefs.set(id, ref);
    },
    credentialRefFor: (id) => credentialRefs.get(id),
    removeCredential(id) {
      credentialRefs.delete(id);
    },

    async configureEndpoint(id, input) {
      requireKnown(id);
      if (!requiresBaseUrl(id)) {
        throw new Error(`Provider ${JSON.stringify(id)} does not accept a base_url.`);
      }
      // SSRF-validate at config time; throws SsrfBlockedError on a disallowed target.
      await options.ssrf.assertAllowed(input.baseUrl);
      baseUrls.set(id, input.baseUrl);
    },
    baseUrlFor: (id) => baseUrls.get(id),

    configureModel(selection) {
      requireKnown(selection.model.providerID);
      if (selection.scope === "session" && !selection.sessionId) {
        throw new Error("A per-session model selection requires a sessionId.");
      }
      models.set(selectionKey(selection.scope, selection.sessionId), selection.model);
    },

    clearModel(scope, sessionId) {
      if (scope === "session" && !sessionId) {
        throw new Error("Clearing a per-session model selection requires a sessionId.");
      }
      return models.delete(selectionKey(scope, sessionId));
    },
    modelSelection: (scope, sessionId) => models.get(selectionKey(scope, sessionId)),

    guardedConnect,
    testConnection: (id) => guardedConnect(id, (target) => options.connector.probe(id, target)),
    cancel: (handle) => options.connector.cancel(handle),

    mapError: mapProviderError,
    redactionPatterns: () => REDACTION_PATTERNS,
  };
}
