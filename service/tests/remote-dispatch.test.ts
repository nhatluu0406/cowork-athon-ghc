/**
 * Remote gateway dispatch allowlist (agent-harness-plan.md Task 5.3, phone slice). Mirrors the
 * fake-main-service pattern from remote-gateway.test.ts: a paired device can reach the task
 * catalog (read-only) and dispatch runs (1-touch run of a SAVED task, list/get, cancel) — and
 * nothing else. No task create/update/delete/instantiate route is ever allowlisted from the
 * phone (v1 has no task CRUD on the phone).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPairingRegistry } from "../src/remote-gateway/pairing.js";
import { startRemoteGateway, type RemoteGateway } from "../src/remote-gateway/gateway.js";

const MAIN_TOKEN = "d".repeat(64);

/** A fake main service exposing just enough of /v1/tasks + /v1/dispatch/* to prove the proxy. */
function startFakeMain(): Promise<{
  server: Server;
  baseUrl: string;
  seen: string[];
  runBodies: string[];
}> {
  const seen: string[] = [];
  const runBodies: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url ?? ""} auth=${req.headers.authorization ?? "none"}`);
    if (req.headers.authorization !== `Bearer ${MAIN_TOKEN}`) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    const url = new URL(req.url ?? "/", "http://main.invalid");

    if (req.method === "GET" && url.pathname === "/v1/tasks") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          data: {
            tasks: [
              {
                id: "t1",
                name: "Nightly report",
                source: "built_in",
                goal: "Summarize the day",
                loop: { mode: "run_once" },
                agentId: "writer",
              },
            ],
          },
        }),
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/dispatch/runs") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          data: {
            runs: [
              {
                runId: "run-1-t1",
                taskId: "t1",
                taskName: "Nightly report",
                loopMode: "run_once",
                startedAt: "2026-07-16T00:00:00.000Z",
                status: "running",
                attempts: 1,
                verified: false,
                branches: [
                  { branchId: "b1", agentId: "writer", agentName: "Writer", status: "running" },
                ],
              },
            ],
          },
        }),
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/dispatch/runs/run-1-t1") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          data: {
            run: {
              runId: "run-1-t1",
              taskId: "t1",
              taskName: "Nightly report",
              loopMode: "run_once",
              startedAt: "2026-07-16T00:00:00.000Z",
              status: "completed",
              attempts: 1,
              verified: true,
              branches: [],
            },
          },
        }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/dispatch/tasks/t1/run") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        runBodies.push(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              run: {
                runId: "run-2-t1",
                taskId: "t1",
                taskName: "Nightly report",
                loopMode: "run_once",
                startedAt: "2026-07-16T00:00:00.000Z",
                status: "running",
                attempts: 1,
                verified: false,
                branches: [],
              },
            },
          }),
        );
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/dispatch/runs/run-1-t1/cancel") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: { cancelled: true } }));
      return;
    }
    // Task write routes exist on the main service but must NEVER be reached through the
    // gateway allowlist (no phone CRUD). If a forward ever slips through, prove it here.
    if (req.method === "DELETE" && url.pathname === "/v1/tasks/t1") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: { deleted: true } }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/tasks") {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: { task: { id: "t-new" } } }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/tasks/t1/instantiate") {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: { task: { id: "t1-copy" } } }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  });
  return new Promise((resolve) => {
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const info = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${info.port}`, seen, runBodies });
    });
  });
}

