import { test } from "node:test";
import assert from "node:assert/strict";
import { createPairingRegistry } from "../src/remote-gateway/pairing.js";

function fixedClock(startMs: number): { now: () => number; advance: (ms: number) => void } {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

test("pairing lifecycle: issue code, exchange once, verify token, revoke", () => {
  const clock = fixedClock(1_000_000);
  const registry = createPairingRegistry({ now: clock.now });

  const issued = registry.issueCode();
  assert.equal(issued.code.length, 8);
  assert.equal(registry.activeCodeInfo().active, true);

  const result = registry.exchange(issued.code, "My Phone");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.deviceId, /^dev-[0-9a-f]{8}$/);
  assert.equal(result.token.length, 64);

  const device = registry.verifyToken(result.token);
  assert.ok(device);
  assert.equal(device.deviceId, result.deviceId);
  assert.equal(device.name, "My Phone");

  // Single-use: the consumed code cannot be exchanged again.
  const replay = registry.exchange(issued.code, "attacker");
  assert.deepEqual(replay, { ok: false, reason: "no_active_code" });

  assert.equal(registry.revoke(result.deviceId), true);
  assert.equal(registry.verifyToken(result.token), undefined);
});

test("expired code is rejected and cleared", () => {
  const clock = fixedClock(0);
  const registry = createPairingRegistry({ now: clock.now, codeTtlMs: 1_000 });
  const issued = registry.issueCode();
  clock.advance(1_001);
  assert.deepEqual(registry.exchange(issued.code), { ok: false, reason: "expired" });
  assert.equal(registry.activeCodeInfo().active, false);
});

test("repeated wrong codes lock pairing until a new code is issued", () => {
  const registry = createPairingRegistry({ maxFailedExchanges: 3 });
  const issued = registry.issueCode();
  assert.deepEqual(registry.exchange("WRONGAAA"), { ok: false, reason: "mismatch" });
  assert.deepEqual(registry.exchange("WRONGBBB"), { ok: false, reason: "mismatch" });
  assert.deepEqual(registry.exchange("WRONGCCC"), { ok: false, reason: "locked" });
  // Even the CORRECT code is refused while locked (brute-force cutoff is real).
  assert.deepEqual(registry.exchange(issued.code), { ok: false, reason: "locked" });
  // A fresh code unlocks.
  const fresh = registry.issueCode();
  const result = registry.exchange(fresh.code);
  assert.equal(result.ok, true);
});

test("device limit is enforced", () => {
  const registry = createPairingRegistry({ maxDevices: 1 });
  const first = registry.issueCode();
  assert.equal(registry.exchange(first.code).ok, true);
  const second = registry.issueCode();
  assert.deepEqual(registry.exchange(second.code), { ok: false, reason: "device_limit" });
});

test("verifyToken rejects garbage, empty, and revoked tokens", () => {
  const registry = createPairingRegistry();
  assert.equal(registry.verifyToken(undefined), undefined);
  assert.equal(registry.verifyToken(""), undefined);
  assert.equal(registry.verifyToken("not-a-real-token"), undefined);

  const issued = registry.issueCode();
  const result = registry.exchange(issued.code);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  registry.revokeAll();
  assert.equal(registry.verifyToken(result.token), undefined);
  assert.equal(registry.listDevices().length, 0);
});

test("device views never expose token material; names are sanitized", () => {
  const registry = createPairingRegistry();
  const issued = registry.issueCode();
  const result = registry.exchange(issued.code, "  ph" + String.fromCharCode(1) + "one  ");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const listed = registry.listDevices();
  assert.equal(listed.length, 1);
  const view = listed[0] as Record<string, unknown>;
  assert.equal(view["name"], "phone");
  const text = JSON.stringify(listed);
  assert.doesNotMatch(text, new RegExp(result.token));
  assert.equal(Object.keys(view).sort().join(","), "deviceId,lastSeenAtIso,name,pairedAtIso");
});

test("exchange is case-insensitive on the presented code", () => {
  const registry = createPairingRegistry();
  const issued = registry.issueCode();
  const result = registry.exchange(issued.code.toLowerCase());
  assert.equal(result.ok, true);
});
