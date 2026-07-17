import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMs365View } from "../src/ms365/ms365-view.js";
import type { Ms365Connector } from "../src/ms365/ms365-connector.js";

function conn(state: "connected" | "disconnected"): Ms365Connector {
  return {
    connectionState: () => state,
    connectWithToken: async () => {},
    disconnect: async () => {},
    graph: () => ({
      json: async () => ({} as never),
      bytes: async () => new Uint8Array(),
    }),
    source: () => (state === "connected" ? "manual_token" : null),
    lastError: () => null,
  };
}

test("view carries state + scopes and NO token field", () => {
  const view = buildMs365View(conn("connected"), [
    "Sites.Read.All",
    "Files.ReadWrite.All",
  ]);
  assert.equal(view.connectionState, "connected");
  assert.deepEqual(view.scopes, ["Sites.Read.All", "Files.ReadWrite.All"]);
  const serialized = JSON.stringify(view);
  assert.doesNotMatch(serialized, /Bearer|access_token|refresh_token/i);
});
