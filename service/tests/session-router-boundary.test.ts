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
import { credentialAccountForProfile, credentialRef } from "../src/credential/store.js";
import { defaultSettings, type SettingsFs } from "../src/diagnostics/index.js";
import type { SendPrompt, SessionStore, StoredSession } from "../src/session/index.js";
import { RouterRegistry } from "../src/server/router-registry.js";
import type { BoundaryRouter, RouteResult } from "../src/boundary/contract.js";

const WS = "C:/ws/tier1";
const NOW = (): string => "2026-07-12T00:00:00.000Z";
const PROFILE_ID = "tier1-profile";

function memorySettingsFs(seed?: string): SettingsFs {
  let data: string | undefined = seed;
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

/** Seed an active provider profile so composed create is not blocked by readiness. */
async function readyComposeDeps(): Promise<{
  readonly credentialStore: ReturnType<typeof createMemoryStore>;
  readonly settingsFs: SettingsFs;
  readonly sessionStore: SessionStore;
}> {
  const account = credentialAccountForProfile(PROFILE_ID);
  const credentialStore = createMemoryStore();
  await credentialStore.set(account, "sk-test-tier1");
  const settings = {
    ...defaultSettings(),
    activeProfileId: PROFILE_ID,
    providerProfilesMigrated: true,
    providerProfiles: [
      {
        id: PROFILE_ID,
        displayName: "Tier1",
        providerType: "custom-openai-compat" as const,
        baseUrl: "https://8.8.8.8/v1",
        modelId: "demo-model",
        envVar: "TIER1_API_KEY",
        createdAt: NOW(),
        updatedAt: NOW(),
        credentialRef: credentialRef(account),
      },
    ],
  };
  return {
    credentialStore,
    settingsFs: memorySettingsFs(JSON.stringify(settings)),
    sessionStore: memSessionStore(),
  };
}

const auth = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });
const jsonHeaders = (t: string): Record<string, string> => ({ ...auth(t), "content-type": "application/json" });

test("Tier 1 session boundary: create/list work; message honestly errors runtime_not_attached", async () => {
  const deps = await readyComposeDeps();
  const { running } = await startCoworkService({ ...deps, now: NOW });
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
  const deps = await readyComposeDeps();
  const { running } = await startCoworkService({ ...deps, now: NOW });
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

test("unreachable OpenCode maps to honest 503, not Internal boundary error", async () => {
  const { createService } = await import("../src/server/http-service.js");
  const { OpencodeUnreachableError } = await import("../src/runtime/opencode-http-error.js");
  const { createSessionRouter } = await import("../src/session/router.js");
  const { initialSessionView } = await import("../src/execution/index.js");

  const sessionId = "s-unreachable";
  const views = new Map([[sessionId, initialSessionView(sessionId)]]);
  const sessionService = {
    create: async () => ({
      id: sessionId,
      title: "T",
      workspaceId: WS,
      createdAt: NOW(),
      updatedAt: NOW(),
    }),
    list: async () => [],
    continueSession: async () => {
      throw new Error("unused");
    },
    rename: async () => {
      throw new Error("unused");
    },
    view: (id: string) => views.get(id),
    status: () => "ready" as const,
    apply: () => initialSessionView(sessionId),
    bindStream: () => undefined,
    cancel: async () => undefined,
  };

  const service = createService();
  service.mount(
    createSessionRouter(sessionService as never, {
      send: async () => {
        throw new OpencodeUnreachableError("session.message");
      },
    }),
  );
  const address = await service.start();
  const baseUrl = `http://${address.host}:${address.port}`;
  try {
    const sent = await fetch(`${baseUrl}/v1/session/${sessionId}/message`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${service.clientToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "hi" }),
    });
    assert.equal(sent.status, 503);
    const body = (await sent.json()) as {
      ok?: boolean;
      data?: { reason?: string };
      error?: { message?: string };
    };
    assert.equal(body.ok, true, "503 transport uses success envelope with accepted:false");
    assert.equal(body.data?.reason, "runtime_unavailable");
    assert.equal(body.error, undefined);
    assert.notEqual(body.error?.message, "Internal boundary error.");
  } finally {
    await service.stop();
  }
});

