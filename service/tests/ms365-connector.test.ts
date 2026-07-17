import { test } from "node:test";
import assert from "node:assert/strict";
import { createMs365Connector } from "../src/ms365/ms365-connector.js";
import { createManualTokenProvider } from "../src/ms365/token-provider.js";
import { createCredentialService } from "../src/credential/index.js";
import { createMemoryStore } from "../src/credential/memory-store.js";
import { Ms365Error } from "../src/ms365/ms365-errors.js";
import type { GraphClient } from "../src/ms365/graph-client.js";

function fakeGraph(verifyOk: boolean): GraphClient {
  return {
    json: async () => {
      if (!verifyOk) throw new Ms365Error("auth_expired", "bad", "reconnect", false);
      return {} as never;
    },
    bytes: async () => new Uint8Array(),
  };
}

function connectorWith(verifyOk: boolean) {
  const credentials = createCredentialService({ store: createMemoryStore() });
  const manual = createManualTokenProvider({ credentials });
  return createMs365Connector({ manual, makeGraph: () => fakeGraph(verifyOk) });
}

test("starts disconnected", () => {
  assert.equal(connectorWith(true).connectionState(), "disconnected");
  assert.equal(connectorWith(true).source(), null);
  assert.equal(connectorWith(true).lastError(), null);
});

test("connectWithToken → connected on successful verify", async () => {
  const c = connectorWith(true);
  await c.connectWithToken("T");
  assert.equal(c.connectionState(), "connected");
  assert.equal(c.source(), "manual_token");
});

test("auth_expired on verify → needs_reconnect", async () => {
  const c = connectorWith(false);
  await c.connectWithToken("T");
  assert.equal(c.connectionState(), "needs_reconnect");
});

test("disconnect returns to disconnected and clears token", async () => {
  const c = connectorWith(true);
  await c.connectWithToken("T");
  await c.disconnect();
  assert.equal(c.connectionState(), "disconnected");
  assert.equal(c.source(), null);
  assert.equal(c.lastError(), null);
});

test("other verify error → error state with non-secret message, no token leaked", async () => {
  const credentials = createCredentialService({ store: createMemoryStore() });
  const manual = createManualTokenProvider({ credentials });
  const secretToken = "super-secret-token-value";
  const graph: GraphClient = {
    json: async () => {
      throw new Ms365Error("graph_error", "Microsoft Graph request failed (status 500).", "Thử lại.", true);
    },
    bytes: async () => new Uint8Array(),
  };
  const c = createMs365Connector({ manual, makeGraph: () => graph });
  await c.connectWithToken(secretToken);
  assert.equal(c.connectionState(), "error");
  assert.equal(c.lastError(), "Microsoft Graph request failed (status 500).");
  assert.ok(!c.lastError()?.includes(secretToken));
});
