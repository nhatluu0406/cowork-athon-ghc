/**
 * CGHC-028 Wave B1 — the main-process lifecycle wiring owns start + stop, with a fake `app`.
 *
 * Proven without electron:
 *  - on whenReady → the live service is started (non-blocking) AND the electron-specific
 *    ready work runs;
 *  - on before-quit → the service is stopped ONCE (socket + child, one owner), the quit is
 *    deferred until stop resolves, and re-entrant quit events do not stop twice.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { runShellLifecycle, type LifecycleApp, type LifecycleEvent } from "../src/lifecycle.js";

/** A fake electron `app`: resolved whenReady, captured before-quit listener, quit spy. */
function fakeApp() {
  const state = {
    quitCalls: 0,
    beforeQuit: null as ((event: LifecycleEvent) => void) | null,
  };
  const app: LifecycleApp = {
    whenReady: () => Promise.resolve(),
    onBeforeQuit: (listener) => {
      state.beforeQuit = listener;
    },
    quit: () => {
      state.quitCalls += 1;
    },
  };
  return { app, state };
}

function fakeController() {
  const calls = { start: 0, stop: 0 };
  return {
    calls,
    controller: {
      start: async () => {
        calls.start += 1;
      },
      stop: async () => {
        calls.stop += 1;
      },
    },
  };
}

/** Fire a before-quit event and let the deferred `stop().finally(quit)` microtasks settle. */
function fireBeforeQuit(listener: (event: LifecycleEvent) => void): { preventDefaults: number } {
  const counter = { preventDefaults: 0 };
  listener({ preventDefault: () => (counter.preventDefaults += 1) });
  return counter;
}

test("whenReady starts the live service and runs the electron ready work", async () => {
  const { app, state } = fakeApp();
  const { controller, calls } = fakeController();
  let readyCalls = 0;

  await runShellLifecycle({ app, controller, onReady: () => (readyCalls += 1) });

  assert.equal(calls.start, 1, "the live service is started on ready");
  assert.equal(readyCalls, 1, "the electron-specific ready work runs");
  assert.ok(state.beforeQuit !== null, "a before-quit handler is installed");
});

test("before-quit stops the service once, then quits (one owner)", async () => {
  const { app, state } = fakeApp();
  const { controller, calls } = fakeController();

  await runShellLifecycle({ app, controller, onReady: () => {} });
  assert.ok(state.beforeQuit);

  const c = fireBeforeQuit(state.beforeQuit);
  // Let stop().finally(quit) resolve.
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(c.preventDefaults, 1, "quit is deferred until stop completes");
  assert.equal(calls.stop, 1, "the service (socket + child) is stopped exactly once");
  assert.equal(state.quitCalls, 1, "the app quits after stop resolves");
});

test("prepare runs after whenReady and before service start", async () => {
  const { app } = fakeApp();
  const { controller, calls } = fakeController();
  const order: string[] = [];

  await runShellLifecycle({
    app: {
      whenReady: async () => {
        order.push("whenReady");
      },
      onBeforeQuit: app.onBeforeQuit,
      quit: app.quit,
    },
    controller: {
      start: async () => {
        order.push("start");
        await controller.start();
      },
      stop: controller.stop,
    },
    prepare: () => {
      order.push("prepare");
    },
    onReady: () => {
      order.push("onReady");
    },
  });

  assert.deepEqual(order, ["whenReady", "prepare", "start", "onReady"]);
  assert.equal(calls.start, 1);
});

test("a re-entrant before-quit does not stop twice", async () => {
  const { app, state } = fakeApp();
  const { controller, calls } = fakeController();

  await runShellLifecycle({ app, controller, onReady: () => {} });
  assert.ok(state.beforeQuit);

  fireBeforeQuit(state.beforeQuit);
  fireBeforeQuit(state.beforeQuit); // e.g. window-all-closed → app.quit() → before-quit again
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(calls.stop, 1, "guarded: stop runs at most once across re-entrant quit events");
});
