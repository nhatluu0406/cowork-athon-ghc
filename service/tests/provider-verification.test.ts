/**
 * Provider verification fingerprint + persistence tests.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryStore } from "../src/credential/memory-store.js";
import { credentialRef } from "../src/credential/store.js";
import { openSettingsStore } from "../src/diagnostics/settings-store.js";
import {
  computeVerifiedTargetFingerprint,
  createProviderProfileStore,
  isVerificationCurrent,
} from "../src/provider-profiles/index.js";

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

test("fingerprint is stable for same endpoint/model/revision and never encodes raw key", () => {
  const a = computeVerifiedTargetFingerprint({
    baseUrl: "https://api.example.com/v1",
    modelId: "mock-model",
    credentialRevision: 2,
  });
  const b = computeVerifiedTargetFingerprint({
    baseUrl: " https://api.example.com/v1 ",
    modelId: "mock-model",
    credentialRevision: 2,
  });
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.doesNotMatch(a, /sk-|api[_-]?key|secret/i);
  assert.equal(
    isVerificationCurrent(a, {
      baseUrl: "https://api.example.com/v1",
      modelId: "mock-model",
      credentialRevision: 2,
    }),
    true,
  );
  assert.equal(
    isVerificationCurrent(a, {
      baseUrl: "https://api.example.com/v1",
      modelId: "other-model",
      credentialRevision: 2,
    }),
    false,
  );
});

test("persists verified state and invalidates on endpoint/model/credential revision change", async () => {
  const { store, backing } = await openTestStore();
  const profiles = createProviderProfileStore({ store });
  const created = await profiles.create({
    displayName: "Mock",
    providerType: "custom-openai-compat",
    baseUrl: "https://api.example.com/v1",
    modelId: "mock-model",
  });
  await profiles.setCredentialRef(created.id, credentialRef(`profile:${created.id}`));
  await profiles.recordConnectionVerification(created.id, true, "2026-07-15T01:00:00.000Z");

  let view = profiles.listViews().find((p) => p.id === created.id);
  assert.ok(view);
  assert.equal(view.verificationCurrent, true);
  assert.equal(view.lastVerifiedOk, true);
  assert.equal(view.lastVerifiedAt, "2026-07-15T01:00:00.000Z");

  const raw = JSON.parse(String(backing.data));
  const persisted = raw.providerProfiles.find((p: { id: string }) => p.id === created.id);
  assert.ok(persisted.verifiedTargetFingerprint);
  assert.equal(typeof persisted.credentialRevision, "number");
  assert.doesNotMatch(JSON.stringify(persisted), /sk-|raw.?key|apiKey/i);

  await profiles.update(created.id, { modelId: "other-model" });
  view = profiles.listViews().find((p) => p.id === created.id);
  assert.ok(view);
  assert.equal(view.verificationCurrent, false);
  assert.equal(view.lastVerifiedOk, undefined);

  await profiles.recordConnectionVerification(created.id, true, "2026-07-15T02:00:00.000Z");
  view = profiles.listViews().find((p) => p.id === created.id);
  assert.equal(view?.verificationCurrent, true);

  await profiles.setCredentialRef(created.id, credentialRef(`profile:${created.id}`));
  view = profiles.listViews().find((p) => p.id === created.id);
  assert.equal(view?.verificationCurrent, false);
  assert.equal(view?.lastVerifiedOk, undefined);
});

test("memory credential store still isolates profile secrets from settings JSON", async () => {
  const credentials = createMemoryStore();
  await credentials.set("profile:p1", "sk-live-secret-value");
  const { store, backing } = await openTestStore();
  const profiles = createProviderProfileStore({ store });
  const created = await profiles.create({
    displayName: "Sec",
    providerType: "custom-openai-compat",
    baseUrl: "https://api.example.com/v1",
    modelId: "mock-model",
  });
  await profiles.setCredentialRef(created.id, credentialRef(`profile:${created.id}`));
  await profiles.recordConnectionVerification(created.id, false);
  assert.doesNotMatch(String(backing.data), /sk-live-secret-value/);
});
