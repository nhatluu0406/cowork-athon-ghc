/**
 * CGHC-028 Wave B2b — the env-driven launch source reads explicit launch env HONESTLY.
 *
 * With an INJECTED fake credential store (never the real keyring) this proves
 * `createEnvLaunchSource`:
 *   - `COWORK_WORKSPACE_ROOT` unset → null (app not configured → honest not-connected);
 *   - a complete built-in / custom selection → a config carrying the workspace, the parsed
 *     provider, a credential service, and the SAME store shared into `service.credentialStore`
 *     (the one-store invariant);
 *   - a workspace set but an incomplete provider → a typed EnvLaunchConfigError (no fake).
 * No secret value is read; only the non-secret account handle. No OpenCode is spawned.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { credential } from "@cowork-ghc/service";
import { createEnvLaunchSource, EnvLaunchConfigError } from "../src/service/env-launch-source.js";

function fakeStore(): credential.CredentialStore {
  return {
    kind: "memory",
    set: async () => undefined,
    get: async () => null,
    delete: async () => false,
  };
}

test("no COWORK_WORKSPACE_ROOT yields null (not configured → honest not-connected)", async () => {
  const source = createEnvLaunchSource({ env: {}, makeCredentialStore: async () => fakeStore() });
  assert.equal(await source(), null);
});

test("a complete built-in selection yields a config sharing the ONE store", async () => {
  const store = fakeStore();
  const source = createEnvLaunchSource({
    appRoot: "C:/install",
    env: {
      COWORK_WORKSPACE_ROOT: "C:/work/space",
      COWORK_PROVIDER_KIND: "built-in",
      COWORK_PROVIDER_ID: "openai",
      COWORK_CREDENTIAL_ACCOUNT: "provider:openai",
    },
    makeCredentialStore: async () => store,
  });

  const config = await source();
  assert.ok(config, "a config is produced");
  assert.equal(config.workspaceRoot, "C:/work/space");
  assert.equal(config.appRoot, "C:/install");
  assert.equal(config.provider.kind, "built-in");
  assert.equal(config.provider.credentialRef.account, "provider:openai");
  assert.ok(config.credentialService, "a credential service is built");
  assert.equal(config.service?.credentialStore, store, "the SAME store backs both (one store)");
});

test("a complete custom selection parses base URL + model + env var", async () => {
  const source = createEnvLaunchSource({
    env: {
      COWORK_WORKSPACE_ROOT: "C:/ws",
      COWORK_PROVIDER_KIND: "custom",
      COWORK_PROVIDER_BASE_URL: "https://api.example.com/v1",
      COWORK_PROVIDER_MODEL: "some-model",
      COWORK_PROVIDER_ENV_VAR: "EXAMPLE_API_KEY",
      COWORK_CREDENTIAL_ACCOUNT: "provider:custom",
    },
    makeCredentialStore: async () => fakeStore(),
  });

  const config = await source();
  assert.ok(config);
  assert.equal(config.provider.kind, "custom");
  if (config.provider.kind === "custom") {
    assert.equal(config.provider.baseUrl, "https://api.example.com/v1");
    assert.equal(config.provider.model, "some-model");
    assert.equal(config.provider.envVar, "EXAMPLE_API_KEY");
  }
});

test("an explicit binPath + runtimeRoot (packaged) flow through to the launch config", async () => {
  const source = createEnvLaunchSource({
    binPath: "C:/install/resources/opencode/opencode.exe",
    runtimeRoot: "C:/Users/x/AppData/Roaming/Cowork GHC",
    env: {
      COWORK_WORKSPACE_ROOT: "C:/ws",
      COWORK_PROVIDER_KIND: "built-in",
      COWORK_PROVIDER_ID: "openai",
      COWORK_CREDENTIAL_ACCOUNT: "provider:openai",
    },
    makeCredentialStore: async () => fakeStore(),
  });

  const config = await source();
  assert.ok(config);
  assert.equal(config.binPath, "C:/install/resources/opencode/opencode.exe");
  assert.equal(config.runtimeRoot, "C:/Users/x/AppData/Roaming/Cowork GHC");
});

test("env COWORK_OPENCODE_BIN / COWORK_RUNTIME_ROOT override the explicit options", async () => {
  const source = createEnvLaunchSource({
    binPath: "C:/install/resources/opencode/opencode.exe",
    runtimeRoot: "C:/userdata",
    env: {
      COWORK_WORKSPACE_ROOT: "C:/ws",
      COWORK_PROVIDER_KIND: "built-in",
      COWORK_PROVIDER_ID: "openai",
      COWORK_CREDENTIAL_ACCOUNT: "provider:openai",
      COWORK_OPENCODE_BIN: "D:/override/opencode.exe",
      COWORK_RUNTIME_ROOT: "D:/override/runtime",
    },
    makeCredentialStore: async () => fakeStore(),
  });

  const config = await source();
  assert.ok(config);
  assert.equal(config.binPath, "D:/override/opencode.exe");
  assert.equal(config.runtimeRoot, "D:/override/runtime");
});

test("a workspace set with no credential account throws a typed EnvLaunchConfigError", async () => {
  const source = createEnvLaunchSource({
    env: { COWORK_WORKSPACE_ROOT: "C:/ws", COWORK_PROVIDER_KIND: "built-in", COWORK_PROVIDER_ID: "openai" },
    makeCredentialStore: async () => fakeStore(),
  });
  await assert.rejects(source(), (err: unknown) => err instanceof EnvLaunchConfigError);
});

test("an unknown provider kind is rejected honestly", async () => {
  const source = createEnvLaunchSource({
    env: {
      COWORK_WORKSPACE_ROOT: "C:/ws",
      COWORK_PROVIDER_KIND: "bogus",
      COWORK_CREDENTIAL_ACCOUNT: "provider:x",
    },
    makeCredentialStore: async () => fakeStore(),
  });
  await assert.rejects(source(), (err: unknown) => err instanceof EnvLaunchConfigError);
});
