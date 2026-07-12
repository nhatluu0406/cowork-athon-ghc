/**
 * CGHC-028 Wave B2b — the shell resolver wires `buildLiveCoworkOptions` with an honest fallback.
 *
 * With an INJECTED fake source (no real settings/keyring) and an injected build seam this proves
 * `createLiveOptionsResolver`:
 *   - a source that yields a config → calls the builder with that config and returns its options;
 *   - a source that yields null / undefined → throws ServiceLaunchNotConfiguredError (the honest
 *     not-connected signal the ServiceController turns into the empty handshake), builder NOT
 *     called, no fake ready.
 * A final case runs the REAL `buildLiveCoworkOptions` on a built-in-provider config (a fixed port
 * so no socket is bound, a fake credential service) to prove the yielded options carry the pinned
 * OpenCode binary + workspaceId — without spawning any OpenCode child.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildLiveCoworkOptions,
  type BuildLiveCoworkInput,
  type CredentialService,
  type LiveCoworkServiceOptions,
} from "@cowork-ghc/service";
import { createLiveOptionsResolver } from "../src/service/live-launch-resolver.js";
import { ServiceLaunchNotConfiguredError } from "../src/service/launch-config.js";

const OPTIONS_SENTINEL = { workspaceId: "C:/ws" } as unknown as LiveCoworkServiceOptions;

function fakeConfig(): BuildLiveCoworkInput {
  return {
    workspaceRoot: "C:/ws",
    credentialService: {} as unknown as CredentialService,
    provider: {
      kind: "built-in",
      providerId: "openai",
      credentialRef: { account: "provider:openai" } as never,
    },
    appRoot: "C:/app",
  };
}

test("a source that yields a config calls the builder and returns its options", async () => {
  const config = fakeConfig();
  let builtWith: BuildLiveCoworkInput | null = null;
  const resolve = createLiveOptionsResolver(
    () => config,
    async (input) => {
      builtWith = input;
      return OPTIONS_SENTINEL;
    },
  );

  const options = await resolve();
  assert.equal(builtWith, config, "the resolved config is passed straight to the builder");
  assert.equal(options, OPTIONS_SENTINEL);
});

test("an async source is awaited before building", async () => {
  const config = fakeConfig();
  const resolve = createLiveOptionsResolver(
    async () => config,
    async () => OPTIONS_SENTINEL,
  );
  assert.equal(await resolve(), OPTIONS_SENTINEL);
});

test("a null source throws ServiceLaunchNotConfiguredError and never builds", async () => {
  let builderCalls = 0;
  const resolve = createLiveOptionsResolver(
    () => null,
    async () => {
      builderCalls += 1;
      return OPTIONS_SENTINEL;
    },
  );
  await assert.rejects(resolve(), (err: unknown) => err instanceof ServiceLaunchNotConfiguredError);
  assert.equal(builderCalls, 0, "no config → no build, no fake ready");
});

test("an undefined source is treated the same as null (honest not-connected)", async () => {
  const resolve = createLiveOptionsResolver(
    () => undefined,
    async () => OPTIONS_SENTINEL,
  );
  await assert.rejects(resolve(), (err: unknown) => err instanceof ServiceLaunchNotConfiguredError);
});

test("the REAL builder yields options with the pinned binary + workspaceId (no spawn)", async () => {
  const config: BuildLiveCoworkInput = {
    ...fakeConfig(),
    workspaceRoot: "C:/work/space",
    appRoot: "C:/install",
    port: 61999, // fixed → allocateLoopbackPort is not called, no socket is bound
  };
  const resolve = createLiveOptionsResolver(() => config, buildLiveCoworkOptions);

  const options = await resolve();
  assert.equal(options.workspaceId, "C:/work/space");
  assert.equal(options.startSpec.port, 61999);
  assert.match(options.startSpec.binPath, /opencode\.exe$/);
  assert.ok(options.supervisor, "a supervisor is assembled but NOT started");
});
