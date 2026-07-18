/**
 * Startup-auth-mode orchestration — the crash/interruption + rollback contract for the two-step
 * "Require login at startup" OFF transition (create the app_meta envelope in the service, then seal
 * the deviceSecret with safeStorage). The invariant under test: an interruption between the two
 * steps must NEVER leave a half-configured OFF state that could brick the vault or auto-unlock
 * without a sealed secret.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyStartupAuthMode,
  type StartupAuthModeSeams,
} from "../src/service/startup-auth-mode.js";

interface Recorded {
  readonly calls: Array<{ method: string; path: string; body: unknown }>;
  seals: number;
  clears: number;
}

function makeSeams(
  overrides: Partial<StartupAuthModeSeams> & { serviceOk?: (path: string) => boolean } = {},
): { seams: StartupAuthModeSeams; rec: Recorded } {
  const rec: Recorded = { calls: [], seals: 0, clears: 0 };
  const serviceOk = overrides.serviceOk ?? (() => true);
  const seams: StartupAuthModeSeams = {
    serviceCall: async (method, path, body) => {
      rec.calls.push({ method, path, body });
      return { ok: serviceOk(path) };
    },
    isSecureAvailable: overrides.isSecureAvailable ?? (() => true),
    generateDeviceSecret: overrides.generateDeviceSecret ?? (() => "device-secret-abcdef0123456789"),
    sealDeviceSecret:
      overrides.sealDeviceSecret ??
      (() => {
        rec.seals += 1;
        return true;
      }),
    clearSealedDeviceSecret:
      overrides.clearSealedDeviceSecret ??
      (() => {
        rec.clears += 1;
      }),
  };
  return { seams, rec };
}

test("OFF success: enables the envelope, seals the secret, then persists requireLogin=false", async () => {
  const { seams, rec } = makeSeams();
  const result = await applyStartupAuthMode(seams, false, "password12");
  assert.deepEqual(result, { ok: true, requireLogin: false });
  assert.equal(rec.seals, 1, "the deviceSecret was sealed exactly once");
  const paths = rec.calls.map((c) => `${c.method} ${c.path}`);
  assert.deepEqual(paths, [
    "POST /v1/auth/auto-unlock/enable",
    "PATCH /v1/settings/general",
  ]);
  // The deviceSecret crosses to the SERVICE only — never surfaced in the result.
  assert.equal(JSON.stringify(result).includes("device-secret"), false);
});

test("OFF interruption: seal fails after the envelope is written → rollback disable, seal_failed", async () => {
  // Simulate the crash/interruption between the two steps: the envelope landed but the seal did not.
  const { seams, rec } = makeSeams({
    sealDeviceSecret: () => false,
  });
  const result = await applyStartupAuthMode(seams, false, "password12");
  assert.deepEqual(result, { ok: false, reason: "seal_failed", requireLogin: true });
  const paths = rec.calls.map((c) => `${c.method} ${c.path}`);
  // enable (envelope written) THEN a compensating disable — never a lingering half-OFF state, and
  // the setting is NEVER flipped to false (no PATCH), so boot keeps the password gate.
  assert.deepEqual(paths, [
    "POST /v1/auth/auto-unlock/enable",
    "POST /v1/auth/auto-unlock/disable",
  ]);
});

test("OFF refused when secure storage is unavailable: nothing is enabled or sealed", async () => {
  const { seams, rec } = makeSeams({ isSecureAvailable: () => false });
  const result = await applyStartupAuthMode(seams, false, "password12");
  assert.deepEqual(result, { ok: false, reason: "secure_storage_unavailable", requireLogin: true });
  assert.equal(rec.calls.length, 0, "no loopback call is made");
  assert.equal(rec.seals, 0, "nothing was sealed");
});

test("OFF wrong password: enable rejected → no seal, envelope-first ordering means nothing to roll back", async () => {
  const { seams, rec } = makeSeams({ serviceOk: (path) => !path.endsWith("/enable") });
  const result = await applyStartupAuthMode(seams, false, "wrong-pass");
  assert.deepEqual(result, { ok: false, reason: "invalid_password", requireLogin: true });
  assert.equal(rec.seals, 0, "seal is only attempted after a successful enable");
  const paths = rec.calls.map((c) => `${c.method} ${c.path}`);
  assert.deepEqual(paths, ["POST /v1/auth/auto-unlock/enable"]);
});

test("ON success: disables the envelope, clears the seal, then persists requireLogin=true", async () => {
  const { seams, rec } = makeSeams();
  const result = await applyStartupAuthMode(seams, true, "password12");
  assert.deepEqual(result, { ok: true, requireLogin: true });
  assert.equal(rec.clears, 1, "the sealed secret was cleared");
  const paths = rec.calls.map((c) => `${c.method} ${c.path}`);
  assert.deepEqual(paths, [
    "POST /v1/auth/auto-unlock/disable",
    "PATCH /v1/settings/general",
  ]);
});

test("ON wrong password: disable rejected → seal is NOT cleared and the setting is not flipped", async () => {
  const { seams, rec } = makeSeams({ serviceOk: (path) => !path.endsWith("/disable") });
  const result = await applyStartupAuthMode(seams, true, "wrong-pass");
  assert.deepEqual(result, { ok: false, reason: "invalid_password", requireLogin: false });
  assert.equal(rec.clears, 0, "the seal is preserved when the password check fails");
  const paths = rec.calls.map((c) => `${c.method} ${c.path}`);
  assert.deepEqual(paths, ["POST /v1/auth/auto-unlock/disable"]);
});

test("an empty password is refused before any side-effect, in either direction", async () => {
  for (const requireLogin of [true, false]) {
    const { seams, rec } = makeSeams();
    const result = await applyStartupAuthMode(seams, requireLogin, "");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "password_required");
    assert.equal(result.requireLogin, !requireLogin);
    assert.equal(rec.calls.length, 0);
    assert.equal(rec.seals, 0);
    assert.equal(rec.clears, 0);
  }
});
