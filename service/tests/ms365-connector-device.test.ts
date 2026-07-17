import { test } from "node:test";
import assert from "node:assert/strict";
import { createMs365Connector } from "../src/ms365/ms365-connector.js";
import { createManualTokenProvider } from "../src/ms365/token-provider.js";
import { createCredentialService } from "../src/credential/index.js";
import { createMemoryStore } from "../src/credential/memory-store.js";
import { Ms365Error } from "../src/ms365/ms365-errors.js";
import type { GraphClient } from "../src/ms365/graph-client.js";
import type { TokenProvider } from "../src/ms365/token-provider.js";
import type { DeviceCodePrompt } from "../src/ms365/device-code-provider.js";

function fakeGraph(verifyOk: boolean): GraphClient {
  return {
    json: async () => {
      if (!verifyOk) throw new Ms365Error("auth_expired", "bad", "reconnect", false);
      return {} as never;
    },
    bytes: async () => new Uint8Array(),
  };
}

function makeManual() {
  const credentials = createCredentialService({ store: createMemoryStore() });
  return createManualTokenProvider({ credentials });
}

function fakeDeviceProvider(token: string): TokenProvider {
  return {
    source: "device_code",
    async getAccessToken() {
      return token;
    },
    async isValid() {
      return true;
    },
    async clear() {
      /* no-op */
    },
  };
}

test("beginDeviceCode with no device dep throws not_configured", async () => {
  const manual = makeManual();
  const c = createMs365Connector({ manual, makeGraph: () => fakeGraph(true) });
  await assert.rejects(
    () => c.beginDeviceCode(),
    (err: unknown) => err instanceof Ms365Error && err.kind === "not_configured",
  );
});

test("pollDeviceCode with no device dep throws not_configured", async () => {
  const manual = makeManual();
  const c = createMs365Connector({ manual, makeGraph: () => fakeGraph(true) });
  await assert.rejects(
    () => c.pollDeviceCode(),
    (err: unknown) => err instanceof Ms365Error && err.kind === "not_configured",
  );
});

test("deviceConfigured reflects presence of device dep", () => {
  const manual = makeManual();
  const withoutDevice = createMs365Connector({ manual, makeGraph: () => fakeGraph(true) });
  assert.equal(withoutDevice.deviceConfigured(), false);

  const prompt: DeviceCodePrompt = { userCode: "ABC-123", verificationUri: "https://example.test", expiresInSec: 900 };
  const device = {
    provider: fakeDeviceProvider("device-token"),
    begin: async () => prompt,
    poll: async () => "pending" as const,
  };
  const withDevice = createMs365Connector({ manual, makeGraph: () => fakeGraph(true), device });
  assert.equal(withDevice.deviceConfigured(), true);
});

test("device-code flow: begin -> pending -> connected sets state/source", async () => {
  const manual = makeManual();
  const prompt: DeviceCodePrompt = { userCode: "ABC-123", verificationUri: "https://example.test", expiresInSec: 900 };
  let pollCount = 0;
  const device = {
    provider: fakeDeviceProvider("device-token"),
    begin: async () => prompt,
    poll: async () => {
      pollCount += 1;
      return pollCount === 1 ? ("pending" as const) : ("connected" as const);
    },
  };
  const c = createMs365Connector({ manual, makeGraph: () => fakeGraph(true), device });

  const returnedPrompt = await c.beginDeviceCode();
  assert.deepEqual(returnedPrompt, prompt);
  assert.equal(c.connectionState(), "connecting");

  const first = await c.pollDeviceCode();
  assert.equal(first, "pending");
  assert.equal(c.connectionState(), "connecting");

  const second = await c.pollDeviceCode();
  assert.equal(second, "connected");
  assert.equal(c.connectionState(), "connected");
  assert.equal(c.source(), "device_code");
});

test("pollDeviceCode maps provider timeout (auth_expired) to expired + disconnected", async () => {
  const manual = makeManual();
  const prompt: DeviceCodePrompt = { userCode: "ABC-123", verificationUri: "https://example.test", expiresInSec: 900 };
  const device = {
    provider: fakeDeviceProvider("device-token"),
    begin: async () => prompt,
    poll: async () => "connected" as const,
  };
  const c = createMs365Connector({ manual, makeGraph: () => fakeGraph(false), device });

  await c.beginDeviceCode();
  const result = await c.pollDeviceCode();
  assert.equal(result, "expired");
  assert.equal(c.connectionState(), "disconnected");
});

test("graph() uses device provider token after device connect, not manual", async () => {
  const manual = makeManual();
  await manual.connect("manual-token-should-not-be-used");
  const prompt: DeviceCodePrompt = { userCode: "ABC-123", verificationUri: "https://example.test", expiresInSec: 900 };
  const device = {
    provider: fakeDeviceProvider("device-token-value"),
    begin: async () => prompt,
    poll: async () => "connected" as const,
  };
  let seenToken: string | null = null;
  const makeGraph = (getToken: () => Promise<string>): GraphClient => ({
    json: async () => {
      seenToken = await getToken();
      return {} as never;
    },
    bytes: async () => new Uint8Array(),
  });
  const c = createMs365Connector({ manual, makeGraph, device });

  await c.beginDeviceCode();
  await c.pollDeviceCode();

  await c.graph().json({ method: "GET", path: "/me" });
  assert.equal(seenToken, "device-token-value");
});

test("pollDeviceCode throws on non-auth_expired verify failure, never returns connected", async () => {
  const manual = makeManual();
  const prompt: DeviceCodePrompt = { userCode: "ABC-123", verificationUri: "https://example.test", expiresInSec: 900 };
  const secretToken = "super-secret-device-token";
  const device = {
    provider: fakeDeviceProvider(secretToken),
    begin: async () => prompt,
    poll: async () => "connected" as const,
  };
  const graph: GraphClient = {
    json: async () => {
      throw new Ms365Error("graph_error", "Microsoft Graph request failed (status 500).", "Thử lại.", true);
    },
    bytes: async () => new Uint8Array(),
  };
  const c = createMs365Connector({ manual, makeGraph: () => graph, device });

  await c.beginDeviceCode();
  await assert.rejects(
    () => c.pollDeviceCode(),
    (err: unknown) => err instanceof Ms365Error && err.kind === "graph_error",
  );
  assert.equal(c.connectionState(), "error");
  assert.equal(c.source(), null);
  assert.ok(!(c.lastError() ?? "").includes(secretToken));
});
