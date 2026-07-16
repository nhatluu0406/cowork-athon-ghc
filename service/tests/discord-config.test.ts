import { test } from "node:test";
import assert from "node:assert/strict";
import { readDiscordConfig } from "../src/remote-gateway/discord/index.js";
import { createDiscordRestTransport } from "../src/remote-gateway/discord/rest-transport.js";

test("readDiscordConfig returns null unless flag + all required fields are present", () => {
  assert.equal(readDiscordConfig({}), null);
  assert.equal(readDiscordConfig({ CGHC_DISCORD_ENABLED: "1" }), null);
  assert.equal(
    readDiscordConfig({ CGHC_DISCORD_ENABLED: "1", CGHC_DISCORD_BOT_TOKEN: "t" }),
    null,
    "channel + users still missing",
  );
  // Enabled flag off ⇒ config ignored even if present.
  assert.equal(
    readDiscordConfig({
      CGHC_DISCORD_BOT_TOKEN: "t",
      CGHC_DISCORD_CHANNEL_ID: "c",
      CGHC_DISCORD_ALLOWED_USER_IDS: "u1",
    }),
    null,
  );
  const cfg = readDiscordConfig({
    CGHC_DISCORD_ENABLED: "1",
    CGHC_DISCORD_BOT_TOKEN: "bot-token",
    CGHC_DISCORD_CHANNEL_ID: "123",
    CGHC_DISCORD_ALLOWED_USER_IDS: "u1, u2 ,, u3",
  });
  assert.ok(cfg);
  assert.equal(cfg.channelId, "123");
  assert.deepEqual(cfg.allowedUserIds, ["u1", "u2", "u3"]);
});

test("rest transport sends via Discord API with a Bot auth header and no token in logs", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const logs: string[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init !== undefined ? { init } : {}) });
    return new Response(JSON.stringify({ id: "1" }), { status: 200 });
  }) as unknown as typeof fetch;

  const transport = createDiscordRestTransport({
    botToken: "super-secret-bot-token",
    channelId: "chan-1",
    fetch: fakeFetch,
    log: (l) => logs.push(l),
  });

  await transport.send("xin chao");
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /channels\/chan-1\/messages/);
  const headers = calls[0]!.init!.headers as Record<string, string>;
  assert.equal(headers["authorization"], "Bot super-secret-bot-token");
  assert.doesNotMatch(logs.join("\n"), /super-secret-bot-token/);
});

test("rest transport poll skips bot messages and maps user messages to inbound", async () => {
  let page = 0;
  const fakeFetch = (async () => {
    page += 1;
    if (page === 1) {
      // first poll: newest-first from Discord
      return new Response(
        JSON.stringify([
          { id: "20", content: "deny r1", author: { id: "user-1", bot: false } },
          { id: "19", content: "bot echo", author: { id: "bot-x", bot: true } },
        ]),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify([]), { status: 200 });
  }) as unknown as typeof fetch;

  const transport = createDiscordRestTransport({
    botToken: "t",
    channelId: "c",
    fetch: fakeFetch,
  });

  const inbound = await transport.poll();
  assert.equal(inbound.length, 1);
  assert.deepEqual(inbound[0], { userId: "user-1", text: "deny r1" });

  // Second poll after advancing the cursor returns nothing.
  const empty = await transport.poll();
  assert.equal(empty.length, 0);
});
