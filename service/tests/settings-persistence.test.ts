/**
 * CGHC-022 SD1 — settings persist across restart (+ migration of an older shape).
 *
 * A shared in-memory {@link SettingsFs} fake stands in for the durable file. Instance A
 * writes general + provider (credential HANDLE only) + default-model settings; a FRESH
 * instance B, constructed over the SAME backing, reads them all back — proving persistence
 * across a service restart. A separate case feeds a legacy/versionless document and asserts
 * it migrates forward to the current shape without data loss. Also asserts no raw key is
 * ever persisted (handle only).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CredentialRef, ModelRef } from "@cowork-ghc/contracts";
import {
  openSettingsStore,
  SETTINGS_SCHEMA_VERSION,
  type SettingsFs,
} from "../src/diagnostics/index.js";

/** In-memory backing shared between two store instances to simulate a restart. */
function sharedFs(seed?: string): { fs: SettingsFs; peek: () => string | undefined } {
  let data: string | undefined = seed;
  return {
    fs: {
      read: async () => data,
      write: async (next: string) => {
        data = next;
      },
    },
    peek: () => data,
  };
}

const REF: CredentialRef = { store: "os", account: "cowork/openai/default" };
const MODEL: ModelRef = { providerID: "openai", modelID: "gpt-4o" };

test("SD1: general + provider + model settings persist across a restart", async () => {
  const backing = sharedFs();

  const a = await openSettingsStore({ fs: backing.fs });
  await a.updateGeneral({ theme: "dark", verboseLogging: true });
  await a.setProviderCredentialRef("openai", REF);
  await a.setProviderBaseUrl("custom-openai-compat", "https://api.example.test/v1");
  await a.setDefaultModel(MODEL);

  // Fresh instance over the SAME backing == a service restart.
  const b = await openSettingsStore({ fs: backing.fs });
  assert.equal(b.loadSource(), "loaded", "restart loaded persisted settings, not a default");
  assert.equal(b.general().theme, "dark");
  assert.equal(b.general().verboseLogging, true);
  assert.deepEqual(b.providerSettings("openai")?.credentialRef, REF, "credential HANDLE persisted");
  assert.equal(b.providerSettings("custom-openai-compat")?.baseUrl, "https://api.example.test/v1");
  assert.deepEqual(b.defaultModel(), MODEL, "default-model preference is the persisted SSOT");
});

test("SD1: a raw key is NEVER persisted — only the credential handle", async () => {
  const backing = sharedFs();
  const store = await openSettingsStore({ fs: backing.fs });
  await store.setProviderCredentialRef("openai", REF);

  const persisted = backing.peek() ?? "";
  assert.ok(persisted.includes("cowork/openai/default"), "the non-secret account handle is stored");
  // The persisted document is a plain handle: store + account, nothing key-shaped.
  const parsed = JSON.parse(persisted) as { providers: { credentialRef?: Record<string, unknown> }[] };
  const ref = parsed.providers[0]?.credentialRef ?? {};
  assert.deepEqual(Object.keys(ref).sort(), ["account", "store"], "handle carries no key field");
});

test("SD1: removing a credential unbinds it and persists", async () => {
  const backing = sharedFs();
  const a = await openSettingsStore({ fs: backing.fs });
  await a.setProviderCredentialRef("openai", REF);
  await a.removeProviderCredentialRef("openai");

  const b = await openSettingsStore({ fs: backing.fs });
  assert.equal(b.providerSettings("openai")?.credentialRef, undefined, "binding removed after restart");
});

test("SD1 migration: a v1 document (no activeWorkspace, no envVar) loads and upgrades to v2", async () => {
  // A v1 on-disk doc: version 1, a provider WITHOUT envVar, and no activeWorkspace field.
  const v1 = JSON.stringify({
    version: 1,
    general: { theme: "dark", verboseLogging: false, telemetryEnabled: false },
    providers: [{ providerId: "custom-openai-compat", baseUrl: "https://api.example.test/v1" }],
    modelPreference: {},
  });
  const backing = sharedFs(v1);

  const store = await openSettingsStore({ fs: backing.fs });
  assert.equal(store.loadSource(), "loaded", "a valid v1 doc loads cleanly (not recovered)");
  assert.equal(store.snapshot().version, SETTINGS_SCHEMA_VERSION, "in-memory doc is now v2");
  assert.equal(store.snapshot().version, 2, "current schema version is 2");
  assert.equal(store.activeWorkspace(), undefined, "v1 doc has no active workspace");
  assert.equal(store.providerSettings("custom-openai-compat")?.envVar, undefined, "v1 provider has no envVar");
  assert.equal(store.providerSettings("custom-openai-compat")?.baseUrl, "https://api.example.test/v1");

  // The next write persists the upgraded v2 shape to disk.
  await store.updateGeneral({ verboseLogging: true });
  const persisted = JSON.parse(backing.peek() ?? "{}") as { version: number };
  assert.equal(persisted.version, 2, "next write persists as v2");
});

