/**
 * Pure wiring helpers for the composition root (kept out of `compose-service.ts` for size).
 *
 *  - {@link defaultDnsResolver}: the production {@link DnsResolver} for the SSRF policy, backed
 *    by `node:dns` (the DNS-rebinding guard re-resolves through it at connect time). Tests
 *    inject a deterministic fake so no real DNS is used.
 *  - {@link wrapSettingsStoreWithSsrf}: routes {@link SettingsStore.setProviderBaseUrl} through
 *    {@link ProviderPort.configureEndpoint} so a `base_url` is SSRF-validated (and rebinding
 *    revalidated) BEFORE it is persisted — an unvalidated base_url is never written to disk.
 *  - {@link wrapSettingsStoreWithPortSync}: bridges the OTHER settings→runtime writes (default
 *    model, provider credential ref) into the in-memory {@link ProviderPort}/model resolver that
 *    `activeModelFor()` and Tier 2 launch consume, so the persistent store and the runtime
 *    resolver never drift (FIX-1: ONE effective default-model/credential source).
 */

import { lookup } from "node:dns/promises";
import type { DnsResolver, ModelConfigService, ProviderPort, ResolvedAddress } from "../provider/index.js";
import type { SettingsStore } from "../diagnostics/index.js";

/** Production DNS resolver for the SSRF policy (returns every A/AAAA answer for a host). */
export function defaultDnsResolver(): DnsResolver {
  return async (hostname: string): Promise<readonly ResolvedAddress[]> => {
    const results = await lookup(hostname, { all: true });
    return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
  };
}

/**
 * Decorate a {@link SettingsStore} so persisting a provider `base_url` first passes the SSRF
 * policy via the {@link ProviderPort}. On refusal `configureEndpoint` throws (SsrfBlockedError)
 * and nothing is persisted; on success the port holds the validated endpoint AND it is persisted.
 */
export function wrapSettingsStoreWithSsrf(base: SettingsStore, port: ProviderPort): SettingsStore {
  return {
    snapshot: () => base.snapshot(),
    general: () => base.general(),
    updateGeneral: (patch) => base.updateGeneral(patch),
    listProviderSettings: () => base.listProviderSettings(),
    providerSettings: (id) => base.providerSettings(id),
    setProviderCredentialRef: (id, ref) => base.setProviderCredentialRef(id, ref),
    removeProviderCredentialRef: (id) => base.removeProviderCredentialRef(id),
    async setProviderBaseUrl(id, baseUrl) {
      // SSRF + DNS-rebinding revalidation BEFORE persistence: never store an unvalidated base_url.
      await port.configureEndpoint(id, { baseUrl });
      await base.setProviderBaseUrl(id, baseUrl);
    },
    // envVar name is a NON-SECRET child variable name (not a URL) — pure passthrough, no SSRF gate.
    setProviderEnvVar: (id, envVar) => base.setProviderEnvVar(id, envVar),
    defaultModel: () => base.defaultModel(),
    setDefaultModel: (model) => base.setDefaultModel(model),
    activeWorkspace: () => base.activeWorkspace(),
    setActiveWorkspace: (rootPath) => base.setActiveWorkspace(rootPath),
    loadSource: () => base.loadSource(),
    recoveryReason: () => base.recoveryReason(),
    reset: () => base.reset(),
  };
}

/**
 * Decorate a {@link SettingsStore} so a runtime-relevant write ALSO reaches the in-memory
 * resolver the runtime actually reads — killing the store↔resolver drift (FIX-1, HIGH-1). Mirrors
 * {@link wrapSettingsStoreWithSsrf}'s double-write pattern: the runtime resolver is updated FIRST,
 * then the persistent store, so `GET /v1/settings` (store) and `activeModelFor()` / Tier 2 launch
 * (resolver) can never report contradictory defaults, and a change takes effect with no restart.
 *
 *  - `setDefaultModel(model)`  → `modelConfig.configureModel({ scope: "default", model })`
 *    (or `port.clearModel("default")` when undefined), THEN `base.setDefaultModel(model)`.
 *  - `setProviderCredentialRef(id, ref)` → `port.configureCredential(id, ref)` THEN base.
 *  - `removeProviderCredentialRef(id)`   → `port.removeCredential(id)`        THEN base.
 *
 * Every other method (including SSRF-guarded `setProviderBaseUrl`) delegates unchanged, so this
 * composes cleanly OUTSIDE {@link wrapSettingsStoreWithSsrf} to yield a store that does BOTH.
 */
export function wrapSettingsStoreWithPortSync(
  base: SettingsStore,
  port: ProviderPort,
  modelConfig: ModelConfigService,
): SettingsStore {
  return {
    ...base,
    setProviderCredentialRef(id, ref) {
      // Runtime resolver first (what launch/model reads), then persist — no drift.
      port.configureCredential(id, ref);
      return base.setProviderCredentialRef(id, ref);
    },
    removeProviderCredentialRef(id) {
      port.removeCredential(id);
      return base.removeProviderCredentialRef(id);
    },
    setDefaultModel(model) {
      if (model === undefined) {
        // Clear the default in the resolver so `activeModelFor()` reverts too.
        port.clearModel("default");
      } else {
        // Route through the model config service so the change is audited (P5) exactly like a
        // direct model switch, and the port's selection map (the single read source) is updated.
        modelConfig.configureModel({ scope: "default", model });
      }
      return base.setDefaultModel(model);
    },
  };
}
