/**
 * MS365 flow-management service-client methods test (Task 5 + Task 6).
 *
 * Tests the typed methods that call the MS365 flow routes:
 * - listMs365Flows: GET /v1/ms365/flows
 * - addMs365Flow: POST /v1/ms365/flows
 * - updateMs365Flow: POST /v1/ms365/flows/update
 * - deleteMs365Flow: POST /v1/ms365/flows/delete
 * - setMs365FlowEnabled: POST /v1/ms365/flows/toggle
 * - setMs365FlowTimeout: POST /v1/ms365/flows/timeout
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOUNDARY_PROTOCOL_VERSION } from "@cowork-ghc/contracts";
import { createServiceClient } from "../src/service-client.js";

const BASE = "http://127.0.0.1:9";
const TOKEN = "test-token";

/** One recorded fetch call: the full URL + the RequestInit passed to fetch. */
interface RecordedCall {
  readonly url: string;
  readonly init?: RequestInit;
}

/**
 * Stub `fetch` with a handler producing `{ status, json }` for each call, wrapped in the
 * versioned envelope. Returns the list of recorded calls (URL + init) in call order, so
 * tests can assert on the request path/method/body via `calls.at(-1)`.
 */
function stubFetch(handler: (path: string, init?: RequestInit) => { status: number; json: unknown }) {
  const calls: RecordedCall[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const { json } = handler(path, init);
    return {
      json: async () => ({
        protocol: BOUNDARY_PROTOCOL_VERSION,
        ok: true,
        data: json,
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

test("listMs365Flows GETs /v1/ms365/flows and unwraps .flows", async () => {
  const calls = stubFetch(() => ({
    status: 200,
    json: { flows: [{ name: "f1", enabled: false, timeoutMs: 5000 }] },
  }));
  const client = createServiceClient(BASE, TOKEN);
  const flows = await client.listMs365Flows();
  assert.deepEqual(flows, [{ name: "f1", enabled: false, timeoutMs: 5000 }]);
  assert.ok(calls.some((c) => new URL(c.url).pathname === "/v1/ms365/flows" && (c.init?.method ?? "GET") === "GET"));
});

test("addMs365Flow sends description + payloadSchema", async () => {
  const calls = stubFetch(() => ({ status: 200, json: { flows: [] } }));
  const client = createServiceClient("http://localhost:9999", "tok");
  await client.addMs365Flow("f1", "https://x/1?sig=a", "send mail", '{"type":"object"}', 3000);
  assert.deepEqual(JSON.parse(calls.at(-1)!.init!.body as string), {
    name: "f1",
    url: "https://x/1?sig=a",
    description: "send mail",
    payloadSchema: '{"type":"object"}',
    timeoutMs: 3000,
  });
});

test("addMs365Flow omits timeoutMs when not provided", async () => {
  const calls = stubFetch(() => ({ status: 200, json: { flows: [] } }));
  const client = createServiceClient(BASE, TOKEN);
  await client.addMs365Flow("f1", "https://x/1?sig=a", "desc", "");
  assert.deepEqual(JSON.parse(calls.at(-1)!.init!.body as string), {
    name: "f1",
    url: "https://x/1?sig=a",
    description: "desc",
    payloadSchema: "",
  });
});

test("updateMs365Flow posts schema; omits url when blank", async () => {
  const calls = stubFetch(() => ({ status: 200, json: { flows: [] } }));
  const client = createServiceClient("http://localhost:9999", "tok");
  await client.updateMs365Flow("f1", { description: "d2", timeoutMs: 8000, payloadSchema: '{"a":1}' });
  const last = calls.at(-1)!;
  assert.ok(last.url.endsWith("/v1/ms365/flows/update"));
  assert.deepEqual(JSON.parse(last.init!.body as string), {
    name: "f1",
    description: "d2",
    timeoutMs: 8000,
    payloadSchema: '{"a":1}',
  });
});

test("updateMs365Flow includes url when given", async () => {
  const calls = stubFetch(() => ({ status: 200, json: { flows: [] } }));
  const client = createServiceClient("http://localhost:9999", "tok");
  await client.updateMs365Flow("f1", { description: "d", timeoutMs: 8000, payloadSchema: "", url: "https://x/2?sig=b" });
  assert.deepEqual(JSON.parse(calls.at(-1)!.init!.body as string), {
    name: "f1",
    description: "d",
    timeoutMs: 8000,
    payloadSchema: "",
    url: "https://x/2?sig=b",
  });
});

test("deleteMs365Flow POSTs to flows/delete with name", async () => {
  const calls = stubFetch(() => ({ status: 200, json: { flows: [] } }));
  const client = createServiceClient(BASE, TOKEN);
  const flows = await client.deleteMs365Flow("f1");
  assert.deepEqual(flows, []);
  const last = calls.at(-1)!;
  assert.ok(last.url.endsWith("/v1/ms365/flows/delete"));
  assert.deepEqual(JSON.parse(last.init!.body as string), { name: "f1" });
});

test("setMs365FlowEnabled POSTs to flows/toggle with name+enabled", async () => {
  const calls = stubFetch(() => ({ status: 200, json: { flows: [] } }));
  const client = createServiceClient(BASE, TOKEN);
  await client.setMs365FlowEnabled("f1", false);
  const last = calls.at(-1)!;
  assert.ok(last.url.endsWith("/v1/ms365/flows/toggle"));
  assert.deepEqual(JSON.parse(last.init!.body as string), { name: "f1", enabled: false });
});

test("setMs365FlowTimeout POSTs to flows/timeout with name+timeoutMs", async () => {
  const calls = stubFetch(() => ({ status: 200, json: { flows: [] } }));
  const client = createServiceClient(BASE, TOKEN);
  await client.setMs365FlowTimeout("f1", 9000);
  const last = calls.at(-1)!;
  assert.ok(last.url.endsWith("/v1/ms365/flows/timeout"));
  assert.deepEqual(JSON.parse(last.init!.body as string), { name: "f1", timeoutMs: 9000 });
});
