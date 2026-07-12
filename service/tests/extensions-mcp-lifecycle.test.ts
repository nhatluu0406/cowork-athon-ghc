/**
 * CGHC-026 RE2/RE5 — MCP server lifecycle integration test.
 *
 * Drives add → enable → disable → remove through a FAKE {@link McpAdapter} and asserts:
 *  - the state transitions (disabled → enabled → disabled → gone) in the ONE source of truth,
 *  - remove disconnects a live entry FIRST,
 *  - the honest not-attached default reports `unavailable` (never a fabricated `connected`),
 *  - a connect FAILURE is captured as an {@link ExtensionDiagnostic} (name + reason) and the
 *    registry stays alive (RE5) — no throw escapes.
 *
 * No live process, no network: the adapter is an in-memory fake.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createExtensionState,
  createMcpRegistry,
  notAttachedMcpAdapter,
  type McpAdapter,
  type McpConnectionResult,
} from "../src/extensions/index.js";
import { SsrfBlockedError, type SsrfPolicy } from "../src/provider/index.js";

/** A fake SSRF policy: allows https URLs, refuses everything else (deterministic, no DNS). */
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

const FIXED_NOW = () => "2026-07-11T00:00:00.000Z";

/** A recording fake adapter. `connect`/`disconnect` can be told to reject to prove RE5 capture. */
function fakeAdapter(opts: { connectRejects?: boolean; disconnectRejects?: boolean } = {}): {
  adapter: McpAdapter;
  disconnects: string[];
} {
  const disconnects: string[] = [];
  const connected: McpConnectionResult = { status: "connected", detail: "fake host" };
  return {
    disconnects,
    adapter: {
      connect: () =>
        opts.connectRejects
          ? Promise.reject(new Error("host refused the MCP handshake"))
          : Promise.resolve(connected),
      disconnect: (id) => {
        disconnects.push(id);
        return opts.disconnectRejects
          ? Promise.reject(new Error("host kept rejecting the disconnect"))
          : Promise.resolve();
      },
      health: () => Promise.resolve(connected),
    },
  };
}

test("add → enable → disable → remove transitions in the one state map", async () => {
  const state = createExtensionState({ now: FIXED_NOW });
  const { adapter, disconnects } = fakeAdapter();
  const mcp = createMcpRegistry({ state, adapter });

  const added = await mcp.add({ id: "srv-1", name: "Files MCP", command: "files-mcp" });
  assert.ok(added.ok);
  assert.equal(added.value.status, "disabled");
  assert.equal(added.value.connection, "disconnected");
  assert.equal(state.status("mcp", "srv-1"), "disabled");

  const enabled = await mcp.enable("srv-1");
  assert.ok(enabled.ok);
  assert.equal(enabled.value.status, "enabled");
  assert.equal(enabled.value.connection, "connected");

  const disabled = await mcp.disable("srv-1");
  assert.ok(disabled.ok);
  assert.equal(disabled.value.status, "disabled");
  assert.equal(disabled.value.connection, "disconnected");
  assert.deepEqual(disconnects, ["srv-1"]);

  const removed = await mcp.remove("srv-1");
  assert.ok(removed.ok);
  assert.equal(mcp.get("srv-1"), undefined);
  assert.equal(state.status("mcp", "srv-1"), undefined);
});

test("remove disconnects a LIVE entry first", async () => {
  const { adapter, disconnects } = fakeAdapter();
  const mcp = createMcpRegistry({ adapter });
  await mcp.add({ id: "srv-1", name: "Live", command: "live-mcp" });
  await mcp.enable("srv-1");
  disconnects.length = 0;

  const removed = await mcp.remove("srv-1");
  assert.ok(removed.ok);
  assert.deepEqual(disconnects, ["srv-1"], "remove disconnected the live host before dropping it");
});

test("re-adding an existing id is an honest duplicate error (no clobber)", async () => {
  const mcp = createMcpRegistry({ adapter: fakeAdapter().adapter });
  await mcp.add({ id: "srv-1", name: "First", command: "a" });
  const dup = await mcp.add({ id: "srv-1", name: "Second", command: "b" });
  assert.equal(dup.ok, false);
  assert.equal(dup.ok === false && dup.error.code, "duplicate_extension");
  assert.equal(mcp.get("srv-1")?.config.name, "First", "the original entry was not clobbered");
});

test("the honest not-attached default reports unavailable — never fabricates connected", async () => {
  const mcp = createMcpRegistry({ adapter: notAttachedMcpAdapter() });
  await mcp.add({ id: "srv-1", name: "NotAttached", command: "x" });
  const enabled = await mcp.enable("srv-1");
  assert.ok(enabled.ok);
  // Intent is enabled, but the connection is honestly unavailable (no fake "connected").
  assert.equal(enabled.value.status, "enabled");
  assert.equal(enabled.value.connection, "unavailable");

  const health = await mcp.health("srv-1");
  assert.ok(health.ok);
  assert.equal(health.value, "unavailable");
});