test("SD1: setProviderEnvVar upserts (new + existing) and rejects an empty name", async () => {
  const backing = sharedFs();
  const store = await openSettingsStore({ fs: backing.fs });

  // New provider: the entry is created with just the envVar.
  await store.setProviderEnvVar("custom-openai-compat", "CUSTOM_API_KEY");
  assert.equal(store.providerSettings("custom-openai-compat")?.envVar, "CUSTOM_API_KEY");

  // Existing provider: envVar is upserted without dropping the sibling baseUrl.
  await store.setProviderBaseUrl("custom-openai-compat", "https://api.example.test/v1");
  await store.setProviderEnvVar("custom-openai-compat", "RENAMED_KEY");
  const entry = store.providerSettings("custom-openai-compat");
  assert.equal(entry?.envVar, "RENAMED_KEY", "envVar updated on the existing entry");
  assert.equal(entry?.baseUrl, "https://api.example.test/v1", "sibling baseUrl preserved");

  // Empty / whitespace names are rejected.
  await assert.rejects(() => store.setProviderEnvVar("custom-openai-compat", ""));
  await assert.rejects(() => store.setProviderEnvVar("custom-openai-compat", "   "));

  // listProviderSettings includes envVar when set.
  const listed = store.listProviderSettings().find((p) => p.providerId === "custom-openai-compat");
  assert.equal(listed?.envVar, "RENAMED_KEY", "listProviderSettings surfaces the envVar");

  // Round-trips across a restart.
  const reloaded = await openSettingsStore({ fs: backing.fs });
  assert.equal(reloaded.providerSettings("custom-openai-compat")?.envVar, "RENAMED_KEY");
});

test("SD1: setActiveWorkspace / activeWorkspace round-trip, reject empty, and persist", async () => {
  const backing = sharedFs();
  const store = await openSettingsStore({ fs: backing.fs });
  assert.equal(store.activeWorkspace(), undefined, "no workspace until one is granted");

  await store.setActiveWorkspace("C:/Users/test/Good Workspace");
  assert.deepEqual(store.activeWorkspace(), { rootPath: "C:/Users/test/Good Workspace" });

  // Empty / whitespace roots are rejected and do not overwrite the granted one.
  await assert.rejects(() => store.setActiveWorkspace(""));
  await assert.rejects(() => store.setActiveWorkspace("   "));
  assert.deepEqual(store.activeWorkspace(), { rootPath: "C:/Users/test/Good Workspace" });

  // Persists across a restart.
  const reloaded = await openSettingsStore({ fs: backing.fs });
  assert.equal(reloaded.loadSource(), "loaded");
  assert.deepEqual(reloaded.activeWorkspace(), { rootPath: "C:/Users/test/Good Workspace" });
});

test("SD1 migration: a legacy versionless document upgrades to the current shape", async () => {
  // A legacy file: no `version`, extra unknown field, credential handle present.
  const legacy = JSON.stringify({
    general: { theme: "light" },
    providers: [{ providerId: "openai", credentialRef: { store: "os", account: "acct" }, junk: 1 }],
    modelPreference: { default: { providerID: "openai", modelID: "gpt-4o" } },
    unknownTopLevel: true,
  });
  const backing = sharedFs(legacy);

  const store = await openSettingsStore({ fs: backing.fs });
  assert.equal(store.loadSource(), "loaded", "a valid legacy doc loads (not recovered)");
  assert.equal(store.snapshot().version, SETTINGS_SCHEMA_VERSION, "migrated to current version");
  assert.equal(store.general().theme, "light", "kept the legacy theme");
  // Defaults fill the fields the legacy doc omitted.
  assert.equal(store.general().telemetryEnabled, false);
  assert.deepEqual(store.defaultModel(), MODEL, "kept the legacy default model");
  assert.deepEqual(store.providerSettings("openai")?.credentialRef, { store: "os", account: "acct" });
});
