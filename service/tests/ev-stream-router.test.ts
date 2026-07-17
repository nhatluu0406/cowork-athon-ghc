/**
 * CGHC-014 — the resync endpoint on the loopback boundary.
 *
 * Asserts the snapshot/resync route is mounted WITH the fail-closed token guard (no token →
 * 401), returns the authoritative folded view + resume seq for a loaded session, and never
 * fabricates a view for an unknown session.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionId } from "@cowork-ghc/contracts";
import { startService } from "../src/index.js";
import { initialSessionView, reduceEv, type SessionView } from "../src/execution/index.js";
import {
  createEvStreamRouter,
  EV_SNAPSHOT_PATH,
  type SessionSnapshotResult,
  type SnapshotSource,
} from "../src/server/ev-stream-router.js";
import { STREAM_SID } from "./streaming-fakes.js";

/** A source holding one authoritative view (stands in for the session service). */
function fakeSource(): SnapshotSource {
  let view: SessionView = initialSessionView(STREAM_SID);
  view = reduceEv(view, { sessionId: STREAM_SID, seq: 1, at: "t", kind: "token", delta: "hi" });
  view = reduceEv(view, { sessionId: STREAM_SID, seq: 2, at: "t", kind: "terminal", state: "completed" });
  return { view: (id: SessionId) => (id === STREAM_SID ? view : undefined) };
}

async function getSnapshot(baseUrl: string, token: string | null, query: string) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${EV_SNAPSHOT_PATH}${query}`, { headers });
}

test("the resync route is token-guarded (fail closed): no token → 401", async () => {
  const running = await startService({ routers: [createEvStreamRouter(fakeSource())] });
  try {
    const res = await getSnapshot(running.baseUrl, null, `?sessionId=${STREAM_SID}`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, "unauthorized");
  } finally {
    await running.service.stop();
  }
});

test("with the token, the route returns the authoritative snapshot + resume seq", async () => {
  const running = await startService({ routers: [createEvStreamRouter(fakeSource())] });
  try {
    const res = await getSnapshot(running.baseUrl, running.clientToken, `?sessionId=${STREAM_SID}&sinceSeq=0`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: SessionSnapshotResult };
    assert.equal(body.ok, true);
    assert.equal(body.data.found, true);
    if (!body.data.found) throw new Error("expected a found snapshot");
    assert.equal(body.data.status, "completed", "converges the client to the authoritative status");
    assert.equal(body.data.lastSeq, 2);
    assert.equal(body.data.resumeSeq, 2);
    assert.equal(body.data.replaced, true, "cursor 0 is behind the authoritative lastSeq");
    assert.equal(body.data.snapshot.text, "hi");
  } finally {
    await running.service.stop();
  }
});

test("an unknown session returns a typed not-found (no fabricated view)", async () => {
  const running = await startService({ routers: [createEvStreamRouter(fakeSource())] });
  try {
    const res = await getSnapshot(running.baseUrl, running.clientToken, `?sessionId=nope`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { data: SessionSnapshotResult };
    assert.equal(body.data.found, false);
  } finally {
    await running.service.stop();
  }
});

test("a missing sessionId is a typed client error", async () => {
  const running = await startService({ routers: [createEvStreamRouter(fakeSource())] });
  try {
    const res = await getSnapshot(running.baseUrl, running.clientToken, ``);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { data: SessionSnapshotResult };
    assert.equal(body.data.found, false);
  } finally {
    await running.service.stop();
  }
});