test("duck-typed runtime_not_ready and OpencodeHttpError also map to 503, not Internal boundary", async () => {
  const { createService } = await import("../src/server/http-service.js");
  const { OpencodeHttpError } = await import("../src/runtime/opencode-http-error.js");
  const { createSessionRouter } = await import("../src/session/router.js");
  const { initialSessionView } = await import("../src/execution/index.js");

  async function assertMessageMaps(sendError: unknown, label: string): Promise<void> {
    const sessionId = `s-${label}`;
    const views = new Map([[sessionId, initialSessionView(sessionId)]]);
    const sessionService = {
      create: async () => {
        throw new Error("unused");
      },
      list: async () => [],
      continueSession: async () => {
        throw new Error("unused");
      },
      rename: async () => {
        throw new Error("unused");
      },
      view: (id: string) => views.get(id),
      status: () => "ready" as const,
      apply: () => initialSessionView(sessionId),
      bindStream: () => undefined,
      cancel: async () => undefined,
    };
    const service = createService();
    service.mount(
      createSessionRouter(sessionService as never, {
        send: async () => {
          throw sendError;
        },
      }),
    );
    const address = await service.start();
    try {
      const sent = await fetch(`http://${address.host}:${address.port}/v1/session/${sessionId}/message`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${service.clientToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "hi" }),
      });
      assert.equal(sent.status, 503, label);
      const body = (await sent.json()) as { data?: { reason?: string }; error?: { message?: string } };
      assert.equal(body.data?.reason, "runtime_unavailable", label);
      assert.notEqual(body.error?.message, "Internal boundary error.", label);
    } finally {
      await service.stop();
    }
  }

  await assertMessageMaps(new OpencodeHttpError("session.message", 502), "http-error");
  await assertMessageMaps(
    Object.assign(new Error("runtime not ready elsewhere"), { code: "runtime_not_ready" }),
    "duck-not-ready",
  );
});

test("create session maps duck-typed unreachable to 503 without Internal boundary", async () => {
  const { createService } = await import("../src/server/http-service.js");
  const { createSessionRouter } = await import("../src/session/router.js");
  const { initialSessionView } = await import("../src/execution/index.js");

  const service = createService();
  service.mount(
    createSessionRouter(
      {
        create: async () => {
          throw Object.assign(new Error("could not reach"), { code: "opencode_unreachable" });
        },
        list: async () => [],
        continueSession: async () => {
          throw new Error("unused");
        },
        rename: async () => {
          throw new Error("unused");
        },
        view: () => initialSessionView("x"),
        status: () => "ready" as const,
        apply: () => initialSessionView("x"),
        bindStream: () => undefined,
        cancel: async () => undefined,
      } as never,
      {
        send: async () => undefined,
      },
    ),
  );
  const address = await service.start();
  try {
    const created = await fetch(`http://${address.host}:${address.port}/v1/session`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${service.clientToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workspaceId: WS }),
    });
    assert.equal(created.status, 503);
    const body = (await created.json()) as {
      data?: { reason?: string };
      error?: { message?: string };
    };
    assert.equal(body.data?.reason, "runtime_unavailable");
    assert.notEqual(body.error?.message, "Internal boundary error.");
  } finally {
    await service.stop();
  }
});

test("FIX-1 message to a live session → 202 (reaches send seam); to a terminal session → honest 409", async () => {
  const sent: Array<{ id: string; text: string }> = [];
  const recordingSendPrompt: SendPrompt = {
    send: async (id, text) => { sent.push({ id, text }); },
  };
  const seed = await readyComposeDeps();
  const { running, deps } = await startCoworkService({
    ...seed,
    now: NOW, sendPrompt: recordingSendPrompt,
  });
  const base = running.baseUrl;
  const token = running.clientToken;
  try {
    const created = await fetch(`${base}/v1/session`, { method: "POST", headers: jsonHeaders(token), body: JSON.stringify({ workspaceId: WS }) });
    assert.equal(created.status, 201);
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
