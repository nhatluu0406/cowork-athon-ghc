/**
 * The mode-aware {@link createTieredStartService} must:
 *   - use the live path when it succeeds (no settings-only fallback);
 *   - fall back to the Tier-1 settings-only service ONLY on the typed
 *     {@link ServiceLaunchNotConfiguredError} (nothing configured yet);
 *   - propagate any OTHER live failure unchanged (an honest error is not masked as onboarding).
 *
 * This guards the first-run onboarding fix: an unconfigured app boots into a settings-only service
 * so the renderer reaches `ready` and the folder picker + settings UI mount — but a REAL live
 * misconfiguration still surfaces honestly rather than silently degrading to onboarding.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createTieredStartService } from "../src/service/tiered-start-service.js";
import { ServiceLaunchNotConfiguredError } from "../src/service/launch-config.js";
import type { StartedService } from "../src/service/service-controller.js";

const liveHandle: StartedService = { baseUrl: "http://127.0.0.1:1", token: "live", stop: () => Promise.resolve() };
const settingsHandle: StartedService = { baseUrl: "http://127.0.0.1:2", token: "onboard", stop: () => Promise.resolve() };

test("uses the live path when it succeeds and never calls settings-only", async () => {
  let settingsCalled = false;
  const start = createTieredStartService(
    () => Promise.resolve(liveHandle),
    () => {
      settingsCalled = true;
      return Promise.resolve(settingsHandle);
    },
  );
  const started = await start();
  assert.equal(started, liveHandle);
  assert.equal(settingsCalled, false, "settings-only must NOT run when live succeeds");
});

test("falls back to settings-only on ServiceLaunchNotConfiguredError", async () => {
  const start = createTieredStartService(
    () => Promise.reject(new ServiceLaunchNotConfiguredError()),
    () => Promise.resolve(settingsHandle),
  );
  const started = await start();
  assert.equal(started, settingsHandle, "unconfigured live → onboarding (settings-only) service");
});

test("propagates any OTHER live error without falling back", async () => {
  let settingsCalled = false;
  const boom = new Error("supervisor spawn failed");
  const start = createTieredStartService(
    () => Promise.reject(boom),
    () => {
      settingsCalled = true;
      return Promise.resolve(settingsHandle);
    },
  );
  await assert.rejects(() => start(), /supervisor spawn failed/);
  assert.equal(settingsCalled, false, "a real live failure must not be masked as onboarding");
});
