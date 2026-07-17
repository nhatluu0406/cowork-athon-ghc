/**
 * Task 11 follow-up — MS365 child-env advertisement (flag-gated).
 *
 * Proves, with NO real OpenCode binary / socket / keyring:
 *  1. flag OFF (default, no env var): `buildLiveCoworkOptions` adds NO `CGHC_MS365_*` var to
 *     `startSpec.baseEnv`, and `service` options are passed through untouched (baseline
 *     byte-for-byte unaffected);
 *  2. flag ON (`CGHC_MS365_ENABLED=1`): `startSpec.baseEnv` carries a non-secret
 *     `CGHC_MS365_TOOL_ENDPOINT` naming the loopback MS365 tool-call path, plus
 *     `CGHC_MS365_TOKEN` equal to the SAME `service.clientToken` the builder returns (no new
 *     secret minted — the child reuses the one per-launch loopback token) and the returned
 *     `service.host`/`service.port` match the URL embedded in the endpoint.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLiveCoworkOptions } from "../src/composition/live-launch.js";
import { MS365_TOOL_CALL_PATH } from "../src/ms365/index.js";
import { createCredentialService, createMemoryStore } from "../src/credential/index.js";

const BIN = "C:\\opencode\\opencode.exe";
const WS = "C:\\Users\\test\\Ms365 Workspace";

async function baseInput(port: number) {
  const store = createMemoryStore();
  const credentialService = createCredentialService({ store });
  const ref = await credentialService.store({ providerId: "anthropic", secret: "sk-fake-ms365-000" });
  return {
    workspaceRoot: WS,
    binPath: BIN,
    port,
    launchId: `ms365-${port}`,
    runtimeRoot: "C:\\tmp\\rt-ms365",
    credentialService,
    provider: { kind: "built-in" as const, providerId: "anthropic" as const, credentialRef: ref },
  };
}

test("MS365 child-env: flag OFF adds no CGHC_MS365_* var and leaves baseEnv/service untouched", async () => {
  delete process.env.CGHC_MS365_ENABLED;
  const input = await baseInput(51301);
  const options = await buildLiveCoworkOptions({
    ...input,
    baseEnv: { PATH: "C:\\Windows" },
  });

  assert.equal(options.startSpec.baseEnv?.["CGHC_MS365_ENABLED"], undefined);
  assert.equal(options.startSpec.baseEnv?.["CGHC_MS365_TOOL_ENDPOINT"], undefined);
  assert.equal(options.startSpec.baseEnv?.["CGHC_MS365_TOKEN"], undefined);
  assert.deepEqual(options.startSpec.baseEnv, { PATH: "C:\\Windows" });
  assert.equal(options.service, undefined, "no service options were introduced by the flag");
});

test("MS365 child-env: flag ON advertises the loopback tool endpoint + reuses the loopback token", async () => {
  process.env.CGHC_MS365_ENABLED = "1";
  try {
    const input = await baseInput(51302);
    const options = await buildLiveCoworkOptions(input);

    const baseEnv = options.startSpec.baseEnv;
    assert.equal(baseEnv?.["CGHC_MS365_ENABLED"], "1");
    const endpoint = baseEnv?.["CGHC_MS365_TOOL_ENDPOINT"];
    assert.ok(endpoint, "endpoint var must be present when the flag is on");
    assert.ok(endpoint!.endsWith(MS365_TOOL_CALL_PATH), "endpoint must point at the tool-call path");
    assert.ok(endpoint!.startsWith("http://127.0.0.1:"), "endpoint must be a loopback URL");

    const token = baseEnv?.["CGHC_MS365_TOKEN"];
    assert.ok(token && token.length >= 32, "token must be present and non-trivial");
    // No new secret: the advertised token equals the SAME clientToken the returned service options
    // carry (the exact per-launch loopback token the child already needs to reach this service).
    assert.equal(options.service?.clientToken, token);

    // The endpoint's host:port matches the service options the caller must bind to.
    const url = new URL(endpoint!);
    assert.equal(url.hostname, options.service?.host ?? "127.0.0.1");
    assert.equal(Number(url.port), options.service?.port);
  } finally {
    delete process.env.CGHC_MS365_ENABLED;
  }
});

test("MS365 child-env: flag ON reuses a caller-supplied service host/port/clientToken instead of generating new ones", async () => {
  process.env.CGHC_MS365_ENABLED = "1";
  try {
    const input = await baseInput(51303);
    const options = await buildLiveCoworkOptions({
      ...input,
      service: { host: "127.0.0.1", port: 51399, clientToken: "a".repeat(40) },
    });

    assert.equal(options.service?.host, "127.0.0.1");
    assert.equal(options.service?.port, 51399);
    assert.equal(options.service?.clientToken, "a".repeat(40));
    assert.equal(
      options.startSpec.baseEnv?.["CGHC_MS365_TOOL_ENDPOINT"],
      `http://127.0.0.1:51399${MS365_TOOL_CALL_PATH}`,
    );
    assert.equal(options.startSpec.baseEnv?.["CGHC_MS365_TOKEN"], "a".repeat(40));
  } finally {
    delete process.env.CGHC_MS365_ENABLED;
  }
});
