/**
 * CGHC-028 Wave A2 — LIVE {@link RuntimeReplyPort} adapter over a FAKE OpenCode HTTP server.
 *
 * Proves an Allow and a Deny POST the request-id reply route with the right body, and that a 5xx
 * surfaces as a TYPED rejection (never an unhandled throw that strands the gate's FIX-3 path).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PermissionReply } from "@cowork-ghc/contracts";
import { createOpencodeHttp, createOpencodeRuntimeReply, OpencodeHttpError } from "../src/runtime/index.js";
import { startFakeOpencodeServer, type FakeOpencodeServer } from "./opencode-fake-server.js";

function replyFor(fake: FakeOpencodeServer) {
  const http = createOpencodeHttp({ baseUrl: () => fake.baseUrl, timeoutMs: 4_000 });
  return createOpencodeRuntimeReply({ http });
}

test("an Allow and a Deny POST /permission/{requestId}/reply with the decision body", async () => {
  const fake = await startFakeOpencodeServer();
  try {
    const port = replyFor(fake);

    const allow: PermissionReply = { requestId: "req-allow", decision: "allow", scope: "once" };
    await port.reply(allow);
    const deny: PermissionReply = { requestId: "req-deny", decision: "deny" };
    await port.reply(deny);

    const allowReq = fake.requests.find((r) => r.path === "/permission/req-allow/reply");
    assert.ok(allowReq, "the allow reply hit the request-id route");
    assert.equal(allowReq?.method, "POST");
    assert.deepEqual(allowReq?.body, { decision: "allow", scope: "once" });

    const denyReq = fake.requests.find((r) => r.path === "/permission/req-deny/reply");
    assert.ok(denyReq, "the deny reply hit the request-id route");
    assert.deepEqual(denyReq?.body, { decision: "deny" }); // no scope on a deny
  } finally {
    await fake.close();
  }
});

test("a 5xx reply surfaces as a typed OpencodeHttpError rejection", async () => {
  const fake = await startFakeOpencodeServer();
  try {
    const port = replyFor(fake);
    fake.state.forceStatus.set("POST /permission/req-x/reply", 503);
    await assert.rejects(
      () => port.reply({ requestId: "req-x", decision: "deny" }),
      (err: unknown) => err instanceof OpencodeHttpError && err.status === 503,
    );
  } finally {
    await fake.close();
  }
});
