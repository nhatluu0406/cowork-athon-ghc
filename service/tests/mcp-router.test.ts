/**
 * MCP Phase 1 HTTP router test (Wave 2B) — CRUD + enable/disable/health mounted on the loopback
 * boundary, backed by an in-memory SQLite store + the real {@link McpRegistry} lifecycle and a
 * fake adapter/credential store so no real process or network call is made.
 *
 * A `headerSecret` crosses the boundary ONLY inbound: asserts the response never carries the
 * value (only `hasHeaderSecret`), and that the vault holds the value under `mcp:<id>:header`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { startService } from "../src/index.js";
import { createMcpRegistry, type McpAdapter, type McpConnectionResult } from "../src/extensions/index.js";
import { createSqliteMcpStore, openMemorySqliteDatabase, runMigrations } from "../src/db/index.js";
import { createMemoryStore } from "../src/credential/index.js";
import { createMcpRouter } from "../src/mcp/index.js";
import { SsrfBlockedError, type SsrfPolicy } from "../src/provider/index.js";

const FIXED_NOW = (): string => "2026-07-16T02:00:00.000Z";
const HEADER_SECRET = "sk-mcp-router-DO-NOT-LEAK-7";

function fakeSsrf(): SsrfPolicy {
  return {
    async evaluate(rawUrl) {
      return rawUrl.startsWith("https://")
        ? { allowed: true, target: { url: new URL(rawUrl), resolved: [] } }
        : { allowed: false, reason: "scheme_not_https", detail: rawUrl };
    },
    async assertAllowed(rawUrl) {
      if (!rawUrl.startsWith("https://")) throw new SsrfBlockedError("scheme_not_https", rawUrl);
      return { url: new URL(rawUrl), resolved: [] };
    },
  };
}

function fakeAdapter(): McpAdapter {
  const connected: McpConnectionResult = { status: "connected", detail: "fake host" };
  return {
    connect: () => Promise.resolve(connected),
    disconnect: () => Promise.resolve(),
    health: () => Promise.resolve(connected),
  };
}

function freshDeps() {
  const db = openMemorySqliteDatabase();
  runMigrations(db, undefined, FIXED_NOW);
  const store = createSqliteMcpStore(db);
  const credentials = createMemoryStore();
  const registry = createMcpRegistry({ adapter: fakeAdapter(), ssrf: fakeSsrf() });
  return { store, credentials, registry };
}

async function withRunningRouter(
  fn: (ctx: {
    baseUrl: string;
    token: string;
    store: ReturnType<typeof createSqliteMcpStore>;
    credentials: ReturnType<typeof createMemoryStore>;
  }) => Promise<void>,
): Promise<void> {
  const { store, credentials, registry } = freshDeps();
  const router = createMcpRouter({ registry, store, credentials, now: FIXED_NOW });
  const running = await startService({ routers: [router] });
  try {
    await fn({ baseUrl: running.baseUrl, token: running.clientToken, store, credentials });
  } finally {
    await running.service.stop();
  }
}

function authed(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

test("POST creates a server, persists it, and the response never carries a secret", async () => {
  await withRunningRouter(async ({ baseUrl, token, store, credentials }) => {
    const res = await fetch(`${baseUrl}/v1/mcp/servers`, {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ id: "srv-1", name: "Files MCP", command: "files-mcp", headerSecret: HEADER_SECRET }),
    });
    assert.equal(res.status, 201);
    const rawText = await res.text();
    assert.ok(!rawText.includes(HEADER_SECRET), "response body must NOT contain the header secret");
    const body = JSON.parse(rawText) as {
      data: { server: { id: string; name: string; enabled: boolean; hasHeaderSecret: boolean; toolCount: number } };
    };
    assert.equal(body.data.server.id, "srv-1");
    assert.equal(body.data.server.enabled, false);
    assert.equal(body.data.server.hasHeaderSecret, true);
    assert.equal(body.data.server.toolCount, 0);

    // Persisted (non-secret) config.
    assert.deepEqual(store.get("srv-1"), {
      id: "srv-1",
      name: "Files MCP",
      command: "files-mcp",
      enabled: false,
      updatedAt: FIXED_NOW(),
    });
    // The secret lives ONLY in the credential store, under the documented vault account.
    assert.equal(await credentials.get("mcp:srv-1:header"), HEADER_SECRET);
  });
});

test("a remote URL server is SSRF-validated before it is persisted", async () => {
  await withRunningRouter(async ({ baseUrl, token, store }) => {
    const blocked = await fetch(`${baseUrl}/v1/mcp/servers`, {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ id: "remote-1", name: "Remote", url: "http://169.254.169.254/mcp" }),
    });
    assert.equal(blocked.status, 400);
    assert.equal(store.get("remote-1"), null, "an unvalidated remote endpoint is NOT persisted");

    const allowed = await fetch(`${baseUrl}/v1/mcp/servers`, {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ id: "remote-2", name: "Remote OK", url: "https://mcp.example.com/sse" }),
    });
    assert.equal(allowed.status, 201);
    assert.ok(store.get("remote-2") !== null);
  });
});

test("GET lists servers and GET by id returns one; unknown id is a 400 bad_request", async () => {
  await withRunningRouter(async ({ baseUrl, token }) => {
    await fetch(`${baseUrl}/v1/mcp/servers`, {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ id: "srv-1", name: "Files MCP", command: "files-mcp" }),
    });

    const list = await fetch(`${baseUrl}/v1/mcp/servers`, { headers: authed(token) });
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as { data: { servers: readonly { id: string }[] } };
    assert.equal(listBody.data.servers.length, 1);
    assert.equal(listBody.data.servers[0]?.id, "srv-1");

    const one = await fetch(`${baseUrl}/v1/mcp/servers/srv-1`, { headers: authed(token) });
    assert.equal(one.status, 200);

    const missing = await fetch(`${baseUrl}/v1/mcp/servers/does-not-exist`, { headers: authed(token) });
    assert.equal(missing.status, 400);
  });
});

test("enable/disable flips status + connection and persists the enabled flag", async () => {
  await withRunningRouter(async ({ baseUrl, token, store }) => {
    await fetch(`${baseUrl}/v1/mcp/servers`, {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ id: "srv-1", name: "Files MCP", command: "files-mcp" }),
    });

    const enabled = await fetch(`${baseUrl}/v1/mcp/servers/srv-1/enable`, { method: "POST", headers: authed(token) });
    assert.equal(enabled.status, 200);
    const enabledBody = (await enabled.json()) as { data: { server: { enabled: boolean; connection: string } } };
    assert.equal(enabledBody.data.server.enabled, true);
    assert.equal(enabledBody.data.server.connection, "connected");
    assert.equal(store.get("srv-1")?.enabled, true);

    const health = await fetch(`${baseUrl}/v1/mcp/servers/srv-1/health`, { headers: authed(token) });
    assert.equal(health.status, 200);
    const healthBody = (await health.json()) as { data: { connection: string } };
    assert.equal(healthBody.data.connection, "connected");

    const disabled = await fetch(`${baseUrl}/v1/mcp/servers/srv-1/disable`, {
      method: "POST",
      headers: authed(token),
    });
    assert.equal(disabled.status, 200);
    const disabledBody = (await disabled.json()) as { data: { server: { enabled: boolean; connection: string } } };
    assert.equal(disabledBody.data.server.enabled, false);
    assert.equal(disabledBody.data.server.connection, "disconnected");
    assert.equal(store.get("srv-1")?.enabled, false);
  });
});

test("PATCH renames a server and can set/clear a header secret without dropping the row", async () => {
  await withRunningRouter(async ({ baseUrl, token, store, credentials }) => {
    await fetch(`${baseUrl}/v1/mcp/servers`, {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ id: "srv-1", name: "Files MCP", command: "files-mcp" }),
    });

    const renamed = await fetch(`${baseUrl}/v1/mcp/servers/srv-1`, {
      method: "PATCH",
      headers: authed(token),
      body: JSON.stringify({ name: "Renamed MCP", headerSecret: HEADER_SECRET }),
    });
    assert.equal(renamed.status, 200);
    const renamedBody = (await renamed.json()) as { data: { server: { name: string; hasHeaderSecret: boolean } } };
    assert.equal(renamedBody.data.server.name, "Renamed MCP");
    assert.equal(renamedBody.data.server.hasHeaderSecret, true);
    assert.equal(store.get("srv-1")?.name, "Renamed MCP");
    assert.equal(await credentials.get("mcp:srv-1:header"), HEADER_SECRET);

    const cleared = await fetch(`${baseUrl}/v1/mcp/servers/srv-1`, {
      method: "PATCH",
      headers: authed(token),
      body: JSON.stringify({ headerSecret: null }),
    });
    assert.equal(cleared.status, 200);
    const clearedBody = (await cleared.json()) as { data: { server: { hasHeaderSecret: boolean } } };
    assert.equal(clearedBody.data.server.hasHeaderSecret, false);
    assert.equal(await credentials.get("mcp:srv-1:header"), null);
  });
});

test("DELETE removes the server, the persisted row, and any header secret", async () => {
  await withRunningRouter(async ({ baseUrl, token, store, credentials }) => {
    await fetch(`${baseUrl}/v1/mcp/servers`, {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ id: "srv-1", name: "Files MCP", command: "files-mcp", headerSecret: HEADER_SECRET }),
    });

    const deleted = await fetch(`${baseUrl}/v1/mcp/servers/srv-1`, { method: "DELETE", headers: authed(token) });
    assert.equal(deleted.status, 200);
    assert.equal(store.get("srv-1"), null);
    assert.equal(await credentials.get("mcp:srv-1:header"), null);

    const missing = await fetch(`${baseUrl}/v1/mcp/servers/srv-1`, { headers: authed(token) });
    assert.equal(missing.status, 400);
  });
});

test("every MCP route is token-guarded (missing token -> 401)", async () => {
  await withRunningRouter(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/v1/mcp/servers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "srv-1", name: "Files MCP", command: "files-mcp" }),
    });
    assert.equal(res.status, 401);
  });
});
