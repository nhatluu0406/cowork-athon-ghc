/**
 * Workspace boundary router test (CGHC-008; CGHC-002 carry-forward).
 *
 * The grant/recent routes mount on the loopback boundary and are TOKEN-GUARDED. Validation is
 * server-side: a rejected pick returns `{ granted: false, reason }` and is NOT recorded into the
 * recent list (never becomes the active workspace / no session). A valid pick returns the grant
 * and records it. The recent route returns entries with a freshly-probed availability flag. All
 * filesystem access is injected (a fake probe) so the test is deterministic on any OS.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type { BoundaryAuditEvent } from "../src/index.js";
import { startService } from "../src/index.js";
import {
  createRecentWorkspaces,
  createWorkspaceRouter,
  type WorkspaceFsProbe,
} from "../src/workspace/index.js";

const GOOD = path.resolve("C:/Users/test/Good Workspace (日本語)");
const BAD = path.resolve("C:/Users/test/missing");

function probeFor(): WorkspaceFsProbe {
  return {
    stat: async (p) => (p === GOOD ? { isDirectory: true } : undefined),
    isWritable: async (p) => p === GOOD,
  };
}

test("grant route is token-guarded, validates server-side, and only records valid picks", async () => {
  const audits: BoundaryAuditEvent[] = [];
  const recent = createRecentWorkspaces();
  const router = createWorkspaceRouter({
    recent,
    fsProbe: probeFor(),
    existsProbe: async (p) => p === GOOD,
  });
  const running = await startService({ routers: [router], onAudit: (e) => audits.push(e) });
  try {
    // No workspace route may opt out of the token guard.
    assert.equal(audits.some((e) => e.router === "workspace"), false);

    // Missing token -> 401.
    const unauth = await fetch(`${running.baseUrl}/v1/workspace/grant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: GOOD }),
    });
    assert.equal(unauth.status, 401);

    const authHeaders = {
      authorization: `Bearer ${running.clientToken}`,
      "content-type": "application/json",
    };

    // A rejected (missing) folder: granted:false, NOT recorded, no grant.
    const rejected = await fetch(`${running.baseUrl}/v1/workspace/grant`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ rootPath: BAD }),
    });
    assert.equal(rejected.status, 200);
    const rejectedBody = (await rejected.json()) as {
      data: { granted: boolean; reason?: string };
    };
    assert.equal(rejectedBody.data.granted, false);
    assert.equal(rejectedBody.data.reason, "not_found");
    assert.equal(recent.list().length, 0, "a rejected pick must not enter the recent list");

    // A valid folder: granted:true, recorded.
    const okRes = await fetch(`${running.baseUrl}/v1/workspace/grant`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ rootPath: GOOD }),
    });
    assert.equal(okRes.status, 201);
    const okBody = (await okRes.json()) as {
      data: { granted: boolean; grant?: { rootPath: string } };
    };
    assert.equal(okBody.data.granted, true);
    assert.equal(okBody.data.grant?.rootPath, GOOD);
    assert.equal(recent.list().length, 1);

    // Recent route returns the entry with a probed availability flag.
    const recentRes = await fetch(`${running.baseUrl}/v1/workspace/recent`, {
      headers: { authorization: `Bearer ${running.clientToken}` },
    });
    assert.equal(recentRes.status, 200);
    const recentBody = (await recentRes.json()) as {
      data: { recent: Array<{ rootPath: string; available: boolean }> };
    };
    assert.equal(recentBody.data.recent.length, 1);
    assert.equal(recentBody.data.recent[0]?.rootPath, GOOD);
    assert.equal(recentBody.data.recent[0]?.available, true);
  } finally {
    await running.service.stop();
  }
});

test("a malformed grant body returns 400 bad_request (not 500) and records nothing (review MEDIUM)", async () => {
  const recent = createRecentWorkspaces();
  const router = createWorkspaceRouter({ recent, fsProbe: probeFor(), existsProbe: async () => true });
  const running = await startService({ routers: [router] });
  try {
    const authHeaders = {
      authorization: `Bearer ${running.clientToken}`,
      "content-type": "application/json",
    };
    for (const body of ["{}", JSON.stringify({ rootPath: "" })]) {
      const res = await fetch(`${running.baseUrl}/v1/workspace/grant`, {
        method: "POST",
        headers: authHeaders,
        body,
      });
      assert.equal(res.status, 400, `malformed body ${body} must be 400, not 500`);
      const env = (await res.json()) as { ok: boolean; error?: { code: string; message: string } };
      assert.equal(env.ok, false);
      assert.equal(env.error?.code, "bad_request");
      // The generic message is surfaced (not discarded into a 500 internal); no raw path.
      assert.ok((env.error?.message ?? "").length > 0);
    }
    assert.equal(recent.list().length, 0, "a malformed request records nothing");
  } finally {
    await running.service.stop();
  }
});
