/**
 * Multi-Provider Profiles Phase 1 — focused service tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createMemoryStore } from "../src/credential/memory-store.js";
import { credentialAccountForProfile, credentialRef } from "../src/credential/store.js";
import { openSettingsStore } from "../src/diagnostics/settings-store.js";
import { CUSTOM_OPENAI_COMPAT_ID } from "../src/provider/descriptors.js";
import {
  createProviderConnectionTester,
  createProviderProfileRouter,
  createProviderProfileStore,
  migrateLegacySettingsToProfiles,
  resolveRuntimeProviderConfig,
} from "../src/provider-profiles/index.js";
import { createSsrfPolicy, type ResolvedAddress } from "../src/provider/index.js";
import { createCredentialService } from "../src/credential/credential-service.js";
import { createSecretScrubber } from "../src/diagnostics/secret-scrubber.js";
import type { ProviderProfile } from "../src/provider-profiles/types.js";
import { createService } from "../src/server/http-service.js";

const PUBLIC_RESOLVER = async (): Promise<readonly ResolvedAddress[]> => [
  { address: "93.184.216.34", family: 4 },
];

/** A complete, non-secret discovery error for router stubs (discovery is exercised elsewhere). */
const DISCOVERY_STUB_ERROR = {
  kind: "unavailable",
  message: "unused",
  retryable: false,
  recovery: "",
} as const;

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

async function startMockOpenAiGateway(): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
      return;
    }
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "chatcmpl-test", choices: [] }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    stop: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
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

test("provider profile delete rejects only or active profile and preserves state", async () => {
  const { store } = await openTestStore();
  const profiles = createProviderProfileStore({ store, now: () => "2026-07-13T00:00:00.000Z" });
  const a = await profiles.create({ displayName: "DeepSeek", providerType: "deepseek", presetId: "deepseek" });
  await profiles.setCredentialRef(a.id, credentialRef(credentialAccountForProfile(a.id)));

  await assert.rejects(
    () => profiles.delete(a.id),
    /Bạn cần tạo một profile khác trước khi xóa profile này\./,
  );
  assert.equal(profiles.activeProfileId(), a.id);
  assert.equal(profiles.get(a.id)?.credentialRef?.account, credentialAccountForProfile(a.id));

  const b = await profiles.create({
    displayName: "Local",
    providerType: "custom-openai-compat",
    baseUrl: "https://api.example.com/v1",
    modelId: "gpt-test",
  });

  await assert.rejects(
    () => profiles.delete(a.id),
    /Hãy đặt một profile khác làm active trước khi xóa profile này\./,
  );
  assert.equal(profiles.activeProfileId(), a.id);

  await profiles.setActive(b.id);
  await profiles.delete(a.id);
  assert.equal(profiles.list().length, 1);
  assert.equal(profiles.activeProfileId(), b.id);
  assert.equal(profiles.get(a.id), undefined);
});

