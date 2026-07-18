/**
 * CGHC-028 Wave B1 — the default StartService normalizes `startLiveCoworkService`.
 *
 * With an INJECTED fake `startLive` (no real socket, no OpenCode child) this proves the
 * adapter maps the rich LiveCoworkService handle onto the shell's minimal
 * { baseUrl, token, stop }: the loopback baseUrl + per-launch clientToken come from
 * `running`, and the shell `stop()` delegates to the live `stop()` (which owns the socket +
 * child). It also proves the honest default resolver rejects (Wave C wires a real one).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { LiveCoworkService, LiveCoworkServiceOptions } from "@cowork-ghc/service";
import { createLiveStartService, toStartedService } from "../src/service/live-service-adapter.js";
import {
  resolveLiveOptionsNotConfigured,
  ServiceLaunchNotConfiguredError,
} from "../src/service/launch-config.js";

const BASE_URL = "http://127.0.0.1:60123";
const TOKEN = "live-launch-token-xyz";

/** A minimal LiveCoworkService double: only the fields the adapter reads + a stop spy. */
function fakeLive(): { live: LiveCoworkService; stopCalls: () => number } {
  let stops = 0;
  const live = {
    running: { baseUrl: BASE_URL, clientToken: TOKEN },
    stop: async () => {
      stops += 1;
    },
  } as unknown as LiveCoworkService;
  return { live, stopCalls: () => stops };
}

test("toStartedService maps running.baseUrl + running.clientToken + delegating stop", async () => {
  const { live, stopCalls } = fakeLive();
  const started = toStartedService(live);

  assert.equal(started.baseUrl, BASE_URL);
  assert.equal(started.token, TOKEN);
  await started.stop();
  assert.equal(stopCalls(), 1, "shell stop() delegates to the live stop() (socket + child)");
});

test("createLiveStartService resolves options then starts + normalizes (no real launch)", async () => {
  const { live, stopCalls } = fakeLive();
  const sentinelOptions = { workspaceId: "C:/ws" } as unknown as LiveCoworkServiceOptions;
  let resolvedWith: LiveCoworkServiceOptions | null = null;

  const startService = createLiveStartService(
    async () => sentinelOptions,
    async (options) => {
      resolvedWith = options;
      return live;
    },
  );

  const started = await startService();

  assert.equal(resolvedWith, sentinelOptions, "the resolved options are passed to startLive");
  assert.equal(started.baseUrl, BASE_URL);
  assert.equal(started.token, TOKEN);
  await started.stop();
  assert.equal(stopCalls(), 1);
});

test("a rejecting options resolver propagates (controller turns it into honest failure)", async () => {
  const startService = createLiveStartService(
    () => Promise.reject(new Error("no workspace granted")),
    async () => fakeLive().live,
  );
  await assert.rejects(startService(), /no workspace granted/);
});

test("the default resolver fails honestly until a real one is injected (Wave C)", async () => {
  await assert.rejects(resolveLiveOptionsNotConfigured(), (err: unknown) => {
    assert.ok(err instanceof ServiceLaunchNotConfiguredError);
    return true;
  });
});

test("retries once on runtime_port_in_use then succeeds (fresh options each attempt)", async () => {
  const { live } = fakeLive();
  let resolveCalls = 0;
  let startCalls = 0;
  const startService = createLiveStartService(
    async () => {
      resolveCalls += 1;
      return { workspaceId: `C:/ws-${resolveCalls}` } as unknown as LiveCoworkServiceOptions;
    },
    async () => {
      startCalls += 1;
      if (startCalls === 1) throw { code: "runtime_port_in_use" };
      return live;
    },
  );
  const started = await startService();
  assert.equal(started.baseUrl, BASE_URL);
  assert.equal(resolveCalls, 2, "resolveOptions re-run on retry → fresh supervisor + ports");
  assert.equal(startCalls, 2);
});

test("retries on a raw EADDRINUSE from the service socket", async () => {
  const { live } = fakeLive();
  let startCalls = 0;
  const startService = createLiveStartService(
    async () => ({ workspaceId: "C:/ws" }) as unknown as LiveCoworkServiceOptions,
    async () => {
      startCalls += 1;
      if (startCalls === 1) throw { code: "EADDRINUSE" };
      return live;
    },
  );
  const started = await startService();
  assert.equal(started.baseUrl, BASE_URL);
  assert.equal(startCalls, 2);
});

test("exhausts maxAttempts on persistent port-in-use, then throws the last error", async () => {
  let resolveCalls = 0;
  const startService = createLiveStartService(
    async () => {
      resolveCalls += 1;
      return { workspaceId: "C:/ws" } as unknown as LiveCoworkServiceOptions;
    },
    async () => {
      throw { code: "runtime_port_in_use" };
    },
    { maxAttempts: 3 },
  );
  await assert.rejects(startService(), (err: unknown) => {
    return typeof err === "object" && err !== null && (err as { code?: string }).code === "runtime_port_in_use";
  });
  assert.equal(resolveCalls, 3, "tried exactly maxAttempts times");
});

test("does NOT retry a health-timeout (masking a broken binary would be worse)", async () => {
  let resolveCalls = 0;
  const startService = createLiveStartService(
    async () => {
      resolveCalls += 1;
      return { workspaceId: "C:/ws" } as unknown as LiveCoworkServiceOptions;
    },
    async () => {
      throw { code: "runtime_health_timeout" };
    },
  );
  await assert.rejects(startService(), (err: unknown) => {
    return typeof err === "object" && err !== null && (err as { code?: string }).code === "runtime_health_timeout";
  });
  assert.equal(resolveCalls, 1, "no retry → resolveOptions called exactly once");
});

test("a not-configured resolver rejection is not retried", async () => {
  let resolveCalls = 0;
  const startService = createLiveStartService(
    async () => {
      resolveCalls += 1;
      throw new ServiceLaunchNotConfiguredError();
    },
    async () => fakeLive().live,
  );
  await assert.rejects(startService(), (err: unknown) => err instanceof ServiceLaunchNotConfiguredError);
  assert.equal(resolveCalls, 1, "not-configured is honest terminal, never retried");
});
