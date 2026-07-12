/**
 * CGHC-028 live-run wiring — the `/event` pump in isolation, against the fake OpenCode `/event`
 * SSE server (NO real OpenCode). Proves: it opens ONE `/event` consumer, demuxes frames by
 * `sessionID`, feeds each into the right run, drops frames for unknown/other sessions, closes a
 * run on a real terminal frame, and on `stop()` closes the consumer with no further feed and no
 * leaked handle. All awaits are bounded.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventPump, type PumpRunController } from "../src/runtime/index.js";
import { startFakeOpencodeServer } from "./opencode-fake-server.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitUntil(pred: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`${what} not satisfied within ${ms}ms`);
    await sleep(5);
  }
}

interface RecordingRun extends PumpRunController {
  readonly frames: unknown[];
  closed: number;
}

function recorder(): { open: (id: string) => PumpRunController; runs: Map<string, RecordingRun> } {
  const runs = new Map<string, RecordingRun>();
  return {
    runs,
    open(id) {
      const existing = runs.get(id);
      if (existing) return existing;
      const run: RecordingRun = {
        frames: [],
        closed: 0,
        ingest: (frame) => void run.frames.push(frame),
        close: () => void (run.closed += 1),
      };
      runs.set(id, run);
      return run;
    },
  };
}

const delta = (sid: string, text: string): unknown => ({
  type: "message.part.delta",
  properties: { sessionID: sid, delta: text },
});
const idle = (sid: string): unknown => ({ type: "session.idle", properties: { sessionID: sid } });

test("event pump demuxes by sessionID, feeds known runs, and drops unknown ones", async () => {
  const fake = await startFakeOpencodeServer();
  const rec = recorder();
  const known = new Set(["s1", "s2"]);
  const pump = createEventPump({
    baseUrl: () => fake.baseUrl,
    target: { knows: (id) => known.has(id), open: rec.open },
    reconnectDelayMs: 20,
  });
  pump.start();
  try {
    await waitUntil(() => fake.eventClientCount() >= 1, 3000, "pump connects to /event");

    fake.emitEvent(delta("s1", "hello"));
    fake.emitEvent(delta("s2", "world"));
    fake.emitEvent(delta("sX", "ignored")); // unknown session → must be dropped
    await waitUntil(
      () => (rec.runs.get("s1")?.frames.length ?? 0) >= 1 && (rec.runs.get("s2")?.frames.length ?? 0) >= 1,
      3000,
      "both known sessions fed",
    );

    assert.equal(rec.runs.get("s1")?.frames.length, 1, "s1 got exactly its own frame");
    assert.equal(rec.runs.get("s2")?.frames.length, 1, "s2 got exactly its own frame");
    assert.equal(rec.runs.has("sX"), false, "no run was opened for the unknown session");

    // A real terminal frame closes that session's run (no fabricated terminal, honest close).
    fake.emitEvent(idle("s1"));
    await waitUntil(() => (rec.runs.get("s1")?.closed ?? 0) === 1, 3000, "s1 run closed on idle");
    assert.equal(rec.runs.get("s2")?.closed ?? 0, 0, "s2 run is untouched by s1's terminal");
  } finally {
    await pump.stop();
    await fake.close();
  }
});

test("event pump stop() closes the /event consumer — no further feed, no leaked handle", async () => {
  const fake = await startFakeOpencodeServer();
  const rec = recorder();
  const pump = createEventPump({
    baseUrl: () => fake.baseUrl,
    target: { knows: () => true, open: rec.open },
    reconnectDelayMs: 20,
  });
  pump.start();
  await waitUntil(() => fake.eventClientCount() >= 1, 3000, "pump connects");
  fake.emitEvent(delta("s1", "before-stop"));
  await waitUntil(() => (rec.runs.get("s1")?.frames.length ?? 0) === 1, 3000, "first frame fed");

  await pump.stop();

  // The consumer socket is gone (no leaked handle) and open runs were closed on teardown.
  await waitUntil(() => fake.eventClientCount() === 0, 3000, "consumer closed on stop");
  assert.ok((rec.runs.get("s1")?.closed ?? 0) >= 1, "the open run was closed by stop()");

  const before = rec.runs.get("s1")?.frames.length ?? 0;
  fake.emitEvent(delta("s1", "after-stop")); // nobody is listening now
  await sleep(50);
  assert.equal(rec.runs.get("s1")?.frames.length ?? 0, before, "no frame is fed after stop()");

  await fake.close();
});
