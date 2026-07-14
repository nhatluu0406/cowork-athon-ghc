/**
 * Remote-gateway composition wiring (agent-harness-plan.md remote MVP):
 *  1. flag OFF (default) → no gateway, `live.remote` is undefined — baseline untouched;
 *  2. flag ON → the gateway is up, a phone can pair and read conversations THROUGH it,
 *     the pairing code prints via the injected log, and `stop()` also stops the gateway.
 *
 * Uses the same fake supervisor + fake OpenCode server as compose-live-wiring.test.ts —
 * no real spawn, keyring, egress, or secret.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { captureIdentity, type RuntimeProcessIdentity } from "@cowork-ghc/runtime";
import {
  startLiveCoworkService,
  type LiveRuntimeSupervisor,
} from "../src/composition/index.js";
import type { SupervisorStartSpec } from "../src/runtime/index.js";
import { createMemoryStore } from "../src/credential/index.js";
import type { SettingsFs } from "../src/diagnostics/index.js";
import { createPermissionRequest } from "../src/permission/index.js";
import { startFakeOpencodeServer } from "./opencode-fake-server.js";

const WS = "C:/Users/test/Remote Workspace";
const NOW = () => "2026-07-14T00:00:00.000Z";

const START_SPEC: SupervisorStartSpec = {
  binPath: "C:/opencode/opencode.exe",
  cwd: WS,
  port: 65001,
  dataHome: "C:/tmp/data",
  configDir: "C:/tmp/config",
  injectionRequests: [],
};

function fakeSupervisor(baseUrl: () => string | null): LiveRuntimeSupervisor {
  let started = false;
  const identity: RuntimeProcessIdentity = captureIdentity({
    pid: 4321,
    startTime: "2026-07-14T00:00:00.000Z",
    exePath: "C:/opencode/opencode.exe",
    port: 65001,
    host: "127.0.0.1",
  });
  return {
    isAlive: () => started,
    get baseUrl(): string | null {
      return started ? baseUrl() : null;
    },
    start: async () => {
      started = true;
      return identity;
    },
    stop: async () => {
      started = false;
    },
  };
}

function memorySettingsFs(): SettingsFs {
  let data: string | undefined;
  return {
    read: () => Promise.resolve(data),
    write: (d) => {
      data = d;
      return Promise.resolve();
    },
  };
}

test("flag OFF: no remote gateway is started and the handle carries none", async () => {
  const fake = await startFakeOpencodeServer();
  const live = await startLiveCoworkService({
    supervisor: fakeSupervisor(() => fake.baseUrl),
    startSpec: START_SPEC,
    workspaceId: WS,
    now: NOW,
    env: {},
    service: { credentialStore: createMemoryStore(), settingsFs: memorySettingsFs() },
  });
  try {
    assert.equal(live.remote, undefined);
  } finally {
    await live.stop();
    await fake.close();
  }
});

test("flag ON: pair a device and read conversations through the gateway; stop() closes it", async () => {
  const fake = await startFakeOpencodeServer();
  const logged: string[] = [];
  const live = await startLiveCoworkService({
    supervisor: fakeSupervisor(() => fake.baseUrl),
    startSpec: START_SPEC,
    workspaceId: WS,
    now: NOW,
    env: { CGHC_REMOTE_ENABLED: "1" },
    remoteLog: (line) => logged.push(line),
    service: { credentialStore: createMemoryStore(), settingsFs: memorySettingsFs() },
  });
  assert.ok(live.remote, "the gateway handle is exposed when the flag is on");
  const remote = live.remote;
  try {
    // The pairing code was surfaced through the injected log (never the device token).
    assert.ok(logged.some((line) => line.includes("ma pairing")));
    assert.ok(!logged.some((line) => line.includes(live.running.clientToken)));

    // Pair over HTTP with a FRESH code, then read the real composed /v1/conversations.
    const { code } = remote.issuePairingCode();
    const pairRes = await fetch(`${remote.url}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, deviceName: "wiring-phone" }),
    });
    assert.equal(pairRes.status, 200);
    const pairBody = (await pairRes.json()) as { data: { token: string } };

    const convRes = await fetch(`${remote.url}/api/conversations`, {
      headers: { authorization: `Bearer ${pairBody.data.token}` },
    });
    assert.equal(convRes.status, 200);
    const convBody = (await convRes.json()) as {
      ok: boolean;
      data: { conversations: unknown[] };
    };
    assert.equal(convBody.ok, true);
    assert.ok(Array.isArray(convBody.data.conversations));

    // The main service still refuses the DEVICE token directly (separate trust domains).
    const direct = await fetch(`${live.running.baseUrl}/v1/conversations`, {
      headers: { authorization: `Bearer ${pairBody.data.token}` },
    });
    assert.equal(direct.status, 403);

    // --- Permission round trip against the ONE real gate (agent-harness-plan Task 1.3). ---
    live.deps.permissionGate.submit(
      createPermissionRequest({
        requestId: "perm-remote-1",
        sessionId: "s-remote",
        requestedAt: NOW(),
        action: { kind: "file_create", description: "Tạo file demo.txt", targetPath: "demo.txt" },
      }),
    );

    const pendingRes = await fetch(`${remote.url}/api/permissions`, {
      headers: { authorization: `Bearer ${pairBody.data.token}` },
    });
    assert.equal(pendingRes.status, 200);
    const pendingBody = (await pendingRes.json()) as {
      data: { pending: readonly { requestId: string; action: { description: string } }[] };
    };
    assert.equal(pendingBody.data.pending[0]?.requestId, "perm-remote-1");

    const denyRes = await fetch(`${remote.url}/api/permissions/decision`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${pairBody.data.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ requestId: "perm-remote-1", decision: "deny" }),
    });
    assert.equal(denyRes.status, 200);
    const denyBody = (await denyRes.json()) as { data: { status: string; decision: string } };
    assert.equal(denyBody.data.status, "resolved");
    assert.equal(denyBody.data.decision, "deny");

    // The deny from the phone is REAL at the execution boundary: the gate holds no allow,
    // the request left the pending list, and a late allow cannot override (idempotent).
    assert.equal(live.deps.permissionGate.isAllowed("perm-remote-1"), false);
    assert.equal(live.deps.permissionGate.pending().length, 0);
    const lateAllow = await fetch(`${remote.url}/api/permissions/decision`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${pairBody.data.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ requestId: "perm-remote-1", decision: "allow", scope: "once" }),
    });
    const lateBody = (await lateAllow.json()) as { data: { status: string; decision: string } };
    assert.equal(lateBody.data.status, "already_resolved");
    assert.equal(lateBody.data.decision, "deny");
    assert.equal(live.deps.permissionGate.isAllowed("perm-remote-1"), false);

    // --- Desktop /v1/remote surface shares the gateway's pairing registry (Task 2.4). ---
    const statusRes = await fetch(`${live.running.baseUrl}/v1/remote/status`, {
      headers: { authorization: `Bearer ${live.running.clientToken}` },
    });
    assert.equal(statusRes.status, 200);
    const statusBody = (await statusRes.json()) as {
      data: { enabled: boolean; url: string | null; devices: readonly unknown[] };
    };
    assert.equal(statusBody.data.enabled, true);
    assert.equal(statusBody.data.url, remote.url);
    // The device paired earlier through the gateway is visible to the desktop surface.
    assert.equal(statusBody.data.devices.length, 1);

    // A code issued via /v1/remote pairs a NEW phone against the gateway (one registry).
    const codeRes = await fetch(`${live.running.baseUrl}/v1/remote/pairing-code`, {
      method: "POST",
      headers: { authorization: `Bearer ${live.running.clientToken}`, "content-type": "application/json" },
      body: "{}",
    });
    const codeBody = (await codeRes.json()) as { data: { code: string } };
    const secondPair = await fetch(`${remote.url}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: codeBody.data.code, deviceName: "second-phone" }),
    });
    assert.equal(secondPair.status, 200);

    // The desktop /v1/remote route is refused for the DEVICE token (desktop-only surface).
    const deviceHitsRemote = await fetch(`${remote.url}/api/remote/status`, {
      headers: { authorization: `Bearer ${pairBody.data.token}` },
    });
    assert.equal(deviceHitsRemote.status, 404);

    // --- Send-prompt from the phone reaches the real child (agent-harness-plan Task 1.2). ---
    const meta = await live.deps.sessionService.create({ workspaceId: WS, title: "Phone turn" });
    const promptRes = await fetch(
      `${remote.url}/api/sessions/${encodeURIComponent(meta.id)}/message`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${pairBody.data.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "xin chao tu dien thoai" }),
      },
    );
    assert.equal(promptRes.status, 202);
    assert.ok(
      fake.requests.some(
        (r) => r.method === "POST" && r.path === `/session/${meta.id}/message`,
      ),
      "the phone prompt reached the live OpenCode child through gateway -> service -> child",
    );
  } finally {
    await live.stop();
    await fake.close();
  }

  // stop() closed the gateway socket too.
  await assert.rejects(() => fetch(`${remote.url}/api/me`));
});
