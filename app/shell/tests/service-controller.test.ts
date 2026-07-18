/**
 * CGHC-028 Wave B1 — the ServiceController owns the live service handle honestly.
 *
 * Proven with an INJECTED fake StartService (no real socket, no OpenCode child):
 *  - whenReady/start → the fake is called once, its { baseUrl, token } reaches getBootstrap;
 *  - single start → repeat/concurrent start() never double-starts;
 *  - honest failure → a rejecting StartService yields the empty handshake + an error signal,
 *    never a fabricated ready and never an unhandled throw;
 *  - one owner + idempotent stop → the running handle's stop() is called at most once;
 *  - token hygiene → the token reaches the bridge but is NEVER passed to the log sink.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ServiceController } from "../src/service/service-controller.js";

const TOKEN = "per-launch-secret-token-abc123";
const BASE_URL = "http://127.0.0.1:54321";

test("start() calls the injected StartService once and its handshake reaches getBootstrap", async () => {
  let calls = 0;
  const controller = new ServiceController({
    startService: async () => {
      calls += 1;
      return { baseUrl: BASE_URL, token: TOKEN, stop: async () => {} };
    },
  });

  await controller.start();

  assert.equal(calls, 1);
  assert.equal(controller.state, "running");
  assert.deepEqual(controller.getBootstrap(), { serviceBaseUrl: BASE_URL, clientToken: TOKEN });
});

test("a second start() while running does NOT double-start", async () => {
  let calls = 0;
  const controller = new ServiceController({
    startService: async () => {
      calls += 1;
      return { baseUrl: BASE_URL, token: TOKEN, stop: async () => {} };
    },
  });

  await controller.start();
  await controller.start(); // second "ready" without a quit
  assert.equal(calls, 1, "startService must be invoked exactly once");
});

test("concurrent start() calls share one in-flight start (no double-start)", async () => {
  let calls = 0;
  const controller = new ServiceController({
    startService: async () => {
      calls += 1;
      await Promise.resolve();
      return { baseUrl: BASE_URL, token: TOKEN, stop: async () => {} };
    },
  });

  await Promise.all([controller.start(), controller.start(), controller.start()]);
  assert.equal(calls, 1);
});

test("honest failure: a rejecting StartService yields the empty handshake, not a fake ready", async () => {
  const controller = new ServiceController({
    startService: async () => {
      throw new Error("supervisor pin mismatch");
    },
  });

  // Must NOT throw to the caller (the main lifecycle must never crash on a failed start).
  await controller.start();

  assert.equal(controller.state, "failed");
  assert.deepEqual(controller.getBootstrap(), { serviceBaseUrl: "", clientToken: "" });
  assert.equal(controller.lastError, "supervisor pin mismatch");
});

test("before it is running getBootstrap is the honest empty handshake", () => {
  const controller = new ServiceController({
    startService: async () => ({ baseUrl: BASE_URL, token: TOKEN, stop: async () => {} }),
  });
  assert.deepEqual(controller.getBootstrap(), { serviceBaseUrl: "", clientToken: "" });
  assert.equal(controller.state, "idle");
});

test("stop() stops the running handle once and is idempotent (one owner)", async () => {
  let stopCalls = 0;
  const controller = new ServiceController({
    startService: async () => ({
      baseUrl: BASE_URL,
      token: TOKEN,
      stop: async () => {
        stopCalls += 1;
      },
    }),
  });

  await controller.start();
  await controller.stop();
  await controller.stop(); // idempotent second quit

  assert.equal(stopCalls, 1, "the child/socket owner is stopped exactly once");
  assert.equal(controller.state, "stopped");
  assert.deepEqual(controller.getBootstrap(), { serviceBaseUrl: "", clientToken: "" });
});

test("stop() before start() is a no-op (no throw)", async () => {
  const controller = new ServiceController({
    startService: async () => ({ baseUrl: BASE_URL, token: TOKEN, stop: async () => {} }),
  });
  await controller.stop();
  assert.equal(controller.state, "stopped");
});

test("token hygiene: the token reaches the bridge but is never passed to the log sink", async () => {
  const lines: string[] = [];
  const controller = new ServiceController({
    startService: async () => ({ baseUrl: BASE_URL, token: TOKEN, stop: async () => {} }),
    log: (line) => lines.push(line),
  });

  await controller.start();
  const handshakeWhileRunning = controller.getBootstrap();
  await controller.stop();

  // The token DID reach the renderer handshake path while running.
  assert.equal(handshakeWhileRunning.clientToken, TOKEN);
  // But it never appears in any log line.
  for (const line of lines) {
    assert.equal(line.includes(TOKEN), false, `log line leaked the token: ${line}`);
  }
  assert.ok(lines.some((line) => line.startsWith("service_started:")));
  assert.ok(lines.includes("service_stopped"));
});

test("the running handshake carries the token (bridge path), proving hygiene is not by omission", async () => {
  const controller = new ServiceController({
    startService: async () => ({ baseUrl: BASE_URL, token: TOKEN, stop: async () => {} }),
  });
  await controller.start();
  assert.equal(controller.getBootstrap().clientToken, TOKEN);
});

test("startLive() uses startLiveService when provided", async () => {
  let bootCalls = 0;
  let liveCalls = 0;
  const controller = new ServiceController({
    startService: async () => {
      bootCalls += 1;
      return { baseUrl: "http://127.0.0.1:2", token: "onboard", stop: async () => {} };
    },
    startLiveService: async () => {
      liveCalls += 1;
      return { baseUrl: BASE_URL, token: TOKEN, stop: async () => {} };
    },
  });

  await controller.start();
  assert.equal(bootCalls, 1);
  assert.equal(liveCalls, 0);

  await controller.stop();
  await controller.startLive();
  assert.equal(liveCalls, 1);
  assert.deepEqual(controller.getBootstrap(), { serviceBaseUrl: BASE_URL, clientToken: TOKEN });
});

test("runningTier is null before start and while not running", () => {
  const controller = new ServiceController({
    startService: async () => ({ baseUrl: BASE_URL, token: TOKEN, stop: async () => {} }),
  });
  assert.equal(controller.runningTier, null);
});

test("runningTier reflects settings_only after start() (fallback-tagged by caller)", async () => {
  const controller = new ServiceController({
    startService: async () => ({ baseUrl: BASE_URL, token: TOKEN, stop: async () => {} }),
  });
  await controller.start();
  assert.equal(controller.runningTier, "settings_only");
});

test("runningTier reflects live after startLive() (fallback-tagged by caller)", async () => {
  const controller = new ServiceController({
    startService: async () => ({ baseUrl: "http://127.0.0.1:2", token: "onboard", stop: async () => {} }),
    startLiveService: async () => ({ baseUrl: BASE_URL, token: TOKEN, stop: async () => {} }),
  });
  await controller.startLive();
  assert.equal(controller.runningTier, "live");
});

test("runningTier honors an explicit tier on the started handle over the caller's fallback", async () => {
  // startLive() passes "live" as its fallback tier, but a tiered live start that silently
  // degraded to settings-only MUST report its honest tier — never masquerade as live.
  const controller = new ServiceController({
    startService: async () => ({ baseUrl: "http://127.0.0.1:2", token: "onboard", stop: async () => {} }),
    startLiveService: async () => ({
      baseUrl: BASE_URL,
      token: TOKEN,
      tier: "settings_only",
      stop: async () => {},
    }),
  });
  await controller.startLive();
  assert.equal(controller.runningTier, "settings_only", "a live-path fallback must not report as live");
});

test("runningTier resets to null after stop()", async () => {
  const controller = new ServiceController({
    startService: async () => ({ baseUrl: BASE_URL, token: TOKEN, stop: async () => {} }),
  });
  await controller.start();
  assert.equal(controller.runningTier, "settings_only");
  await controller.stop();
  assert.equal(controller.runningTier, null);
});

test("runningTier is null after an honest start failure", async () => {
  const controller = new ServiceController({
    startService: async () => {
      throw new Error("boom");
    },
  });
  await controller.start();
  assert.equal(controller.runningTier, null);
});