test("profile delete route enforces last and active profile rules before credential removal", async () => {
  const { store } = await openTestStore();
  const credentialStore = createMemoryStore();
  const profiles = createProviderProfileStore({ store, now: () => "2026-07-13T00:00:00.000Z" });
  const a = await profiles.create({ displayName: "DeepSeek", providerType: "deepseek", presetId: "deepseek" });
  const accountA = credentialAccountForProfile(a.id);
  await credentialStore.set(accountA, "redacted-test-delete-a");
  await profiles.setCredentialRef(a.id, credentialRef(accountA));

  let syncCount = 0;
  const removedAccounts: string[] = [];
  const token = "profile-delete-token-123456789012345";
  const service = createService({ clientToken: token });
  service.mount(createProviderProfileRouter({
    profiles,
    tester: {
      testProfile: async () => ({ ok: false, error: { kind: "unavailable", message: "unused" } }),
      lastResultFor: () => undefined,
    },
    discovery: { discoverForProfile: async () => ({ ok: false, error: DISCOVERY_STUB_ERROR }) },
    runtimeBridge: { syncActiveProfile: async () => { syncCount += 1; } },
    bindCredentialRef: async () => {},
    removeCredential: async (_profileId, account) => {
      removedAccounts.push(account);
      await credentialStore.delete(account);
    },
  }));
  const address = await service.start();
  try {
    const onlyRes = await fetch(`http://${address.host}:${address.port}/v1/provider-profiles/${a.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ forceUnconfigured: true }),
    });
    const onlyBody = await onlyRes.json() as { ok: boolean; error?: { message: string } };
    assert.equal(onlyRes.status, 400);
    assert.equal(onlyBody.ok, false);
    assert.equal(onlyBody.error?.message, "Bạn cần tạo một profile khác trước khi xóa profile này.");
    assert.equal(await credentialStore.get(accountA), "redacted-test-delete-a");
    assert.equal(profiles.activeProfileId(), a.id);
    assert.deepEqual(removedAccounts, []);
    assert.equal(syncCount, 0);

    const b = await profiles.create({
      displayName: "Local",
      providerType: "custom-openai-compat",
      baseUrl: "https://api.example.com/v1",
      modelId: "gpt-test",
    });
    const accountB = credentialAccountForProfile(b.id);
    await credentialStore.set(accountB, "redacted-test-delete-b");
    await profiles.setCredentialRef(b.id, credentialRef(accountB));

    const activeRes = await fetch(`http://${address.host}:${address.port}/v1/provider-profiles/${a.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(activeRes.status, 400);
    assert.equal(await credentialStore.get(accountA), "redacted-test-delete-a");
    assert.equal(profiles.activeProfileId(), a.id);
    assert.equal(syncCount, 0);

    await profiles.setActive(a.id);
    const nonActiveRes = await fetch(`http://${address.host}:${address.port}/v1/provider-profiles/${b.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(nonActiveRes.status, 200);
    assert.equal(await credentialStore.get(accountB), null);
    assert.equal(profiles.get(b.id), undefined);
    assert.equal(profiles.activeProfileId(), a.id);
    assert.deepEqual(removedAccounts, [accountB]);
    assert.equal(syncCount, 1);
  } finally {
    await service.stop();
  }
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

test("profile test route maps SSRF/base URL policy failure to failed TestResult, not internal", async () => {
  const { store } = await openTestStore();
  const credentialStore = createMemoryStore();
  const credentialService = createCredentialService({
    store: credentialStore,
    scrubber: createSecretScrubber(),
  });
  const profiles = createProviderProfileStore({ store, now: () => "2026-07-13T00:00:00.000Z" });
  const profile = await profiles.create({
    displayName: "Blocked endpoint",
    providerType: "custom-openai-compat",
    baseUrl: "http://127.0.0.1:1/v1",
    modelId: "mock-model",
  });
  await credentialStore.set(credentialAccountForProfile(profile.id), "redacted-test-credential-route");
  await profiles.setCredentialRef(profile.id, credentialRef(credentialAccountForProfile(profile.id)));

  const tester = createProviderConnectionTester({
    credentials: credentialService,
    dnsResolver: PUBLIC_RESOLVER,
    now: () => "2026-07-13T00:00:01.000Z",
  });
  const token = "profile-test-token-123456789012345";
  const service = createService({ clientToken: token });
  service.mount(createProviderProfileRouter({
    profiles,
    tester,
    discovery: { discoverForProfile: async () => ({ ok: false, error: DISCOVERY_STUB_ERROR }) },
    runtimeBridge: { syncActiveProfile: async () => {} },
    bindCredentialRef: async () => {},
    removeCredential: async () => {},
  }));
  const address = await service.start();
  try {
    const res = await fetch(`http://${address.host}:${address.port}/v1/provider-profiles/${profile.id}/test-connection`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      ok: true;
      data: {
        profileId: string;
        result: { ok: boolean; error?: { message: string } };
        state: { profileId: string; ok: boolean; errorMessage?: string } | null;
      };
    };
    assert.equal(body.ok, true);
    assert.equal(body.data.profileId, profile.id);
    assert.equal(body.data.result.ok, false);
    assert.match(body.data.result.error?.message ?? "", /endpoint|policy/i);
    assert.equal(body.data.state?.profileId, profile.id);
    assert.equal(JSON.stringify(body).includes("redacted-test-credential-route"), false);
    assert.equal(JSON.stringify(body).toLowerCase().includes("authorization"), false);
    assert.equal(JSON.stringify(body).toLowerCase().includes("internal boundary"), false);
  } finally {
    await service.stop();
  }
});

test("profile connection refused maps to failed TestResult without leaking credentials", async () => {
  const credentialStore = createMemoryStore();
  const secret = "redacted-test-credential-transport";
  await credentialStore.set("profile:transport", secret);
  const tester = createProviderConnectionTester({
    credentials: createCredentialService({ store: credentialStore, scrubber: createSecretScrubber() }),
    dnsResolver: PUBLIC_RESOLVER,
    e2eMockLlmBaseUrl: "http://127.0.0.1:1/v1",
  });
  const result = await tester.testProfile({
    id: "transport",
    displayName: "Transport",
    providerType: "custom-openai-compat",
    baseUrl: "http://127.0.0.1:1/v1",
    modelId: "mock-model",
    envVar: "COWORK_TRANSPORT_KEY",
    createdAt: "t",
    updatedAt: "t",
    credentialRef: credentialRef("profile:transport"),
  });
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).toLowerCase().includes("authorization"), false);
});

