/**
 * CGHC-018 / CGHC-016 LOW-2 — the LIVE runtime-reply adapter redacts its transport errors.
 *
 * A raw `fetch` error commonly embeds the request URL (base URL + permission id) and can echo a
 * bearer token. This proves the {@link createLiveRuntimeReplyPort} adapter scrubs every such
 * error BEFORE it reaches the reporter, and rethrows only a fixed, secret-free
 * {@link RuntimeReplyError}. No URL/token substring reaches the reporter output or the thrown
 * error. The transport is injected, so no live server is needed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PermissionReply } from "@cowork-ghc/contracts";
import {
  createLiveRuntimeReplyPort,
  RuntimeReplyError,
  type RuntimeReplyTransport,
} from "../src/files/index.js";

const BASE_URL = "http://127.0.0.1:53421";
const TOKEN = "rtk-SECRET-TOKEN-abcdef0123456789";

/** A transport that fails with an error whose message leaks the URL + bearer token (worst case). */
function leakyTransport(): RuntimeReplyTransport {
  return {
    async post(url, _body, headers) {
      const auth = headers["authorization"] ?? "";
      throw new Error(`ECONNREFUSED calling ${url} with header ${auth}`);
    },
  };
}

const ALLOW: PermissionReply = { requestId: "req-42", decision: "allow", scope: "once" };

test("LOW-2: a leaky transport error is redacted before it reaches the reporter", async () => {
  const reported: string[] = [];
  const port = createLiveRuntimeReplyPort({
    baseUrl: BASE_URL,
    token: TOKEN,
    transport: leakyTransport(),
    onReplyError: (message) => reported.push(message),
  });

  await assert.rejects(port.reply(ALLOW), (err: unknown) => err instanceof RuntimeReplyError);

  assert.equal(reported.length, 1, "the transport failure was reported once");
  const line = reported[0] ?? "";
  assert.equal(line.includes(TOKEN), false, "the bearer token never reaches the reporter");
  assert.equal(line.includes(BASE_URL), false, "the base URL never reaches the reporter");
  assert.equal(line.includes("req-42"), false, "the permission id is not embedded via the URL");
  assert.equal(/https?:\/\//.test(line), false, "no URL-shaped substring survives redaction");
  assert.equal(/[Bb]earer\s+\S*SECRET/.test(line), false, "no bearer-token-shaped substring survives");
});

test("LOW-2: the rethrown error carries only a fixed, secret-free message", async () => {
  const port = createLiveRuntimeReplyPort({
    baseUrl: BASE_URL,
    token: TOKEN,
    transport: leakyTransport(),
    onReplyError: () => {},
  });

  await port.reply(ALLOW).then(
    () => assert.fail("expected a RuntimeReplyError"),
    (err: unknown) => {
      assert.ok(err instanceof RuntimeReplyError);
      const message = (err as RuntimeReplyError).message;
      assert.equal(message.includes(TOKEN), false);
      assert.equal(message.includes(BASE_URL), false);
      assert.equal(/https?:\/\//.test(message), false);
    },
  );
});

test("a successful reply POSTs the mapped OpenCode response body", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const transport: RuntimeReplyTransport = {
    async post(url, body) {
      calls.push({ url, body });
    },
  };
  const port = createLiveRuntimeReplyPort({ baseUrl: BASE_URL, token: TOKEN, transport });

  await port.reply({ requestId: "req-7", decision: "allow", scope: "always" });
  await port.reply({ requestId: "req-8", decision: "deny" });

  assert.deepEqual(calls[0]?.body, { response: "always" });
  assert.deepEqual(calls[1]?.body, { response: "reject" });
  assert.equal(calls[0]?.url, `${BASE_URL}/permission/req-7/reply`);
});
