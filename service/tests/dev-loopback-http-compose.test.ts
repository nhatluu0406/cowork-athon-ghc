/**
 * Developer-only loopback-http override — composition-root wiring (CGHC-010 follow-up).
 *
 * Proves `COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP` threads into the FOUR `createSsrfPolicy`
 * construction sites via `createCoworkService` (compose-service.ts → http-connector-factory.ts,
 * and provider-profiles/provider-connection-tester.ts), OFF by default (baseline byte-for-byte
 * unchanged), and emits a non-secret WARN + boot-diagnostic audit line exactly once when active.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import { createCoworkService, type CoworkServiceOptions } from "../src/index.js";
import { createCredentialService, createMemoryStore } from "../src/credential/index.js";
import type { SettingsFs } from "../src/diagnostics/index.js";
import {
  CUSTOM_OPENAI_COMPAT_ID,
  SsrfBlockedError,
  type DnsResolver,
} from "../src/provider/index.js";
import { createProviderConnectionTester } from "../src/provider-profiles/index.js";
import type { ProviderProfile } from "../src/provider-profiles/types.js";
import { DEV_LOOPBACK_HTTP_ENV_KEY, readDevLoopbackHttpEscape } from "../src/provider/dev-loopback-http.js";

const ENDPOINT_POLICY_ERROR_MESSAGE =
  "The provider endpoint is invalid or not allowed by the connection policy.";

const loopbackResolver: DnsResolver = async () => [{ address: "127.0.0.1", family: 4 }];

function seededSettingsFs(): SettingsFs {
  let data: string | undefined;
  return {
    read: () => Promise.resolve(data),
    write: (d) => {
      data = d;
      return Promise.resolve();
    },
  };
}

function bootOptions(overrides?: Partial<CoworkServiceOptions>): CoworkServiceOptions {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "cowork-dev-loopback-"));
  return {
    credentialStore: createMemoryStore(),
    settingsFs: seededSettingsFs(),
    dnsResolver: loopbackResolver,
    conversationsDir: path.join(stateDir, "conversations"),
    skillsStateFilePath: path.join(stateDir, "skills-enabled.json"),
    agentStoreFilePath: path.join(stateDir, "agents.json"),
    taskStoreFilePath: path.join(stateDir, "tasks.json"),
    ...overrides,
  };
}

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

test("flag unset: providerPort.configureEndpoint refuses http://127.0.0.1:8080 (baseline unchanged)", async () => {
  await withEnv(undefined, async () => {
    const composed = await createCoworkService(bootOptions());
    await assert.rejects(
      () =>
        composed.deps.providerPort.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, {
          baseUrl: "http://127.0.0.1:8080",
        }),
      (err: unknown) => err instanceof SsrfBlockedError && err.reason === "scheme_not_https",
    );
  });
});

test("flag ON: providerPort.configureEndpoint allows http://127.0.0.1:8080", async () => {
  await withEnv("1", async () => {
    const diagnostics: string[] = [];
    const composed = await createCoworkService(
      bootOptions({ onBootDiagnostic: (line) => diagnostics.push(line) }),
    );
    await composed.deps.providerPort.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, {
      baseUrl: "http://127.0.0.1:8080",
    });
    assert.equal(
      composed.deps.providerPort.baseUrlFor(CUSTOM_OPENAI_COMPAT_ID),
      "http://127.0.0.1:8080",
    );

    // A non-secret WARN/audit banner is emitted exactly once at composition when the override is
    // active — no secret, no request-scoped value, just the honest "override is active" trace.
    const banners = diagnostics.filter((line) => line.includes("DEV loopback-http override ACTIVE"));
    assert.equal(banners.length, 1, `expected exactly one banner, got: ${JSON.stringify(diagnostics)}`);
  });
});

test("flag ON: private 10.0.0.1 still refused through providerPort.configureEndpoint", async () => {
  await withEnv("1", async () => {
    const composed = await createCoworkService(bootOptions());
    await assert.rejects(
      () =>
        composed.deps.providerPort.configureEndpoint(CUSTOM_OPENAI_COMPAT_ID, {
          baseUrl: "http://10.0.0.1",
        }),
      (err: unknown) => err instanceof SsrfBlockedError && err.reason === "private",
    );
  });
});

test("flag unset: no banner is emitted (composition is byte-for-byte unchanged)", async () => {
  await withEnv(undefined, async () => {
    const diagnostics: string[] = [];
    await createCoworkService(bootOptions({ onBootDiagnostic: (line) => diagnostics.push(line) }));
    assert.equal(diagnostics.filter((l) => l.includes("DEV loopback-http")).length, 0);
  });
});

function loopbackProfile(): ProviderProfile {
  return {
    id: "p1",
    displayName: "Local GW",
    providerType: "custom-openai-compat",
    // An obscure loopback port nothing listens on: proves the SSRF gate was cleared (the
    // request reaches a real connect attempt) without depending on a real server.
    baseUrl: "http://127.0.0.1:18734/v1",
    modelId: "local-model",
    envVar: "COWORK_DEV_LOOPBACK_TEST_KEY",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
  };
}

async function testerFor(loopbackEscape: boolean) {
  const store = createMemoryStore();
  const credentials = createCredentialService({ store });
  const ref = await credentials.store({ providerId: "custom-openai-compat", secret: "sk-fake-dev-000" });
  const profile = { ...loopbackProfile(), credentialRef: ref };
  const tester = createProviderConnectionTester({
    credentials,
    dnsResolver: loopbackResolver,
    loopbackEscape,
  });
  return { tester, profile };
}

test("provider-connection-tester (site 3): flag OFF refuses the loopback-http profile via SSRF", async () => {
  const { tester, profile } = await testerFor(false);
  const result = await tester.testProfile(profile);
  assert.equal(result.ok, false);
  assert.equal(result.error?.message, ENDPOINT_POLICY_ERROR_MESSAGE);
});

test("provider-connection-tester (site 3): flag ON clears the SSRF gate for the loopback-http profile", async () => {
  const { tester, profile } = await testerFor(true);
  const result = await tester.testProfile(profile);
  assert.equal(result.ok, false, "nothing listens on the test port, so the probe itself still fails");
  assert.notEqual(
    result.error?.message,
    ENDPOINT_POLICY_ERROR_MESSAGE,
    "failure must come from the connect attempt, not the SSRF policy",
  );
});

test("provider-connection-tester (site 3): env threads through readDevLoopbackHttpEscape", async () => {
  await withEnv("1", async () => {
    assert.equal(readDevLoopbackHttpEscape(), true);
  });
  await withEnv(undefined, async () => {
    assert.equal(readDevLoopbackHttpEscape(), false);
  });
});