test("profile test failure is isolated and a successful retry works without service restart", async () => {
  const gateway = await startMockOpenAiGateway();
  try {
    const credentialStore = createMemoryStore();
    await credentialStore.set("profile:a", "redacted-test-credential-a");
    await credentialStore.set("profile:b", "redacted-test-credential-b");
    const tester = createProviderConnectionTester({
      credentials: createCredentialService({ store: credentialStore, scrubber: createSecretScrubber() }),
      dnsResolver: PUBLIC_RESOLVER,
      now: (() => {
        let tick = 0;
        return () => `2026-07-13T00:00:0${tick++}.000Z`;
      })(),
      e2eMockLlmBaseUrl: gateway.baseUrl,
    });
    const profileA: ProviderProfile = {
      id: "profile-a",
      displayName: "A",
      providerType: "custom-openai-compat",
      baseUrl: "http://127.0.0.1:1/v1",
      modelId: "mock-model",
      envVar: "COWORK_A_KEY",
      createdAt: "t",
      updatedAt: "t",
      credentialRef: credentialRef("profile:a"),
    };
    const profileB: ProviderProfile = {
      ...profileA,
      id: "profile-b",
      displayName: "B",
      baseUrl: gateway.baseUrl,
      credentialRef: credentialRef("profile:b"),
    };

    const failure = await tester.testProfile(profileA);
    assert.equal(failure.ok, false);
    assert.equal(tester.lastResultFor(profileA.id)?.ok, false);
    assert.equal(tester.lastResultFor(profileB.id), undefined);

    const successB = await tester.testProfile(profileB);
    assert.equal(successB.ok, true);
    assert.equal(tester.lastResultFor(profileB.id)?.ok, true);
    assert.equal(tester.lastResultFor(profileA.id)?.ok, false);

    const correctedA = await tester.testProfile({ ...profileA, baseUrl: gateway.baseUrl });
    assert.equal(correctedA.ok, true);
    assert.equal(tester.lastResultFor(profileA.id)?.ok, true);
    assert.equal(tester.lastResultFor(profileB.id)?.ok, true);
  } finally {
    await gateway.stop();
  }
});

test("unexpected profile test programming errors still reject", async () => {
  const tester = createProviderConnectionTester({
    credentials: {
      resolveInjection: async () => {
        throw new Error("synthetic credential store defect");
      },
    },
    dnsResolver: PUBLIC_RESOLVER,
  });
  await assert.rejects(
    () => tester.testProfile({
      id: "unexpected",
      displayName: "Unexpected",
      providerType: "custom-openai-compat",
      baseUrl: "https://api.example.com/v1",
      modelId: "mock-model",
      envVar: "COWORK_UNEXPECTED_KEY",
      createdAt: "t",
      updatedAt: "t",
      credentialRef: credentialRef("profile:unexpected"),
    }),
    /credential store defect/,
  );
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
