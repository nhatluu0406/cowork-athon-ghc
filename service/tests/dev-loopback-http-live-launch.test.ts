/**
 * Developer-only loopback-http override — live-launch custom-provider validation (CGHC-010
 * follow-up, site 4: `composition/live-launch.ts`). This is the DIRECT blocker the brief calls
 * out: `buildLiveCoworkOptions` SSRF-validates a custom provider `baseUrl` before spawning the
 * child. No real spawn/network happens here — only the injected `dnsResolver` seam (unused for
 * a literal IP) and the SSRF policy construction are exercised.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLiveCoworkOptions } from "../src/composition/live-launch.js";
import { SsrfBlockedError } from "../src/provider/index.js";
import { createCredentialService, createMemoryStore } from "../src/credential/index.js";
import { DEV_LOOPBACK_HTTP_ENV_KEY } from "../src/provider/dev-loopback-http.js";

const WS = "C:\\Users\\test\\Live Workspace";
const BIN = "C:\\opencode\\opencode.exe";

async function withEnv(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const prior = process.env[DEV_LOOPBACK_HTTP_ENV_KEY];
  if (value === undefined) delete process.env[DEV_LOOPBACK_HTTP_ENV_KEY];
  else process.env[DEV_LOOPBACK_HTTP_ENV_KEY] = value;
  try {
    await fn();
  } finally {
    if (prior === undefined) delete process.env[DEV_LOOPBACK_HTTP_ENV_KEY];
    else process.env[DEV_LOOPBACK_HTTP_ENV_KEY] = prior;
  }
}

async function credRef() {
  const store = createMemoryStore();
  const credentialService = createCredentialService({ store });
  const ref = await credentialService.store({ providerId: "custom", secret: "sk-fake-live-000" });
  return { credentialService, ref };
}

test("flag unset: buildLiveCoworkOptions refuses http://127.0.0.1:8080 (baseline unchanged)", async () => {
  await withEnv(undefined, async () => {
    const { credentialService, ref } = await credRef();
    await assert.rejects(
      buildLiveCoworkOptions({
        workspaceRoot: WS,
        binPath: BIN,
        port: 51999,
        credentialService,
        provider: {
          kind: "custom",
          baseUrl: "http://127.0.0.1:8080",
          model: "local-model",
          envVar: "LOCAL_GW_KEY",
          credentialRef: ref,
        },
      }),
      (err: unknown) => err instanceof SsrfBlockedError && err.reason === "scheme_not_https",
    );
  });
});

test("flag ON: buildLiveCoworkOptions allows http://127.0.0.1:8080", async () => {
  await withEnv("1", async () => {
    const { credentialService, ref } = await credRef();
    const options = await buildLiveCoworkOptions({
      workspaceRoot: WS,
      binPath: BIN,
      port: 52000,
      credentialService,
      provider: {
        kind: "custom",
        baseUrl: "http://127.0.0.1:8080",
        model: "local-model",
        envVar: "LOCAL_GW_KEY",
        credentialRef: ref,
      },
    });
    assert.equal(options.startSpec.providerConfig?.baseUrl, "http://127.0.0.1:8080");
  });
});

test("flag ON: buildLiveCoworkOptions still refuses a private (non-loopback) http target", async () => {
  await withEnv("1", async () => {
    const { credentialService, ref } = await credRef();
    await assert.rejects(
      buildLiveCoworkOptions({
        workspaceRoot: WS,
        binPath: BIN,
        port: 52001,
        credentialService,
        provider: {
          kind: "custom",
          baseUrl: "http://10.0.0.1:8080",
          model: "local-model",
          envVar: "LOCAL_GW_KEY",
          credentialRef: ref,
        },
      }),
      (err: unknown) => err instanceof SsrfBlockedError && err.reason === "private",
    );
  });
});
