/**
 * Credential domain service (ADR 0006, SEC-1/SEC-2, PR9).
 *
 * The one place credential logic lives: it stores a key into the {@link CredentialStore}
 * and hands back a secret-free {@link CredentialRef} handle; it resolves that handle to a
 * per-provider env-var injection ONLY at the launch/injection boundary. App state and the
 * renderer see the handle only — never the value (AC1/AC3).
 *
 * There is ONE secret scrubber in the app (CGHC-021, `../diagnostics`): the composition
 * root injects a single shared {@link SecretScrubber} instance here so the credential
 * audit, the diagnostics logger, the execution-metadata record, the bundle export, and
 * the boundary error path are all protected by the same `register()` calls (AC4, SEC-2).
 * `resolveInjection` registers the resolved key BEFORE it enters the launch env, so every
 * downstream sink is covered. The service performs no disk writes of its own and never
 * touches `auth.json`/`env.json` (AC2/AC6).
 */

import type { CredentialRef } from "@cowork-ghc/contracts";
import { injectionFor, type ProviderEnvSpec, type ProviderKeyInjection } from "@cowork-ghc/runtime";
import {
  CredentialNotFoundError,
  credentialAccountFor,
  credentialRef,
  type CredentialStore,
} from "./store.js";
import { createSecretScrubber, type SecretScrubber } from "../diagnostics/index.js";

/** Input to store a provider credential. The `secret` is consumed, never returned/logged. */
export interface StoreCredentialInput {
  readonly providerId: string;
  readonly secret: string;
  /** Optional explicit account handle; defaults to a stable `provider:<id>` handle. */
  readonly account?: string;
}

/** A secret-free audit line sink (already scrubbed). */
export type CredentialLog = (line: string) => void;

export interface CredentialServiceOptions {
  readonly store: CredentialStore;
  /** Optional audit sink; every line is scrubbed before it is called. */
  readonly log?: CredentialLog;
  /**
   * The single, app-wide {@link SecretScrubber} (CGHC-021). The production composition
   * root MUST pass the SHARED instance so diagnostics/execution-metadata/logs/errors are
   * all covered by one `register()`. A fresh one is created only for standalone tests.
   */
  readonly scrubber?: SecretScrubber;
}

export interface CredentialService {
  /** Store a key; returns ONLY a handle. The value stays in the OS store. */
  store(input: StoreCredentialInput): Promise<CredentialRef>;
  /**
   * Resolve a handle to a `{ envVar, value }` injection — the SOLE point a key value
   * leaves the store. Registers the value with the scrubber, then returns it for the
   * child spawn env. Throws {@link CredentialNotFoundError} when the handle is dangling.
   */
  resolveInjection(ref: CredentialRef, spec: ProviderEnvSpec): Promise<ProviderKeyInjection>;
  /**
   * Resolve a handle to its raw string value for in-process use (e.g., HTTP headers).
   * Registers the value with the scrubber. Throws {@link CredentialNotFoundError} when
   * the handle is dangling. Use this for non-spawn-env credentials; prefer {@link resolveInjection}
   * for child-process credentials (it includes label context for the scrubber).
   */
  resolveValue(ref: CredentialRef): Promise<string>;
  /** True when the handle resolves to a stored entry (no value is exposed). */
  has(ref: CredentialRef): Promise<boolean>;
  /** Remove the stored key for a handle; `true` when one existed. */
  remove(ref: CredentialRef): Promise<boolean>;
  /** The value scrubber (for composing wider redaction / tests). */
  readonly scrubber: SecretScrubber;
}

export function createCredentialService(options: CredentialServiceOptions): CredentialService {
  const { store } = options;
  const scrubber = options.scrubber ?? createSecretScrubber();

  const audit = (line: string): void => {
    // Defense in depth: scrub even though these lines are built from secret-free fields.
    options.log?.(scrubber.scrub(line));
  };

  return {
    scrubber,

    async store(input: StoreCredentialInput): Promise<CredentialRef> {
      const secret = input.secret;
      if (typeof secret !== "string" || secret.length === 0) {
        throw new Error("Credential secret must be a non-empty string.");
      }
      const account = credentialAccountFor(input.providerId, input.account);
      await store.set(account, secret);
      // Register the value so any later scrub call masks it, even outside this module's lines.
      scrubber.register(secret);
      audit(`credential_stored provider=${input.providerId} account=${account}`);
      return credentialRef(account);
    },

    async resolveInjection(
      ref: CredentialRef,
      spec: ProviderEnvSpec,
    ): Promise<ProviderKeyInjection> {
      const value = await store.get(ref.account);
      if (value === null) throw new CredentialNotFoundError(ref.account);
      // Register the resolved key with the SHARED scrubber BEFORE it enters the launch
      // env — this single call covers every downstream sink (diagnostics bundle,
      // execution-metadata, logs, error path). The label is the non-secret env-var name.
      scrubber.register({ value, label: spec.primaryEnvVar });
      audit(`credential_injected account=${ref.account} envVar=${spec.primaryEnvVar}`);
      return injectionFor(spec, value);
    },

    async has(ref: CredentialRef): Promise<boolean> {
      return (await store.get(ref.account)) !== null;
    },

    async resolveValue(ref: CredentialRef): Promise<string> {
      const value = await store.get(ref.account);
      if (value === null) throw new CredentialNotFoundError(ref.account);
      // Register with the scrubber so any downstream sink (logs, errors, diagnostics) masks it.
      scrubber.register(value);
      audit(`credential_resolved account=${ref.account}`);
      return value;
    },

    async remove(ref: CredentialRef): Promise<boolean> {
      const removed = await store.delete(ref.account);
      audit(`credential_removed account=${ref.account} removed=${String(removed)}`);
      return removed;
    },
  };
}
