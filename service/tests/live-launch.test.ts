/**
 * CGHC-028 Wave B2a — the shell-friendly live-options builder (`buildLiveCoworkOptions`) + the
 * supervisor barrel exports.
 *
 * Proves, with NO real OpenCode binary / socket / keyring:
 *  1. the supervisor + its option/spec types + default seams are importable from the top-level
 *     `@cowork-ghc/service` barrel and a supervisor is constructible with an injected fake spawner;
 *  2. `buildLiveCoworkOptions` maps minimal inputs to a valid `LiveCoworkServiceOptions`
 *     (workspaceId/cwd, a coherent startSpec with env-var injection requests + pinned binary), and
 *     wires `seedScrubber` to `deps.credentialService.resolveInjection` (FIX-6, one credential store);
 *  3. a custom base URL is SSRF-validated (private target refused) and a valid one yields a config;
 *  4. the BUILT options feed straight into `startLiveCoworkService` and round-trip (session create +
 *     health) against the Wave A2 fake OpenCode server — the whole live path assembles;
 *  5. bad inputs (missing/relative workspace, incoherent provider) fail typed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OpencodeSupervisor,
  buildLiveCoworkOptions,
  startLiveCoworkService,
  LiveLaunchConfigError,
  fetchHealthProbe,
  netPortChecker,
  nodeChildSpawner,
  RuntimeSpawnError,
  type SupervisorStartSpec,
  type CoworkServiceDeps,
} from "../src/index.js";
import { SsrfBlockedError } from "../src/provider/index.js";
import { createCredentialService, createMemoryStore, createSecretScrubber } from "../src/credential/index.js";
import type { SettingsFs } from "../src/diagnostics/index.js";
import {
  FakeChild,
  recordingSpawner,
  fixedTimesProbe,
  fixedPortChecker,
} from "./runtime-supervisor-fakes.js";
import { startFakeOpencodeServer } from "./opencode-fake-server.js";

const BIN = "C:\\opencode\\opencode.exe";
const WS = "C:\\Users\\test\\Live Workspace";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "cghc-b2a-"));
}

function memorySettingsFs(): SettingsFs {
  let data: string | undefined;
  return {
    read: () => Promise.resolve(data),
    write: (d) => {
      data = d;
      return Promise.resolve();
    },
  };
}

test("barrel: the supervisor + default seams are importable and a supervisor is constructible", () => {
  // Production default seams are exported (referenced so an accidental removal fails the build).
  assert.equal(typeof nodeChildSpawner, "function");
  assert.equal(typeof fetchHealthProbe, "function");
  assert.equal(typeof netPortChecker, "function");
  assert.equal(typeof RuntimeSpawnError, "function");

  const sup = new OpencodeSupervisor({
    root: "C:\\tmp\\root",
    resolveInjections: async () => [],
    spawner: recordingSpawner(new FakeChild()).spawner, // injected fake — never a real spawn
    healthProbe: fetchHealthProbe(),
    processTimesProbe: fixedTimesProbe(),
    portChecker: fixedPortChecker(true),
  });
  assert.ok(sup instanceof OpencodeSupervisor);
  assert.equal(sup.baseUrl, null, "no child before start()");
  assert.equal(sup.isAlive(), false);
});

test("buildLiveCoworkOptions: built-in → valid options with a coherent startSpec + seeded scrubber", async () => {
  const store = createMemoryStore();
  const credentialService = createCredentialService({ store });
  const ref = await credentialService.store({ providerId: "anthropic", secret: "sk-fake-anthropic-key-000" });

  const options = await buildLiveCoworkOptions({
    workspaceRoot: WS,
    binPath: BIN,
    port: 51234,
    launchId: "test-launch",
    runtimeRoot: "C:\\tmp\\rt",
    credentialService,
    provider: { kind: "built-in", providerId: "anthropic", credentialRef: ref },
  });

  // workspaceId + cwd map from the workspace root.
  assert.equal(options.workspaceId, WS);
  assert.equal(options.startSpec.cwd, WS);
  assert.equal(options.startSpec.binPath, BIN);
  assert.equal(options.startSpec.port, 51234);
  assert.ok(options.supervisor instanceof OpencodeSupervisor);

  // One injection request carrying the handle + the confirmed built-in env var (no secret here).
  assert.equal(options.startSpec.injectionRequests.length, 1);
  const req = options.startSpec.injectionRequests[0];
  assert.equal(req?.ref.account, ref.account);
  assert.equal(req?.spec.primaryEnvVar, "ANTHROPIC_API_KEY");
  // A built-in provider needs no opencode.json provider block.
  assert.equal(options.startSpec.providerConfig, undefined);

  // Per-launch data/config dirs live under the runtime root, not the workspace.
  assert.ok(options.startSpec.dataHome.includes(join(".runtime", "opencode", "test-launch")));
  assert.ok(options.startSpec.configDir.endsWith(join("test-launch", "config")));

  // seedScrubber is wired to deps.credentialService.resolveInjection (FIX-6): invoking it with a
  // fake credentialService registers the resolved VALUE with the shared scrubber.
  assert.equal(typeof options.seedScrubber, "function");
  const scrubber = createSecretScrubber();
  let resolvedWith: { account: string; envVar: string } | null = null;
  const fakeDeps = {
    credentialService: {
      resolveInjection: async (r: { account: string }, s: { primaryEnvVar: string }) => {
        resolvedWith = { account: r.account, envVar: s.primaryEnvVar };
        scrubber.register("sk-fake-anthropic-key-000");
        return { envVar: s.primaryEnvVar, value: "sk-fake-anthropic-key-000" };
      },
    },
  } as unknown as CoworkServiceDeps;
  await options.seedScrubber?.(scrubber, fakeDeps);
  assert.deepEqual(resolvedWith, { account: ref.account, envVar: "ANTHROPIC_API_KEY" });
  assert.ok(
    !scrubber.scrub("leak sk-fake-anthropic-key-000 here").includes("sk-fake-anthropic-key-000"),
    "seedScrubber registered the real key value with the shared scrubber",
  );
});

test("buildLiveCoworkOptions: custom endpoint is SSRF-validated (private refused, public accepted)", async () => {
  const store = createMemoryStore();
  const credentialService = createCredentialService({ store });
  const ref = await credentialService.store({ providerId: "custom", secret: "sk-fake-custom-000" });

  // Private/loopback target refused at the boundary with a typed SSRF error (no DNS for literal IP).
  await assert.rejects(
    buildLiveCoworkOptions({
      workspaceRoot: WS,
      binPath: BIN,
      port: 51235,
      credentialService,
      provider: {
        kind: "custom",
        baseUrl: "https://10.0.0.1/v1",
        model: "deepseek-chat",
        envVar: "DEEPSEEK_API_KEY",
        credentialRef: ref,
      },
    }),
    SsrfBlockedError,
  );

  // A public https endpoint is accepted and yields a non-secret opencode.json provider config.
  const options = await buildLiveCoworkOptions({
    workspaceRoot: WS,
    binPath: BIN,
    port: 51236,
    credentialService,
    provider: {
      kind: "custom",
      providerId: "deepseek",
      baseUrl: "https://8.8.8.8/v1",
      model: "deepseek-chat",
      envVar: "DEEPSEEK_API_KEY",
      credentialRef: ref,
    },
  });
  assert.equal(options.startSpec.injectionRequests[0]?.spec.primaryEnvVar, "DEEPSEEK_API_KEY");
  assert.equal(options.startSpec.providerConfig?.baseUrl, "https://8.8.8.8/v1");
  assert.equal(options.startSpec.providerConfig?.envVar, "DEEPSEEK_API_KEY");
  assert.deepEqual(options.startSpec.providerConfig?.models, ["deepseek-chat"]);
});

test("buildLiveCoworkOptions: bad inputs fail typed", async () => {
  const credentialService = createCredentialService({ store: createMemoryStore() });
  const ref = await credentialService.store({ providerId: "anthropic", secret: "sk-x-000" });
  const builtIn = { kind: "built-in", providerId: "anthropic", credentialRef: ref } as const;

  await assert.rejects(
    buildLiveCoworkOptions({ workspaceRoot: "", binPath: BIN, port: 1, credentialService, provider: builtIn }),
    LiveLaunchConfigError,
  );
  await assert.rejects(
    buildLiveCoworkOptions({ workspaceRoot: "relative/ws", binPath: BIN, port: 1, credentialService, provider: builtIn }),
    LiveLaunchConfigError,
  );
  // Incoherent custom provider: missing baseUrl / envVar.
  await assert.rejects(
    buildLiveCoworkOptions({
      workspaceRoot: WS,
      binPath: BIN,
      port: 1,
      credentialService,
      provider: { kind: "custom", baseUrl: "", model: "m", envVar: "X_KEY", credentialRef: ref },
    }),
    LiveLaunchConfigError,
  );
  await assert.rejects(
    buildLiveCoworkOptions({
      workspaceRoot: WS,
      binPath: BIN,
      port: 1,
      credentialService,
      provider: { kind: "custom", baseUrl: "https://8.8.8.8/v1", model: "m", envVar: "", credentialRef: ref },
    }),
    LiveLaunchConfigError,
  );
  // Missing binPath AND appRoot cannot locate the pinned binary.
  await assert.rejects(
    buildLiveCoworkOptions({ workspaceRoot: WS, port: 1, credentialService, provider: builtIn }),
    LiveLaunchConfigError,
  );
});

test("built options feed startLiveCoworkService and round-trip against the fake OpenCode server", async () => {
  const fake = await startFakeOpencodeServer();
  const fakePort = Number(new URL(fake.baseUrl).port);
  const root = tempRoot();
  const store = createMemoryStore();
  const credentialService = createCredentialService({ store });
  const ref = await credentialService.store({ providerId: "anthropic", secret: "sk-fake-live-roundtrip-000" });

  // Build with fake spawner + fixed identity/port seams so NO real process spawns; the DEFAULT fetch
  // health probe drives the fake server on `fakePort`, and the child baseUrl becomes the fake server.
  const options = await buildLiveCoworkOptions({
    workspaceRoot: WS,
    binPath: BIN,
    host: "127.0.0.1",
    port: fakePort,
    runtimeRoot: root,
    launchId: "roundtrip",
    credentialService,
    provider: { kind: "built-in", providerId: "anthropic", credentialRef: ref },
    spawner: recordingSpawner(new FakeChild(9090)).spawner,
    processTimesProbe: fixedTimesProbe(),
    portChecker: fixedPortChecker(true),
    now: () => "2026-07-12T00:00:00.000Z",
    service: { credentialStore: store, settingsFs: memorySettingsFs() },
  });

  // The built startSpec is the exact typed shape the barrel exports.
  const startSpec: SupervisorStartSpec = options.startSpec;
  assert.equal(startSpec.port, fakePort);

  const live = await startLiveCoworkService(options);
  try {
    assert.equal(live.supervisor.isAlive(), true, "supervisor reached ready via the fake health server");
    assert.equal(live.identity.pid, 9090);

    // The LIVE session-store seam round-trips to the fake child (not the not-attached default).
    const created = await live.deps.sessionService.create({ workspaceId: WS, title: "RT" });
    assert.equal(created.title, "RT");
    assert.ok(fake.requests.some((r) => r.method === "POST" && r.path === "/session"));

    // The LIVE connector round-trips a provider probe to the child health.
    const probe = await live.deps.providerPort.testConnection("anthropic");
    assert.equal(probe.ok, true);
    assert.ok(fake.requests.some((r) => r.path === "/global/health"));

    // The seeded scrubber (wired by the builder) masks the real key through the composed redactor.
    const masked = live.deps.redactError("runtime failure sk-fake-live-roundtrip-000 during call");
    assert.ok(!masked.includes("sk-fake-live-roundtrip-000"), "seeded key value is redacted");
    assert.ok(masked.includes("runtime failure"));
  } finally {
    await live.stop();
    await fake.close();
    rmSync(root, { recursive: true, force: true });
  }
});
