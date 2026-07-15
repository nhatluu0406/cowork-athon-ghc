/**
 * The persisted-settings launch source turns the onboarding settings the user saved into a live
 * launch config — or `null` when onboarding is incomplete (so the tiered start falls back to the
 * settings-only service). It must NEVER read a secret VALUE (only the credential account handle),
 * and it must share the ONE credential store into `service.credentialStore`.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createFirstConfiguredSource,
  createPersistedSettingsSource,
  type PersistedSettingsReader,
} from "../src/service/persisted-settings-source.js";
import type { LiveLaunchConfig } from "../src/service/live-launch-resolver.js";

const CRED_REF = { store: "os", account: "deepseek-acct" } as const;
const WS_ROOT = mkdtempSync(join(tmpdir(), "cghc-ws-"));

function reader(overrides: Partial<{
  workspace: { rootPath: string } | undefined;
  model: { providerID: string; modelID: string } | undefined;
  providers: PersistedSettingsReader["listProviderSettings"] extends () => infer R ? R : never;
}> = {}): PersistedSettingsReader {
  return {
    activeWorkspace: () => ("workspace" in overrides ? overrides.workspace : { rootPath: WS_ROOT }),
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
    dbPath: "C:/x/cowork-ghc.db",
    allowedOrigins: ["app://cowork"],
    binPath: "C:/bin/opencode.exe",
    makeSettingsReader: () => Promise.resolve(r),
    makeCredentialStore,
  });
}

test("assembles a complete custom-provider live config from persisted onboarding settings", async () => {
  const config = (await source(reader())()) as LiveLaunchConfig;
  assert.ok(config, "a complete config must be returned");
  assert.equal(config.workspaceRoot, WS_ROOT);
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
  assert.equal(config.service?.dbPath, "C:/x/cowork-ghc.db");
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

test("reads onboarding settings from SQLite when settings.json was migrated away", async () => {
  const { mkdtempSync, rmSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { db } = await import("@cowork-ghc/service");

  const root = mkdtempSync(join(tmpdir(), "cghc-persist-sqlite-"));
  const dbPath = join(root, "cowork-ghc.db");
  const missingJson = join(root, ".runtime", "settings.json");
  const workspace = mkdtempSync(join(tmpdir(), "cghc-ws-sqlite-"));

  const database = db.openSqliteDatabase({ filePath: dbPath });
  try {
    db.runMigrations(database);
    const document = {
      version: 3,
      general: { theme: "system", verboseLogging: false, telemetryEnabled: false },
      providers: [
        {
          providerId: "custom-openai-compat",
          baseUrl: "https://api.deepseek.com/v1",
          envVar: "DEEPSEEK_API_KEY",
          credentialRef: CRED_REF,
        },
      ],
      modelPreference: {
        default: { providerID: "custom-openai-compat", modelID: "deepseek-chat" },
      },
      providerProfiles: [],
      providerProfilesMigrated: true,
      activeWorkspace: { rootPath: workspace },
    };
    db.createSettingsRepository(database).setJson(
      db.SETTINGS_DOCUMENT_KEY,
      JSON.stringify(document),
      new Date().toISOString(),
    );
  } finally {
    db.closeSqliteDatabase(database);
  }

  assert.equal(existsSync(missingJson), false);

  const launchSource = createPersistedSettingsSource({
    settingsFilePath: missingJson,
    dbPath,
    allowedOrigins: ["app://cowork"],
    binPath: "C:/bin/opencode.exe",
    makeCredentialStore,
  });

  try {
    const config = (await launchSource()) as LiveLaunchConfig;
    assert.ok(config, "SQLite vault settings must assemble a live launch config");
    assert.equal(config.workspaceRoot, workspace);
    assert.equal(config.provider.kind, "custom");
    if (config.provider.kind === "custom") {
      assert.equal(config.provider.baseUrl, "https://api.deepseek.com/v1");
      assert.equal(config.provider.model, "deepseek-chat");
      assert.deepEqual(config.provider.credentialRef, CRED_REF);
    }
    assert.equal(config.service?.dbPath, dbPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