async function startTestGateway(mainBaseUrl: string): Promise<{
  gateway: RemoteGateway;
  pairAndGetToken: () => Promise<string>;
}> {
  const pairing = createPairingRegistry();
  const gateway = await startRemoteGateway({
    mainBaseUrl,
    mainClientToken: MAIN_TOKEN,
    pairing,
  });
  return {
    gateway,
    pairAndGetToken: async () => {
      const { code } = gateway.issuePairingCode();
      const res = await fetch(`${gateway.url}/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, deviceName: "dispatch-phone" }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { data: { token: string } };
      return body.data.token;
    },
  };
}

test("paired device reads the task catalog through the allowlist proxy", async () => {
  const main = await startFakeMain();
  const { gateway, pairAndGetToken } = await startTestGateway(main.baseUrl);
  try {
    const token = await pairAndGetToken();
    const res = await fetch(`${gateway.url}/api/dispatch/tasks`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: { tasks: readonly { id: string }[] } };
    assert.equal(body.ok, true);
    assert.equal(body.data.tasks[0]?.id, "t1");
    // Upstream saw the MAIN token, never the device token.
    assert.ok(main.seen.some((l) => l.includes(`GET /v1/tasks auth=Bearer ${MAIN_TOKEN}`)));
    assert.ok(!main.seen.some((l) => l.includes(token)));
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, new RegExp(MAIN_TOKEN));
  } finally {
    await gateway.stop();
    main.server.close();
  }
});

test("paired device lists and gets dispatch runs through the proxy", async () => {
  const main = await startFakeMain();
  const { gateway, pairAndGetToken } = await startTestGateway(main.baseUrl);
  try {
    const token = await pairAndGetToken();

    const list = await fetch(`${gateway.url}/api/dispatch/runs`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as { data: { runs: readonly { runId: string; status: string }[] } };
    assert.equal(listBody.data.runs[0]?.runId, "run-1-t1");
    assert.equal(listBody.data.runs[0]?.status, "running");

    const one = await fetch(`${gateway.url}/api/dispatch/runs/run-1-t1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(one.status, 200);
    const oneBody = (await one.json()) as { data: { run: { status: string; verified: boolean } } };
    assert.equal(oneBody.data.run.status, "completed");
    assert.equal(oneBody.data.run.verified, true);
  } finally {
    await gateway.stop();
    main.server.close();
  }
});

test("paired device runs a saved task and cancels a run through the POST allowlist", async () => {
  const main = await startFakeMain();
  const { gateway, pairAndGetToken } = await startTestGateway(main.baseUrl);
  try {
    const token = await pairAndGetToken();

    const run = await fetch(`${gateway.url}/api/dispatch/tasks/t1/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(run.status, 201);
    const runBody = (await run.json()) as { data: { run: { runId: string } } };
    assert.equal(runBody.data.run.runId, "run-2-t1");

    const cancel = await fetch(`${gateway.url}/api/dispatch/runs/run-1-t1/cancel`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(cancel.status, 200);
    const cancelBody = (await cancel.json()) as { data: { cancelled: boolean } };
    assert.equal(cancelBody.data.cancelled, true);
  } finally {
    await gateway.stop();
    main.server.close();
  }
});

test("missing or revoked device token is refused for every dispatch route", async () => {
  const main = await startFakeMain();
  const { gateway, pairAndGetToken } = await startTestGateway(main.baseUrl);
  try {
    const missing = await fetch(`${gateway.url}/api/dispatch/tasks`);
    assert.equal(missing.status, 401);

    const token = await pairAndGetToken();
    // Revoke the device the pairing registry just minted, then retry with the same (now
    // stale) bearer token — the gateway must refuse it exactly like an unknown token.
    const revoked = await fetch(`${gateway.url}/api/dispatch/tasks`, {
      headers: { authorization: "Bearer " + "z".repeat(64) },
    });
    assert.equal(revoked.status, 403);

    // A valid, unrevoked token still works (sanity: the 403 above was about the bad token,
    // not a broken route).
    const ok = await fetch(`${gateway.url}/api/dispatch/tasks`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(ok.status, 200);

    assert.ok(!main.seen.some((l) => l.startsWith("GET /api")));
  } finally {
    await gateway.stop();
    main.server.close();
  }
});

test("no task write route is ever allowlisted from the phone (v1 has no phone CRUD)", async () => {
  const main = await startFakeMain();
  const { gateway, pairAndGetToken } = await startTestGateway(main.baseUrl);
  try {
    const token = await pairAndGetToken();
    const authed = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const del = await fetch(`${gateway.url}/api/dispatch/tasks/t1`, {
      method: "DELETE",
      headers: authed,
    });
    assert.equal(del.status, 404);

    const create = await fetch(`${gateway.url}/api/dispatch/tasks`, {
      method: "POST",
      headers: authed,
      body: JSON.stringify({ name: "Sneaky task" }),
    });
    assert.equal(create.status, 404);

    const update = await fetch(`${gateway.url}/api/tasks/t1`, {
      method: "PUT",
      headers: authed,
      body: "{}",
    });
    assert.equal(update.status, 404);

    const instantiate = await fetch(`${gateway.url}/api/dispatch/tasks/t1/instantiate`, {
      method: "POST",
      headers: authed,
      body: "{}",
    });
    assert.equal(instantiate.status, 404);

    // Nothing ever crossed to the main service's write routes.
    assert.equal(main.seen.length, 0);
  } finally {
    await gateway.stop();
    main.server.close();
  }
});

test("dispatch responses never carry the main service token", async () => {
  const main = await startFakeMain();
  const { gateway, pairAndGetToken } = await startTestGateway(main.baseUrl);
  try {
    const token = await pairAndGetToken();
    const res = await fetch(`${gateway.url}/api/dispatch/runs`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    assert.doesNotMatch(text, new RegExp(MAIN_TOKEN));
    assert.doesNotMatch(text, /mainClientToken/);
  } finally {
    await gateway.stop();
    main.server.close();
  }
});
