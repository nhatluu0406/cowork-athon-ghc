/**
 * The persisted-settings launch source turns the onboarding settings the user saved into a live
 * launch config — or `null` when onboarding is incomplete (so the tiered start falls back to the
 * settings-only service). It must NEVER read a secret VALUE (only the credential account handle),
 * and it must share the ONE credential store into `service.credentialStore`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createFirstConfiguredSource,
  createPersistedSettingsSource,
  type PersistedSettingsReader,
} from "../src/service/persisted-settings-source.js";
import type { LiveLaunchConfig } from "../src/service/live-launch-resolver.js";

const CRED_REF = { store: "os", account: "deepseek-acct" } as const;

function reader(overrides: Partial<{
  workspace: { rootPath: string } | undefined;
  model: { providerID: string; modelID: string } | undefined;
  providers: PersistedSettingsReader["listProviderSettings"] extends () => infer R ? R : never;
}> = {}): PersistedSettingsReader {
  return {
    activeWorkspace: () => ("workspace" in overrides ? overrides.workspace : { rootPath: "C:/ws" }),
    defaultModel: () =>
      "model" in overrides ? overrides.model : { providerID: "deepseek", modelID: "deepseek-chat" },
    listProviderSettings: () =>
      overrides.providers ?? [
        { providerId: "deepseek", credentialRef: CRED_REF, baseUrl: "https://api.deepseek.com", envVar: "DEEPSEEK_API_KEY" },
      ],
  };
}

const fakeStore = { async get() { return undefined; }, async set() {}, async delete() { return true; } };
const makeCredentialStore = () => Promise.resolve(fakeStore as never);

function source(r: PersistedSettingsReader) {
  return createPersistedSettingsSource({
    settingsFilePath: "C:/x/.runtime/settings.json",
    allowedOrigins: ["app://cowork"],
    binPath: "C:/bin/opencode.exe",
    makeSettingsReader: () => Promise.resolve(r),
    makeCredentialStore,
  });
}

test("assembles a complete custom-provider live config from persisted onboarding settings", async () => {
  const config = (await source(reader())()) as LiveLaunchConfig;
  assert.ok(config, "a complete config must be returned");
  assert.equal(config.workspaceRoot, "C:/ws");
  assert.equal(config.provider.kind, "custom");
  if (config.provider.kind === "custom") {
    assert.equal(config.provider.baseUrl, "https://api.deepseek.com");
    assert.equal(config.provider.model, "deepseek-chat");
    assert.equal(config.provider.envVar, "DEEPSEEK_API_KEY");
    assert.deepEqual(config.provider.credentialRef, CRED_REF);
  }
  // The live service must allow the renderer origin and share the settings file + the ONE store.
  assert.deepEqual(config.service?.allowedOrigins, ["app://cowork"]);
  assert.equal(config.service?.settingsFilePath, "C:/x/.runtime/settings.json");
  assert.equal(config.service?.credentialStore, fakeStore);
});

test("returns null when no workspace is granted", async () => {
  assert.equal(await source(reader({ workspace: undefined }))(), null);
});

test("returns null when there is no default model", async () => {
  assert.equal(await source(reader({ model: undefined }))(), null);
});

test("returns null when the active provider lacks a bound key / baseUrl / envVar", async () => {
  const incomplete = [{ providerId: "deepseek", baseUrl: "https://api.deepseek.com" }]; // no credentialRef/envVar
  assert.equal(await source(reader({ providers: incomplete }))(), null);
});

test("returns null when no provider matches the default model's providerID", async () => {
  const other = [{ providerId: "openai", credentialRef: CRED_REF, baseUrl: "https://x", envVar: "K" }];
  assert.equal(await source(reader({ providers: other }))(), null);
});

test("first-configured source returns the first non-null config and stops", async () => {
  let secondCalled = false;
  const chain = createFirstConfiguredSource([
    source(reader()),
    () => {
      secondCalled = true;
      return Promise.resolve(null);
    },
  ]);
  const config = await chain();
  assert.ok(config);
  assert.equal(secondCalled, false, "the second source must not run once the first yields a config");
});

test("first-configured source falls through to the next when earlier ones yield null", async () => {
  const chain = createFirstConfiguredSource([() => Promise.resolve(null), source(reader())]);
  assert.ok(await chain());
});
