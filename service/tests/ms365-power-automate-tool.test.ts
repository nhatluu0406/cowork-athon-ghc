import { test } from "node:test";
import assert from "node:assert/strict";
import { handleToolCall, type ToolDeps } from "../src/ms365/ms365-tools.js";

function baseDeps(overrides: Partial<ToolDeps>): ToolDeps {
  return {
    // Only the fields these tests touch are real; the rest are never reached because the tool
    // is power_automate_trigger_flow. Cast the whole object to ToolDeps at the end.
    connectionState: () => "connected",
    sessionAllowed: () => true,
    gate: {
      submit: () => {},
      isAllowed: () => true,
      pending: () => [],
      proceed: (_id: string, fn: () => unknown) => ({ performed: true, result: fn() }),
    } as unknown as ToolDeps["gate"],
    wait: async () => "allowed",
    now: () => "2026-07-17T00:00:00.000Z",
    ...overrides,
  } as unknown as ToolDeps;
}

const call = (args: Record<string, unknown>) => ({
  name: "power_automate_trigger_flow" as const,
  args,
  sessionId: "s1",
  requestId: "r1",
});

test("trigger by name resolves + returns flow feedback", async () => {
  let triggered: { url: string; timeoutMs: number } | null = null;
  const deps = baseDeps({
    powerAutomate: {
      listFlows: () => [],
      resolveFlow: (n: string) => (n === "f1" ? { url: "https://x/1?sig=a", timeoutMs: 7000, enabled: true } : null),
      triggerFlow: async (i: { url: string; timeoutMs: number }) => {
        triggered = { url: i.url, timeoutMs: i.timeoutMs };
        return { status: 200, body: "done" };
      },
    } as unknown as ToolDeps["powerAutomate"],
  });
  const res = await handleToolCall(deps, call({ name: "f1", payload: { a: 1 } }));
  assert.deepEqual(res, { ok: true, data: { status: 200, body: "done" } });
  assert.deepEqual(triggered, { url: "https://x/1?sig=a", timeoutMs: 7000 });
});

test("trigger by name refuses a disabled flow (endpoint_blocked), never triggers", async () => {
  let called = false;
  const deps = baseDeps({
    powerAutomate: {
      listFlows: () => [],
      resolveFlow: () => ({ url: "https://x/1?sig=a", timeoutMs: 7000, enabled: false }),
      triggerFlow: async () => {
        called = true;
        return { status: 200, body: "" };
      },
    } as unknown as ToolDeps["powerAutomate"],
  });
  const res = await handleToolCall(deps, call({ name: "f1" }));
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.error.kind, "endpoint_blocked");
  assert.equal(called, false);
});

test("trigger by unknown name → not_found", async () => {
  const deps = baseDeps({
    powerAutomate: {
      listFlows: () => [],
      resolveFlow: () => null,
      triggerFlow: async () => ({ status: 200, body: "" }),
    } as unknown as ToolDeps["powerAutomate"],
  });
  const res = await handleToolCall(deps, call({ name: "nope" }));
  assert.equal(res.ok === false && res.error.kind, "not_found");
});

test("legacy url path still triggers with default timeout", async () => {
  let triggered: { url: string; timeoutMs: number } | null = null;
  const deps = baseDeps({
    powerAutomate: {
      listFlows: () => [],
      resolveFlow: () => null,
      triggerFlow: async (i: { url: string; timeoutMs: number }) => {
        triggered = { url: i.url, timeoutMs: i.timeoutMs };
        return { status: 202, body: "" };
      },
    } as unknown as ToolDeps["powerAutomate"],
  });
  const res = await handleToolCall(deps, call({ url: "https://x/direct?sig=z" }));
  assert.deepEqual(res, { ok: true, data: { status: 202, body: "" } });
  assert.equal(triggered?.timeoutMs, 120_000);
});

test("missing both name and url → invalid", async () => {
  const deps = baseDeps({
    powerAutomate: { listFlows: () => [], resolveFlow: () => null, triggerFlow: async () => ({ status: 200, body: "" }) } as unknown as ToolDeps["powerAutomate"],
  });
  const res = await handleToolCall(deps, call({}));
  assert.equal(res.ok, false);
});
