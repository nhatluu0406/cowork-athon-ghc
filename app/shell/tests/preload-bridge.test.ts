/**
 * GATE 3 (4): the preload exposes EXACTLY the intended tiny surface via
 * `contextBridge.exposeInMainWorld` and leaks no raw ipc. Verified against the pure
 * builder + expose helper with a fake contextBridge/ipc, so electron is never loaded.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { COWORK_SHELL_BRIDGE_KEY } from "@cowork-ghc/contracts";

import { createShellBridge, exposeShellBridge } from "../src/ipc/bridge.js";
import { IpcChannel } from "../src/ipc/channels.js";

/** A fake ipcRenderer that records the channels `invoke` was called with. */
function makeFakeIpc() {
  const invoked: string[] = [];
  return {
    invoked,
    ipc: {
      invoke: async (channel: string) => {
        invoked.push(channel);
        return undefined;
      },
    },
  };
}

test("the exposed bridge has EXACTLY the intended keys — no more", () => {
  const { ipc } = makeFakeIpc();
  const bridge = createShellBridge(ipc);
  assert.deepEqual(Object.keys(bridge).sort(), ["connectLive", "getBootstrap", "pickWorkspaceFolder"]);
});

test("the bridge leaks no raw ipc handle or generic passthrough", () => {
  const { ipc } = makeFakeIpc();
  const bridge = createShellBridge(ipc) as Record<string, unknown>;

  for (const forbidden of ["ipcRenderer", "invoke", "send", "sendSync", "on", "postMessage"]) {
    assert.equal(forbidden in bridge, false, `bridge must not expose "${forbidden}"`);
  }
  // Every exposed member is a function (a capability), never a raw object handle.
  for (const value of Object.values(bridge)) {
    assert.equal(typeof value, "function");
  }
});

test("each bridge method invokes exactly its allow-listed channel", async () => {
  const { ipc, invoked } = makeFakeIpc();
  const bridge = createShellBridge(ipc);

  await bridge.getBootstrap();
  await bridge.pickWorkspaceFolder();
  await bridge.connectLive();

  assert.deepEqual(invoked, [
    IpcChannel.GetBootstrap,
    IpcChannel.PickWorkspaceFolder,
    IpcChannel.ConnectLive,
  ]);
});

test("exposeShellBridge publishes the bridge under the shared contract key", () => {
  const { ipc } = makeFakeIpc();
  const calls: Array<{ key: string; api: unknown }> = [];
  const fakeContextBridge = {
    exposeInMainWorld: (key: string, api: unknown) => calls.push({ key, api }),
  };

  exposeShellBridge(fakeContextBridge, ipc);

  assert.equal(calls.length, 1, "exposeInMainWorld must be called exactly once");
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.key, COWORK_SHELL_BRIDGE_KEY);
  assert.deepEqual(
    Object.keys(call.api as Record<string, unknown>).sort(),
    ["connectLive", "getBootstrap", "pickWorkspaceFolder"],
  );
  assert.equal("ipcRenderer" in (call.api as Record<string, unknown>), false);
});
