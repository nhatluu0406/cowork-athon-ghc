// service/tests/ms365-teams-service.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTeamsService, buildTeamsBody } from "../src/ms365/teams-service.js";
import type { Ms365Connector } from "../src/ms365/ms365-connector.js";
import type { GraphClient, GraphClientRequest } from "../src/ms365/graph-client.js";

function connectorReturning(
  recorder: GraphClientRequest[],
  responder: (r: GraphClientRequest) => unknown,
): Ms365Connector {
  const graph: GraphClient = {
    json: async (r) => {
      recorder.push(r);
      return responder(r) as never;
    },
    bytes: async (r) => {
      recorder.push(r);
      return responder(r) as Uint8Array;
    },
    noContent: async (r) => {
      recorder.push(r);
      responder(r);
    },
  };
  return {
    connectionState: () => "connected",
    connectWithToken: async () => {},
    disconnect: async () => {},
    graph: () => graph,
    source: () => "manual_token",
    lastError: () => null,
  };
}

test("buildTeamsBody escapes HTML and substitutes @{i} placeholders", () => {
  const out = buildTeamsBody("Hello @{0}, xem <b>report</b> & reply", [{ userId: "u1", displayName: "Alice <QA>" }]);
  assert.equal(
    out.body.content,
    'Hello <at id="0">Alice &lt;QA&gt;</at>, xem &lt;b&gt;report&lt;/b&gt; &amp; reply',
  );
  assert.deepEqual(out.mentions, [
    { id: 0, mentionText: "Alice <QA>", mentioned: { user: { id: "u1", displayName: "Alice <QA>" } } },
  ]);
});

test("buildTeamsBody throws when a placeholder has no mention", () => {
  assert.throws(() => buildTeamsBody("Hi @{1}", [{ userId: "u1", displayName: "A" }]), /placeholder/i);
});

test("buildTeamsBody with no mentions returns escaped html and empty mentions", () => {
  const out = buildTeamsBody("a < b", []);
  assert.equal(out.body.content, "a &lt; b");
  assert.deepEqual(out.mentions, []);
});

test("listChats maps /me/chats with topic default and member names", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [
    { id: "c1", topic: "Dự án X", members: [{ displayName: "A" }, { displayName: "B" }] },
    { id: "c2", topic: null, members: "bad" }, // topic null → "", members bad → []
    { topic: "no id" }, // dropped
  ]}));
  const svc = createTeamsService({ connector: conn });
  const chats = await svc.listChats();
  assert.deepEqual(chats, [
    { id: "c1", topic: "Dự án X", memberNames: ["A", "B"] },
    { id: "c2", topic: "", memberNames: [] },
  ]);
  assert.match(seen[0].path, /\/me\/chats/);
  assert.equal(seen[0].query?.["$expand"], "members");
});

test("listTeams + listChannels map and cap", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, (r) =>
    r.path.includes("joinedTeams")
      ? { value: [{ id: "t1", displayName: "Team A" }] }
      : { value: [{ id: "ch1", displayName: "General" }] });
  const svc = createTeamsService({ connector: conn });
  assert.deepEqual(await svc.listTeams(), [{ id: "t1", displayName: "Team A" }]);
  assert.deepEqual(await svc.listChannels("t1"), [{ id: "ch1", displayName: "General" }]);
  assert.match(seen[1].path, /\/teams\/t1\/channels/);
});

test("listMembers maps chat members (userId from userId field)", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [
    { userId: "u1", displayName: "Alice" },
    { displayName: "no userid" }, // dropped
  ]}));
  const members = await createTeamsService({ connector: conn }).listMembers({ chatId: "c1" });
  assert.deepEqual(members, [{ userId: "u1", displayName: "Alice" }]);
  assert.match(seen[0].path, /\/chats\/c1\/members/);
});

test("listMembers with teamId hits /teams/{id}/members", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [] }));
  await createTeamsService({ connector: conn }).listMembers({ teamId: "t1" });
  assert.match(seen[0].path, /\/teams\/t1\/members/);
});

test("getMessages: chat target hits /chats/{id}/messages with $top; text bounded; from mapped", async () => {
  const seen: GraphClientRequest[] = [];
  const long = "x".repeat(5000);
  const conn = connectorReturning(seen, () => ({ value: [
    { id: "m1", from: { user: { displayName: "Bob" } }, createdDateTime: "2026-07-14T00:00:00Z", body: { content: long } },
    { id: "m2" }, // from/body thiếu → "" / ""
  ]}));
  const svc = createTeamsService({ connector: conn, maxTextChars: 4096 });
  const msgs = await svc.getMessages({ chatId: "c1" });
  assert.equal(msgs[0].text.length, 4096);
  assert.equal(msgs[0].from, "Bob");
  assert.deepEqual(msgs[1], { id: "m2", from: "", createdDateTime: "", text: "" });
  assert.match(seen[0].path, /\/chats\/c1\/messages/);
  assert.equal(seen[0].query?.["$top"], "50");
});

test("getMessages: channel target hits /teams/{tid}/channels/{cid}/messages", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ value: [] }));
  await createTeamsService({ connector: conn }).getMessages({ teamId: "t1", channelId: "ch1" });
  assert.match(seen[0].path, /\/teams\/t1\/channels\/ch1\/messages/);
});

test("postMessage POSTs html body + mentions to the right path and returns id", async () => {
  const seen: GraphClientRequest[] = [];
  const conn = connectorReturning(seen, () => ({ id: "msg9" }));
  const out = await createTeamsService({ connector: conn }).postMessage({
    target: { teamId: "t1", channelId: "ch1" },
    content: "Deadline @{0}!",
    mentions: [{ userId: "u1", displayName: "Alice" }],
  });
  assert.deepEqual(out, { id: "msg9" });
  assert.equal(seen[0].method, "POST");
  assert.match(seen[0].path, /\/teams\/t1\/channels\/ch1\/messages/);
  const body = seen[0].body as { body: { contentType: string; content: string }; mentions: unknown[] };
  assert.equal(body.body.contentType, "html");
  assert.match(body.body.content, /<at id="0">Alice<\/at>/);
  assert.equal(body.mentions.length, 1);
});
