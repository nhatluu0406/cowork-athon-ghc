/**
 * `ensureLive` force-reconnect gate (CGHC connectLive-idempotence fix): a chat turn must pass
 * `{ force: true }` to `connectLive` exactly when the renderer's provider/model/workspace config
 * has drifted from what the running live service was built with, and must clear that flag once a
 * connect has resolved. `app-shell.ts` mounts DOM and is not unit-testable directly, so this
 * exercises the extracted pure decision helper it calls into.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { connectLiveOptsFor, nextLiveConfigDirtyAfterConnect } from "../src/live-config-dirty.js";

test("connectLiveOptsFor(false) passes no force", () => {
  assert.equal(connectLiveOptsFor(false), undefined);
});

test("connectLiveOptsFor(true) forces a reconnect", () => {
  assert.deepEqual(connectLiveOptsFor(true), { force: true });
});

test("nextLiveConfigDirtyAfterConnect() always clears the flag after a resolved connect", () => {
  assert.equal(nextLiveConfigDirtyAfterConnect(), false);
});
