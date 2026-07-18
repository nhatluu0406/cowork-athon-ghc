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
    beginDeviceCode: async () => ({ userCode: "x", verificationUri: "u", expiresInSec: 900 }),
    pollDeviceCode: async () => "pending",
    deviceConfigured: () => false,
    grantedScopes: () => [],
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

test("connected view shows the account's REAL granted scopes over the static list", () => {
  const connector: Ms365Connector = {
    ...conn("connected"),
    grantedScopes: () => ["User.Read", "Sites.Read.All"],
  };
  const view = buildMs365View(connector, ["Files.ReadWrite.All"]); // static list differs
  assert.deepEqual(view.scopes, ["User.Read", "Sites.Read.All"]); // real granted wins
});

test("disconnected view falls back to the static requested-scopes list", () => {
  const connector: Ms365Connector = {
    ...conn("disconnected"),
    grantedScopes: () => [], // nothing granted while disconnected
  };
  const view = buildMs365View(connector, ["Sites.Read.All"]);
  assert.deepEqual(view.scopes, ["Sites.Read.All"]);
});
