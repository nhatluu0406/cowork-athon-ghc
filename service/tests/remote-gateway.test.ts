import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPairingRegistry } from "../src/remote-gateway/pairing.js";
import {
  isRemoteEnabled,
  resolveRemoteBindHost,
  startRemoteGateway,
  type RemoteGateway,
} from "../src/remote-gateway/gateway.js";

const MAIN_TOKEN = "m".repeat(64);

/** A fake main service: asserts the gateway presents the MAIN token, serves JSON + SSE. */
function startFakeMain(): Promise<{ server: Server; baseUrl: string; seen: string[] }> {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url ?? ""} auth=${req.headers.authorization ?? "none"}`);
    if (req.headers.authorization !== `Bearer ${MAIN_TOKEN}`) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    const url = new URL(req.url ?? "/", "http://main.invalid");
    if (url.pathname === "/v1/conversations") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: { conversations: [{ id: "c1", title: "Demo" }] } }));
      return;
    }
    if (url.pathname === "/v1/session/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"kind":"token","delta":"xin chao"}\n\n');
      res.write('data: {"kind":"terminal","state":"completed"}\n\n');
      res.end();
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  });
  return new Promise((resolve) => {
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const info = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${info.port}`, seen });
    });
  });
}

async function startTestGateway(mainBaseUrl: string): Promise<{
  gateway: RemoteGateway;
  pairAndGetToken: () => Promise<string>;
}> {
  const pairing = createPairingRegistry();
  const gateway = await startRemoteGateway({
    mainBaseUrl,
    mainClientToken: MAIN_TOKEN,
    pairing,
  });
  return {
    gateway,
    pairAndGetToken: async () => {
      const { code } = gateway.issuePairingCode();
      const res = await fetch(`${gateway.url}/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, deviceName: "test-phone" }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { data: { token: string } };
      return body.data.token;
    },
  };
}

test("flag guard: remote is off unless CGHC_REMOTE_ENABLED is set", () => {
  assert.equal(isRemoteEnabled({}), false);
  assert.equal(isRemoteEnabled({ CGHC_REMOTE_ENABLED: "0" }), false);
  assert.equal(isRemoteEnabled({ CGHC_REMOTE_ENABLED: "1" }), true);
  assert.equal(isRemoteEnabled({ CGHC_REMOTE_ENABLED: "true" }), true);
  assert.equal(resolveRemoteBindHost({}), "127.0.0.1");
  assert.equal(resolveRemoteBindHost({ CGHC_REMOTE_LAN: "1" }), "0.0.0.0");
});

test("serves the PWA shell unauthenticated, with no secret in it", async () => {
  const main = await startFakeMain();
  const { gateway } = await startTestGateway(main.baseUrl);
  try {
    const res = await fetch(`${gateway.url}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Cowork Remote/);
    assert.doesNotMatch(html, new RegExp(MAIN_TOKEN));
  } finally {
    await gateway.stop();
    main.server.close();
  }
});

test("pair over HTTP then read conversations through the allowlist proxy", async () => {
  const main = await startFakeMain();
  const { gateway, pairAndGetToken } = await startTestGateway(main.baseUrl);
  try {
    const token = await pairAndGetToken();
    assert.notEqual(token, MAIN_TOKEN);

    const me = await fetch(`${gateway.url}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(me.status, 200);
    const meBody = (await me.json()) as { data: { device: { name: string } } };
    assert.equal(meBody.data.device.name, "test-phone");

    const res = await fetch(`${gateway.url}/api/conversations`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: { conversations: unknown[] } };
    assert.equal(body.ok, true);
    assert.equal(body.data.conversations.length, 1);
    // The upstream call carried the MAIN token; the device token never reached upstream.
    assert.ok(main.seen.some((line) => line.includes(`Bearer ${MAIN_TOKEN}`)));
    assert.ok(!main.seen.some((line) => line.includes(token)));
  } finally {
    await gateway.stop();
    main.server.close();
  }
});

test("requests without or with a bad device token are refused", async () => {
  const main = await startFakeMain();
  const { gateway } = await startTestGateway(main.baseUrl);
  try {
    const missing = await fetch(`${gateway.url}/api/conversations`);
    assert.equal(missing.status, 401);
    const invalid = await fetch(`${gateway.url}/api/conversations`, {
      headers: { authorization: "Bearer " + "x".repeat(64) },
    });
    assert.equal(invalid.status, 403);
    // Nothing was forwarded upstream for refused requests.
    assert.equal(main.seen.length, 0);
  } finally {
    await gateway.stop();
    main.server.close();
  }
});

test("non-allowlisted paths are 404 and never forwarded", async () => {
  const main = await startFakeMain();
  const { gateway, pairAndGetToken } = await startTestGateway(main.baseUrl);
  try {
    const token = await pairAndGetToken();
    for (const path of [
      "/api/credentials",
      "/api/conversations/c1/messages",
      "/v1/conversations",
      "/api/../v1/provider",
    ]) {
      const res = await fetch(`${gateway.url}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 404, `expected 404 for ${path}`);
    }
    assert.equal(main.seen.length, 0);
  } finally {
    await gateway.stop();
    main.server.close();
  }
});

test("SSE stream pipes through end-to-end", async () => {
  const main = await startFakeMain();
  const { gateway, pairAndGetToken } = await startTestGateway(main.baseUrl);
  try {
    const token = await pairAndGetToken();
    const res = await fetch(`${gateway.url}/api/stream?sessionId=s1`, {
      headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const text = await res.text();
    assert.match(text, /"kind":"token"/);
    assert.match(text, /"kind":"terminal"/);
  } finally {
    await gateway.stop();
    main.server.close();
  }
});

test("wrong pairing codes lock out over HTTP and the response carries no token", async () => {
  const main = await startFakeMain();
  const { gateway } = await startTestGateway(main.baseUrl);
  try {
    gateway.issuePairingCode();
    let lastBody = "";
    for (let i = 0; i < 5; i += 1) {
      const res = await fetch(`${gateway.url}/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "WRONGAAA" }),
      });
      assert.equal(res.status, 401);
      lastBody = await res.text();
    }
    assert.match(lastBody, /locked/);
    assert.doesNotMatch(lastBody, /"token"/);
  } finally {
    await gateway.stop();
    main.server.close();
  }
});
