/**
 * `connectLive` idempotence policy (CGHC connectLive-idempotence fix): the shell must NOT
 * restart the running service + supervised OpenCode child on every chat turn — only when it is
 * not already live, or the caller explicitly forces a reconnect (provider-config change).
 *
 * Proven against a fake {@link ConnectLiveController} so this is a pure decision-logic test —
 * no Electron, no real ServiceController, no real OpenCode child.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createConnectLive, type ConnectLiveController } from "../src/service/connect-live.js";
import type { ServiceTier } from "../src/service/service-controller.js";

function fakeController(initialTier: ServiceTier | null): {
  controller: ConnectLiveController;
  calls: string[];
} {
  const calls: string[] = [];
  let tier = initialTier;
  return {
    calls,
    controller: {
      get runningTier() {
        return tier;
      },
      stop: async () => {
        calls.push("stop");
        tier = null;
      },
      startLive: async () => {
        calls.push("startLive");
        tier = "live";
      },
    },
  };
}

test("already live + no force -> short-circuits, NO stop/start, restarted:false", async () => {
  const { controller, calls } = fakeController("live");
  const connectLive = createConnectLive(controller);

  const result = await connectLive(false);

  assert.deepEqual(result, { restarted: false });
  assert.deepEqual(calls, [], "must not touch the running service when already live");
  assert.equal(controller.runningTier, "live", "state must be left exactly as it was");
});

test("already live + force:true -> restarts anyway, restarted:true", async () => {
  const { controller, calls } = fakeController("live");
  const connectLive = createConnectLive(controller);

  const result = await connectLive(true);

  assert.deepEqual(result, { restarted: true });
  assert.deepEqual(calls, ["stop", "startLive"]);
});

test("settings-only running + no force -> restarts into live (onboarding transition still works)", async () => {
  const { controller, calls } = fakeController("settings_only");
  const connectLive = createConnectLive(controller);

  const result = await connectLive(false);

  assert.deepEqual(result, { restarted: true });
  assert.deepEqual(calls, ["stop", "startLive"]);
  assert.equal(controller.runningTier, "live");
});

test("not running (null tier) + no force -> restarts into live", async () => {
  const { controller, calls } = fakeController(null);
  const connectLive = createConnectLive(controller);

  const result = await connectLive(false);

  assert.deepEqual(result, { restarted: true });
  assert.deepEqual(calls, ["stop", "startLive"]);
});
