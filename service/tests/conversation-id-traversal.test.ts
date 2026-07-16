/**
 * Path-traversal regression for the conversation `{id}` segment.
 *
 * The router registry decodes a `{id}` segment AFTER splitting the path on "/", so an
 * encoded slash (`..%2Fvictim`) reaches a handler as the real path `../victim`. The store
 * turns an id straight into `<root>/<id>.json`, so an unvalidated id reads outside its root.
 * This was reachable from a paired phone: the remote gateway forwards
 * `/api/conversations/{id}` to `/v1/conversations/{id}` using the MAIN client token.
 */

import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createConversationStore } from "../src/conversation/store.js";
import { createConversationRouter } from "../src/conversation/router.js";
import { RouterRegistry } from "../src/server/router-registry.js";

const NOW = (): string => "2026-07-15T00:00:00.000Z";

test("an encoded-traversal conversation id is rejected, not read off disk", async () => {
  const base = await mkdtemp(join(tmpdir(), "cghc-traversal-"));
  const root = join(base, "conv");
  await writeFile(join(base, "victim.json"), JSON.stringify({ private: "USER_SECRET_DATA" }), "utf8");

  const store = createConversationStore({ rootDir: root, now: NOW });
  await store.create({ workspacePath: "C:/fixture/ws" });

  const registry = new RouterRegistry();
  registry.mount(createConversationRouter(store));

  // What the gateway would forward for GET /api/conversations/..%2Fvictim.
  const match = registry.match("GET", "/v1/conversations/..%2Fvictim");
  assert.ok(match, "the pattern route still matches; rejection must happen in the handler");
  // The registry decodes into a real relative path — this is why the handler must validate.
  assert.equal(match.params["id"], "../victim");

  await assert.rejects(
    () =>
      match.definition.handler({
        method: "GET",
        url: new URL("http://127.0.0.1/v1/conversations/..%2Fvictim"),
        params: match.params,
        body: undefined,
      }),
    /not a valid conversation id/,
  );

  // The file outside the root is untouched and was never returned.
  const victim = JSON.parse(await readFile(join(base, "victim.json"), "utf8")) as { private: string };
  assert.equal(victim.private, "USER_SECRET_DATA");

  await rm(base, { recursive: true, force: true });
});

test("a real uuid id still resolves normally", async () => {
  const base = await mkdtemp(join(tmpdir(), "cghc-traversal-ok-"));
  const store = createConversationStore({ rootDir: join(base, "conv"), now: NOW });
  const created = await store.create({ workspacePath: "C:/fixture/ws" });

  const registry = new RouterRegistry();
  registry.mount(createConversationRouter(store));
  const match = registry.match("GET", `/v1/conversations/${created.id}`);
  assert.ok(match);

  const result = await match.definition.handler({
    method: "GET",
    url: new URL(`http://127.0.0.1/v1/conversations/${created.id}`),
    params: match.params,
    body: undefined,
  });
  assert.equal(result.status, 200);

  await rm(base, { recursive: true, force: true });
});