test("a URL endpoint is SSRF-validated before persistence (mirrors the provider port)", async () => {
  const mcp = createMcpRegistry({ adapter: fakeAdapter().adapter, ssrf: fakeSsrf() });

  const blocked = await mcp.add({ id: "remote-1", name: "Remote", url: "http://169.254.169.254/mcp" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ok === false && blocked.error.code, "endpoint_blocked");
  assert.equal(mcp.get("remote-1"), undefined, "an unvalidated remote endpoint is NOT persisted");

  const allowed = await mcp.add({ id: "remote-2", name: "Remote OK", url: "https://mcp.example.com/sse" });
  assert.ok(allowed.ok);
  assert.equal(allowed.value.status, "disabled");
});

test("a URL endpoint without an SSRF policy is refused (never stored unvalidated)", async () => {
  const mcp = createMcpRegistry({ adapter: fakeAdapter().adapter });
  const blocked = await mcp.add({ id: "remote-1", name: "Remote", url: "https://mcp.example.com" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ok === false && blocked.error.code, "endpoint_blocked");
});

test("a connect FAILURE is captured as a diagnostic and the registry stays alive (RE5)", async () => {
  const state = createExtensionState({ now: FIXED_NOW });
  const { adapter } = fakeAdapter({ connectRejects: true });
  const mcp = createMcpRegistry({ state, adapter });
  await mcp.add({ id: "srv-1", name: "Broken MCP", command: "broken" });

  // enable() must NOT throw even though the adapter rejects.
  const enabled = await mcp.enable("srv-1");
  assert.equal(enabled.ok, false);
  assert.equal(enabled.ok === false && enabled.error.code, "extension_failed");

  // The failure is captured as a structured diagnostic (name + reason), quarantined.
  const diags = mcp.diagnostics();
  assert.equal(diags.length, 1);
  assert.equal(diags[0]?.kind, "mcp");
  assert.equal(diags[0]?.name, "Broken MCP");
  assert.match(diags[0]?.reason ?? "", /refused/);
  assert.equal(state.status("mcp", "srv-1"), "failed");

  // The registry is still alive: another server can be added + listed after the failure.
  const added = await mcp.add({ id: "srv-2", name: "Healthy", command: "ok" });
  assert.ok(added.ok);
  assert.equal(mcp.list().length, 2);

  // A quarantined server is skipped, not retried into a crash loop.
  const retry = await mcp.enable("srv-1");
  assert.equal(retry.ok === false && retry.error.code, "quarantined");

  // Sticky quarantine: disable() must NOT clear `failed` (FIX-1).
  const disabled = await mcp.disable("srv-1");
  assert.equal(disabled.ok === false && disabled.error.code, "quarantined");
  assert.equal(state.status("mcp", "srv-1"), "failed");

  // The ONE un-quarantine route is remove() + re-add() → a fresh, non-failed entry.
  const removed = await mcp.remove("srv-1");
  assert.ok(removed.ok);
  const readded = await mcp.add({ id: "srv-1", name: "Broken MCP", command: "broken" });
  assert.ok(readded.ok);
  assert.equal(state.status("mcp", "srv-1"), "disabled");
});

test("remove is best-effort: a rejecting disconnect still drops the entry + records a diagnostic (FIX-2)", async () => {
  const state = createExtensionState({ now: FIXED_NOW });
  const { adapter, disconnects } = fakeAdapter({ disconnectRejects: true });
  const mcp = createMcpRegistry({ state, adapter });
  await mcp.add({ id: "srv-1", name: "Sticky Host", command: "x" });
  await mcp.enable("srv-1"); // connect succeeds → live entry
  disconnects.length = 0;

  // remove() must NOT be blocked by the rejecting disconnect — the entry cannot be orphaned.
  const removed = await mcp.remove("srv-1");
  assert.ok(removed.ok, "remove still succeeds despite the disconnect rejection");
  assert.deepEqual(disconnects, ["srv-1"], "it did attempt the disconnect first");

  // The entry is gone from BOTH the entry map and the one source of truth.
  assert.equal(mcp.get("srv-1"), undefined);
  assert.equal(state.status("mcp", "srv-1"), undefined);
  assert.equal(mcp.list().length, 0);

  // The disconnect failure is recorded as a diagnostic (not silently swallowed).
  const diags = mcp.diagnostics();
  assert.equal(diags.length, 1);
  assert.equal(diags[0]?.kind, "mcp");
  assert.match(diags[0]?.reason ?? "", /disconnect/);
});
