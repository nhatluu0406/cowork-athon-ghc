/**
 * Multi-Provider Profiles Phase 1 — focused service tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/credential/memory-store.js";
import { credentialAccountForProfile, credentialRef } from "../src/credential/store.js";
import { openSettingsStore } from "../src/diagnostics/settings-store.js";
import { CUSTOM_OPENAI_COMPAT_ID } from "../src/provider/descriptors.js";
import {
  createProviderConnectionTester,
  createProviderProfileStore,
  migrateLegacySettingsToProfiles,
  resolveRuntimeProviderConfig,
} from "../src/provider-profiles/index.js";
import { createSsrfPolicy, type ResolvedAddress } from "../src/provider/index.js";
import { createCredentialService } from "../src/credential/credential-service.js";
import { createSecretScrubber } from "../src/diagnostics/secret-scrubber.js";
import type { ProviderProfile } from "../src/provider-profiles/types.js";

const PUBLIC_RESOLVER = async (): Promise<readonly ResolvedAddress[]> => [
  { address: "93.184.216.34", family: 4 },
];

async function openTestStore() {
  const backing = { data: "" as string | undefined };
  const fs = {
    read: async () => backing.data,
    write: async (value: string) => {
      backing.data = value;
    },
  };
  const store = await openSettingsStore({ fs });
  return { store, backing };
}

test("credentialAccountForProfile namespaces keyring by profile id", () => {
  assert.equal(credentialAccountForProfile("abc-123"), "profile:abc-123");
});

test("migrate legacy DeepSeek settings into default profile idempotently", async () => {
  const credentialStore = createMemoryStore();
  await credentialStore.set("provider:custom-openai-compat", "sk-test-secret");
  const settings = {
    version: 2,
    general: { theme: "system" as const, verboseLogging: false, telemetryEnabled: false },
    providers: [
      {
        providerId: CUSTOM_OPENAI_COMPAT_ID,
        baseUrl: "https://api.deepseek.com/v1",
        envVar: "DEEPSEEK_API_KEY",
        credentialRef: credentialRef("provider:custom-openai-compat"),
      },
    ],
    modelPreference: {
      default: { providerID: CUSTOM_OPENAI_COMPAT_ID, modelID: "deepseek-chat" },
    },
  };
  const first = await migrateLegacySettingsToProfiles(settings, credentialStore);
  assert.equal(first.migrated, true);
  assert.equal(first.settings.providerProfiles?.length, 1);
  assert.equal(first.settings.activeProfileId, "migrated-deepseek");
  const second = await migrateLegacySettingsToProfiles(
    { ...first.settings, providerProfilesMigrated: true },
    credentialStore,
  );
  assert.equal(second.migrated, false);
});

test("profile JSON snapshot never contains secret values", async () => {
  const { store } = await openTestStore();
  const profiles = createProviderProfileStore({ store, now: () => "2026-07-13T00:00:00.000Z" });
  const profile = await profiles.create({
    displayName: "DeepSeek",
    providerType: "deepseek",
    presetId: "deepseek",
  });
  await profiles.setCredentialRef(profile.id, credentialRef(credentialAccountForProfile(profile.id)));
  const snapshot = JSON.stringify(store.snapshot());
  assert.equal(snapshot.includes("sk-"), false);
  assert.equal(snapshot.includes("secret"), false);
});

test("provider profile CRUD and active profile selection", async () => {
  const { store } = await openTestStore();
  const profiles = createProviderProfileStore({ store, now: () => "2026-07-13T00:00:00.000Z" });
  const a = await profiles.create({ displayName: "DeepSeek", providerType: "deepseek", presetId: "deepseek" });
  const b = await profiles.create({
    displayName: "Local",
    providerType: "custom-openai-compat",
    baseUrl: "https://api.example.com/v1",
    modelId: "gpt-test",
  });
  assert.equal(profiles.list().length, 2);
  await profiles.setActive(b.id);
  assert.equal(profiles.activeProfileId(), b.id);
  await profiles.update(b.id, { modelId: "gpt-4o-mini" });
  assert.equal(profiles.get(b.id)?.modelId, "gpt-4o-mini");
  await profiles.delete(a.id);
  assert.equal(profiles.list().length, 1);
});

test("connection test state is isolated per profile id", async () => {
  const credentialStore = createMemoryStore();
  const credentialService = createCredentialService({
    store: credentialStore,
    scrubber: createSecretScrubber(),
  });
  const tester = createProviderConnectionTester({
    credentials: credentialService,
    dnsResolver: PUBLIC_RESOLVER,
    now: () => "2026-07-13T00:00:00.000Z",
  });
  const profileA: ProviderProfile = {
    id: "profile-a",
    displayName: "A",
    providerType: "custom-openai-compat",
    baseUrl: "https://api.example.com/v1",
    modelId: "m1",
    envVar: "COWORK_PF_A_KEY",
    createdAt: "t",
    updatedAt: "t",
  };
  const profileB: ProviderProfile = { ...profileA, id: "profile-b", displayName: "B" };
  await tester.testProfile(profileA);
  await tester.testProfile(profileB);
  const stateA = tester.lastResultFor("profile-a");
  const stateB = tester.lastResultFor("profile-b");
  assert.notEqual(stateA?.profileId, stateB?.profileId);
});

test("runtime resolver maps profile to custom-openai-compat adapter", () => {
  const resolved = resolveRuntimeProviderConfig({
    id: "p1",
    displayName: "DeepSeek",
    providerType: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    modelId: "deepseek-chat",
    envVar: "COWORK_PF_P1_KEY",
    createdAt: "t",
    updatedAt: "t",
  });
  assert.equal(resolved.runtimeProviderId, CUSTOM_OPENAI_COMPAT_ID);
  assert.equal(resolved.model.modelID, "deepseek-chat");
  assert.equal(resolved.opencode.baseUrl, "https://api.deepseek.com/v1");
});

test("SSRF policy still applies to profile base URL via provider port path", async () => {
  const ssrf = createSsrfPolicy({ resolver: PUBLIC_RESOLVER });
  await assert.rejects(
    () => ssrf.assertAllowed("http://127.0.0.1/v1"),
    /SSRF|refused|https/i,
  );
});
