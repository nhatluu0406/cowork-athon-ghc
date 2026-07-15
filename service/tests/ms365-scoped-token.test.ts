/**
 * Task 2 (P5.5) — path-scoped token guard: the OpenCode child is handed a token that is valid
 * ONLY for `/v1/ms365/tool-call`, never the full boundary. Proves:
 *  - a scoped token on its registered path -> 200;
 *  - the same scoped token on a DIFFERENT path -> 403 (not silently accepted everywhere);
 *  - the main client token still works on BOTH paths (no regression for the real client);
 *  - no token presented -> 401 (unchanged missing-token behavior).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { startService, type BoundaryRouter } from "../src/index.js";

const MS365_TOOL_CALL_PATH = "/v1/ms365/tool-call";
const OTHER_PATH = "/v1/ms365/write-mode";

function ms365StyleRouter(): BoundaryRouter {
  return {
    name: "ms365-scoped-test",
    routes: [
      {
        method: "POST",
        path: MS365_TOOL_CALL_PATH,
        handler: () => ({ status: 200, data: { tool: "ok" } }),
      },
      {
        method: "POST",
        path: OTHER_PATH,
        handler: () => ({ status: 200, data: { writeMode: "ok" } }),
      },
    ],
  };
}

test("scoped token: allowed on its registered path -> 200", async () => {
  const scopedToken = "b".repeat(40);
  const running = await startService({
    routers: [ms365StyleRouter()],
    pathScopedTokens: [{ token: scopedToken, paths: [MS365_TOOL_CALL_PATH] }],
  });
  try {
    const res = await fetch(`${running.baseUrl}${MS365_TOOL_CALL_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${scopedToken}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
  } finally {
    await running.service.stop();
  }
});

test("scoped token: rejected (403) on a different path", async () => {
  const scopedToken = "b".repeat(40);
  const running = await startService({
    routers: [ms365StyleRouter()],
    pathScopedTokens: [{ token: scopedToken, paths: [MS365_TOOL_CALL_PATH] }],
  });
  try {
    const res = await fetch(`${running.baseUrl}${OTHER_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${scopedToken}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "forbidden");
  } finally {
    await running.service.stop();
  }
});

test("main client token still works on both paths when a scoped token is also registered", async () => {
  const scopedToken = "b".repeat(40);
  const running = await startService({
    routers: [ms365StyleRouter()],
    pathScopedTokens: [{ token: scopedToken, paths: [MS365_TOOL_CALL_PATH] }],
  });
  try {
    for (const path of [MS365_TOOL_CALL_PATH, OTHER_PATH]) {
      const res = await fetch(`${running.baseUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${running.clientToken}`, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 200, `main token must work on ${path}`);
    }
  } finally {
    await running.service.stop();
  }
});

test("no token presented -> 401 (unchanged), even with scoped tokens registered", async () => {
  const scopedToken = "b".repeat(40);
  const running = await startService({
    routers: [ms365StyleRouter()],
    pathScopedTokens: [{ token: scopedToken, paths: [MS365_TOOL_CALL_PATH] }],
  });
  try {
    const res = await fetch(`${running.baseUrl}${MS365_TOOL_CALL_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "unauthorized");
  } finally {
    await running.service.stop();
  }
});
