import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLiveCoworkOptions } from "../src/composition/live-launch.js";
import { MS365_TOOL_CALL_PATH } from "../src/ms365/index.js";
import { createCredentialService, createMemoryStore } from "../src/credential/index.js";
import { OpencodeSupervisor } from "../src/runtime/supervisor.js";
import {
  FakeChild,
  recordingSpawner,
  toggleHealthProbe,
  fixedTimesProbe,
  fixedPortChecker,
} from "./runtime-supervisor-fakes.js";
import { OPENCODE_PIN } from "@cowork-ghc/runtime";

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

test("live-launch advertises the loopback tool endpoint + a distinct scoped token", async () => {
  const options = await buildLiveCoworkOptions(await baseInput(51302));
  const baseEnv = options.startSpec.baseEnv;
  const endpoint = baseEnv?.["CGHC_MS365_TOOL_ENDPOINT"];
  assert.ok(endpoint?.endsWith(MS365_TOOL_CALL_PATH), "endpoint points at tool-call path");
  assert.ok(endpoint?.startsWith("http://127.0.0.1:"), "loopback URL");

  const token = baseEnv?.["CGHC_MS365_TOKEN"];
  assert.ok(token && token.length >= 32, "token present and non-trivial");
  assert.notEqual(token, options.service?.clientToken, "child token != full client token");
  assert.ok(
    options.service?.pathScopedTokens?.some(
      (e) => e.token === token && e.paths.includes(MS365_TOOL_CALL_PATH),
    ),
    "token registered as scoped to MS365_TOOL_CALL_PATH",
  );
  assert.ok(
    options.startSpec.extraSecretValues?.includes(token!),
    "scoped token registered as an extra secret value for redaction",
  );
  const url = new URL(endpoint!);
  assert.equal(url.hostname, options.service?.host ?? "127.0.0.1");
  assert.equal(Number(url.port), options.service?.port);
});

test("scoped MS365 token is redacted in the supervisor spawn log", async () => {
  const root = mkdtempSync(join(tmpdir(), "cghc-ms365-redact-"));
  try {
    const options = await buildLiveCoworkOptions(await baseInput(51305));
    const token = options.startSpec.baseEnv?.["CGHC_MS365_TOKEN"];
    assert.ok(token && token.length >= 32, "precondition: a scoped token was minted");

    const { spawner } = recordingSpawner(new FakeChild(4321));
    const logs: string[] = [];
    const sup = new OpencodeSupervisor({
      root,
      resolveInjections: async () => [],
      spawner,
      healthProbe: toggleHealthProbe(OPENCODE_PIN).probe,
      processTimesProbe: fixedTimesProbe(),
      portChecker: fixedPortChecker(true),
      log: (l) => logs.push(l),
      pollIntervalMs: 5,
    });
    await sup.start({
      binPath: BIN,
      cwd: WS,
      port: 51305,
      dataHome: join(root, "xdg", "data"),
      configDir: join(root, "config", "opencode"),
      injectionRequests: [],
      baseEnv: options.startSpec.baseEnv,
      ...(options.startSpec.extraSecretValues !== undefined
        ? { extraSecretValues: options.startSpec.extraSecretValues }
        : {}),
    });
    await sup.stop();

    const joined = logs.join("\n");
    assert.ok(!joined.includes(token!), "raw scoped token must never appear in the spawn log");
    assert.ok(joined.includes("<redacted>"), "the logged env snapshot masks the scoped token");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
