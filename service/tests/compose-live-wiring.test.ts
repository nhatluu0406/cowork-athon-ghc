/**
 * CGHC-028 Wave A2 — the LIVE composition wire (`startLiveCoworkService`).
 *
 * With a FAKE OpenCode server as the "child" and a fake supervisor pointed at it, this proves:
 *  1. the four Tier 2 seams are the LIVE adapters (a session create + a provider probe round-trip
 *     through the composed boundary actually hit the fake child — not the reject-everything doubles);
 *  2. the shared value-scrubber is SEEDED, so a planted key value in a mapped error is
 *     value-redacted by the composed `redactError`;
 *  3. shutdown stops BOTH the loopback socket AND the supervised child (ONE owner).
 *
 * No real OpenCode binary, socket auth, network egress, keyring, disk, or secret.
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
import { startFakeOpencodeServer, type FakeOpencodeServer } from "./opencode-fake-server.js";

const WS = "C:/Users/test/Live Workspace";
const NOW = () => "2026-07-11T00:00:00.000Z";
const PLANTED_KEY = "sk-fake-planted-live-key-000111222333";

const START_SPEC: SupervisorStartSpec = {
  binPath: "C:/opencode/opencode.exe",
  cwd: WS,
  port: 65000,
  dataHome: "C:/tmp/data",
  configDir: "C:/tmp/config",
  injectionRequests: [],
};

interface FakeSupervisorState {
  readonly supervisor: LiveRuntimeSupervisor;
  started: boolean;
  stopped: boolean;
}

/** A supervisor whose `baseUrl`/`isAlive` reflect the fake server, gated by start()/stop(). */
function fakeSupervisor(fake: FakeOpencodeServer): FakeSupervisorState {
  const state: FakeSupervisorState = { supervisor: undefined as never, started: false, stopped: false };
  const identity: RuntimeProcessIdentity = captureIdentity({
    pid: 4321,
    startTime: "2026-07-11T00:00:00.000Z",
    exePath: "C:/opencode/opencode.exe",
    port: 65000,
    host: "127.0.0.1",
  });
  state.supervisor = {
    isAlive: () => state.started && !state.stopped,
    get baseUrl(): string | null {
      return state.started && !state.stopped ? fake.baseUrl : null;
    },
    async start(): Promise<RuntimeProcessIdentity> {
      state.started = true;
      return identity;
    },
    async stop(): Promise<void> {
      state.stopped = true;
    },
  };
  return state;
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

test("startLiveCoworkService fills the seams live, seeds the scrubber, and owns shutdown", async () => {
  const fake = await startFakeOpencodeServer();
  const sup = fakeSupervisor(fake);
  const live = await startLiveCoworkService({
    supervisor: sup.supervisor,
    startSpec: START_SPEC,
    workspaceId: WS,
    now: NOW,
    service: {
      credentialStore: createMemoryStore(),
      settingsFs: memorySettingsFs(),
    },
    // Seed the shared scrubber with a resolved credential value (fake supervisor never resolves).
    seedScrubber: (scrubber) => scrubber.register(PLANTED_KEY),
  });

  try {
    // --- (1) the LIVE runtime-health seam IS the supervisor. ---
    assert.equal(sup.started, true, "the supervisor child was started");
    assert.equal(live.supervisor.isAlive(), true);
    assert.ok(live.running.baseUrl.startsWith("http://"), "the loopback socket is open");

    // --- (1) the LIVE sessionStore seam: create + list round-trip to the fake child. ---
    const created = await live.deps.sessionService.create({ workspaceId: WS, title: "Live" });
    assert.equal(created.title, "Live");
    assert.ok(
      fake.requests.some((r) => r.method === "POST" && r.path === "/session"),
      "session create reached the live child (not the not-attached default)",
    );
    const listed = await live.deps.sessionService.list();
    assert.equal(listed.length, 1);

    // --- (1) the LIVE connector seam: a provider probe round-trips to the child health. ---
    const probe = await live.deps.providerPort.testConnection("anthropic");
    assert.equal(probe.ok, true);
    assert.ok(fake.requests.some((r) => r.path === "/global/health"));

    // --- (2) the seeded value-scrubber redacts the planted key through the composed redactor. ---
    const masked = live.deps.redactError(`runtime error using ${PLANTED_KEY} while calling api`);
    assert.ok(!masked.includes(PLANTED_KEY), "the planted key value is value-redacted");
    assert.ok(masked.includes("runtime error"), "the non-secret context survives redaction");
  } finally {
    await live.stop();
    await fake.close();
  }

  // --- (3) shutdown stopped BOTH the socket and the child (one owner). ---
  assert.equal(sup.stopped, true, "the supervisor child was stopped on shutdown");
  assert.equal(sup.supervisor.isAlive(), false);
  assert.equal(sup.supervisor.baseUrl, null, "the child base URL is gone after stop");
});
