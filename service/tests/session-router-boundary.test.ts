/**
 * CGHC-028 live-run wiring — the session boundary router over the COMPOSED Tier 1 service (no live
 * child). Proves: create/list work through the boundary against an injected in-memory store; the
 * message route HONESTLY reports `runtime_not_attached` (503) when no runtime is attached (never a
 * fabricated "sent"); malformed bodies → 400; an unknown session → 404. Plus a focused unit check
 * that the boundary registry resolves `{id}` path params (exact routes still win).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { startCoworkService } from "../src/composition/index.js";
import { createMemoryStore } from "../src/credential/index.js";
import type { SettingsFs } from "../src/diagnostics/index.js";
import type { SendPrompt, SessionStore, StoredSession } from "../src/session/index.js";
import { RouterRegistry } from "../src/server/router-registry.js";
import type { BoundaryRouter, RouteResult } from "../src/boundary/contract.js";

const WS = "C:/ws/tier1";
const NOW = (): string => "2026-07-12T00:00:00.000Z";

function memorySettingsFs(): SettingsFs {
  let data: string | undefined;
  return { read: () => Promise.resolve(data), write: (d) => { data = d; return Promise.resolve(); } };
}

function memSessionStore(): SessionStore {
  const sessions = new Map<string, StoredSession>();
  let n = 0;
  return {
    create: async (input) => {
      const id = `s${(n += 1)}`;
      const s: StoredSession = { id, title: input.title ?? "Untitled", workspaceId: input.workspaceId, createdAt: NOW(), updatedAt: NOW() };
      sessions.set(id, s);
      return s;
    },
    list: async () => [...sessions.values()],
    get: async (id) => sessions.get(id),
    rename: async (id, title) => { const s = { ...(sessions.get(id) as StoredSession), title }; sessions.set(id, s); return s; },
    replay: async () => [],
  };
}

const auth = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });
const jsonHeaders = (t: string): Record<string, string> => ({ ...auth(t), "content-type": "application/json" });

test("Tier 1 session boundary: create/list work; message honestly errors runtime_not_attached", async () => {
  const { running } = await startCoworkService({
    credentialStore: createMemoryStore(), settingsFs: memorySettingsFs(), sessionStore: memSessionStore(), now: NOW,
  });
  const base = running.baseUrl;
  const token = running.clientToken;
  try {
    // create → 201 with light, secret-free meta.
    const created = await fetch(`${base}/v1/session`, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify({ workspaceId: WS, title: "T1" }) });
    assert.equal(created.status, 201);
    const id = ((await created.json()) as { data: { session: { id: string; title: string } } }).data.session.id;

    // list → includes it.
    const listed = await fetch(`${base}/v1/session`, { headers: auth(token) });
    const sessions = ((await listed.json()) as { data: { sessions: Array<{ id: string }> } }).data.sessions;
    assert.ok(sessions.some((s) => s.id === id), "the created session is listed");

    // message with no runtime attached → honest 503 runtime_not_attached (no crash).
    const sent = await fetch(`${base}/v1/session/${id}/message`, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify({ text: "hi" }) });
    assert.equal(sent.status, 503, "no runtime → honest 503, not a fabricated 202");
    const body = (await sent.json()) as { data: { reason: string; accepted: boolean } };
    assert.equal(body.data.reason, "runtime_not_attached");
    assert.equal(body.data.accepted, false);
  } finally {
    await running.service.stop();
  }
});

test("Tier 1 session boundary: malformed bodies → 400, unknown session → 404", async () => {
  const { running } = await startCoworkService({
    credentialStore: createMemoryStore(), settingsFs: memorySettingsFs(), sessionStore: memSessionStore(), now: NOW,
  });
  const base = running.baseUrl;
  const token = running.clientToken;
  try {
    const noWs = await fetch(`${base}/v1/session`, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify({ title: "x" }) });
    assert.equal(noWs.status, 400, "missing workspaceId → 400 bad_request");
    assert.equal(((await noWs.json()) as { error: { code: string } }).error.code, "bad_request");

    // Create a real session, then send an empty-text message → 400.
    const created = await fetch(`${base}/v1/session`, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify({ workspaceId: WS }) });
    const id = ((await created.json()) as { data: { session: { id: string } } }).data.session.id;
    const noText = await fetch(`${base}/v1/session/${id}/message`, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify({ text: "" }) });
    assert.equal(noText.status, 400, "empty text → 400 bad_request");

    const unknown = await fetch(`${base}/v1/session/does-not-exist/message`, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify({ text: "hi" }) });
    assert.equal(unknown.status, 404, "unknown session → 404 (never a fabricated send)");
  } finally {
    await running.service.stop();
  }
});

test("FIX-1 message to a live session → 202 (reaches send seam); to a terminal session → honest 409", async () => {
  const sent: Array<{ id: string; text: string }> = [];
  const recordingSendPrompt: SendPrompt = {
    send: async (id, text) => { sent.push({ id, text }); },
  };
  const { running, deps } = await startCoworkService({
    credentialStore: createMemoryStore(), settingsFs: memorySettingsFs(), sessionStore: memSessionStore(),
    now: NOW, sendPrompt: recordingSendPrompt,
  });
  const base = running.baseUrl;
  const token = running.clientToken;
  try {
    const created = await fetch(`${base}/v1/session`, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify({ workspaceId: WS }) });
    const id = ((await created.json()) as { data: { session: { id: string } } }).data.session.id;

    // A live, non-terminal session accepts the prompt (202) and it REACHES the send seam.
    const live = await fetch(`${base}/v1/session/${id}/message`, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify({ text: "hi" }) });
    assert.equal(live.status, 202, "a live session accepts the prompt");
    assert.equal(((await live.json()) as { data: { accepted: boolean } }).data.accepted, true);
    assert.deepEqual(sent, [{ id, text: "hi" }], "the prompt reached the send seam");

    // Drive the session terminal through the ONE registry (S6 finality), then re-prompt.
    deps.sessionService.apply(id, { sessionId: id, seq: 1, at: NOW(), kind: "terminal", state: "completed" });
    const again = await fetch(`${base}/v1/session/${id}/message`, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify({ text: "second turn" }) });
    assert.equal(again.status, 409, "a terminal session → honest 409, not a misleading 202");
    const body = (await again.json()) as { data: { code: string; accepted: boolean } };
    assert.equal(body.data.code, "session_completed", "typed 409 body carries session_completed");
    assert.equal(body.data.accepted, false, "409 honestly reports the prompt was NOT accepted");
    assert.deepEqual(sent, [{ id, text: "hi" }], "no second prompt was dispatched to the runtime (no fabricated stream)");
  } finally {
    await running.service.stop();
  }
});

test("FIX-2 a malformed percent-encoded id segment → 404, not 500; a normal id still matches + decodes", async () => {
  // Unit: the boundary registry treats a bad %-escape as a segment MISMATCH (no 500 leak).
  const registry = new RouterRegistry();
  registry.mount({
    name: "t",
    routes: [{ method: "POST", path: "/v1/session/{id}/message", handler: (): RouteResult => ({ status: 202, data: "msg" }) }],
  });
  assert.equal(registry.match("POST", "/v1/session/%/message"), undefined, "a lone % → mismatch → no route");
  assert.equal(registry.match("POST", "/v1/session/%zz/message"), undefined, "a bad %zz escape → mismatch → no route");
  const ok = registry.match("POST", "/v1/session/abc%20123/message");
  assert.deepEqual(ok?.params, { id: "abc 123" }, "a well-formed id still matches and decodes");

  // HTTP: end-to-end the malformed path yields a 404, never a generic 500.
  const { running } = await startCoworkService({
    credentialStore: createMemoryStore(), settingsFs: memorySettingsFs(), sessionStore: memSessionStore(), now: NOW,
  });
  const base = running.baseUrl;
  const token = running.clientToken;
  try {
    const bad = await fetch(`${base}/v1/session/%/message`, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify({ text: "hi" }) });
    assert.equal(bad.status, 404, "a malformed-percent path param → 404 (client error), never a 500");
    assert.notEqual(bad.status, 500, "the URIError must not surface as a server error");
  } finally {
    await running.service.stop();
  }
});

test("router registry resolves {id} path params; an exact route still wins", () => {
  const registry = new RouterRegistry();
  const router: BoundaryRouter = {
    name: "t",
    routes: [
      { method: "POST", path: "/v1/session", handler: (): RouteResult => ({ status: 201, data: "create" }) },
      { method: "GET", path: "/v1/session", handler: (): RouteResult => ({ status: 200, data: "list" }) },
      { method: "POST", path: "/v1/session/{id}/message", handler: (): RouteResult => ({ status: 202, data: "msg" }) },
      { method: "POST", path: "/v1/session/{id}/cancel", handler: (): RouteResult => ({ status: 200, data: "cancel" }) },
    ],
  };
  registry.mount(router);

  const exact = registry.match("POST", "/v1/session");
  assert.equal((exact?.definition as { path: string }).path, "/v1/session", "exact create route matches");
  assert.deepEqual(exact?.params, {}, "an exact route carries no params");

  const withParam = registry.match("POST", "/v1/session/abc%20123/message");
  assert.equal((withParam?.definition as { path: string }).path, "/v1/session/{id}/message");
  assert.deepEqual(withParam?.params, { id: "abc 123" }, "the id segment is captured and URI-decoded");

  const cancel = registry.match("POST", "/v1/session/xyz/cancel");
  assert.deepEqual(cancel?.params, { id: "xyz" });

  assert.equal(registry.match("POST", "/v1/session/xyz/unknown"), undefined, "a non-matching path resolves to nothing");
  assert.equal(registry.match("GET", "/v1/session/xyz/message"), undefined, "method is part of the match");
});
