/**
 * Live EV stream client tests (CGHC-015).
 *
 * Drives {@link startEvStream} with an INJECTED fetch that returns an in-memory snapshot +
 * an in-memory SSE `ReadableStream` — no real socket, and a synchronous flush scheduler so
 * the whole pipeline settles on `handle.done` (no unbounded wait). Covers: snapshot adoption,
 * resume-cursor dedupe, terminal close, and the security invariant that the client token is
 * NEVER written to the DOM.
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOUNDARY_PROTOCOL_VERSION, type EvEvent } from "@cowork-ghc/contracts";
import {
  encodeEvSseFrame,
  encodeSseHeartbeat,
  foldEv,
  type SessionView,
} from "@cowork-ghc/service/execution";
import { startEvStream, type EvStreamHandle } from "../src/ev-stream-client.js";
import { createTimelineView } from "../src/timeline-view.js";

/** Yield past all pending microtasks so an awaiting read loop parks on its next read(). */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const SID = "session-stream";
const AT = "2026-07-11T00:00:00.000Z";
// A per-launch-token-shaped string (64 hex chars) that must never surface in the DOM.
const CLIENT_TOKEN = "abcdef0123456789".repeat(4);

/** Build an injectable fetch: `/snapshot` → the folded view; the live path → an SSE stream. */
function makeFetch(snapshot: SessionView, frames: readonly string[]): typeof fetch {
  const impl = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/snapshot")) {
      const body = {
        protocol: BOUNDARY_PROTOCOL_VERSION,
        ok: true,
        data: { found: true, resumeSeq: snapshot.lastSeq, snapshot },
      };
      return { json: async () => body, body: null } as unknown as Response;
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    });
    return { json: async () => ({}), body: stream } as unknown as Response;
  };
  return impl as unknown as typeof fetch;
}

test("adopts the snapshot, dedupes by resume cursor, and folds live frames to the terminal", async () => {
  const snapshot = foldEv(SID, [
    { kind: "plan", sessionId: SID, seq: 1, at: AT, todos: [{ id: "t1", title: "Bắt đầu", status: "running" }] },
    { kind: "token", sessionId: SID, seq: 2, at: AT, delta: "AB" },
  ]);
  assert.equal(snapshot.lastSeq, 2);

  const live: readonly EvEvent[] = [
    { kind: "token", sessionId: SID, seq: 2, at: AT, delta: "DUP" }, // <= resume cursor → dropped
    { kind: "token", sessionId: SID, seq: 3, at: AT, delta: "C" },
    { kind: "terminal", sessionId: SID, seq: 4, at: AT, state: "completed" },
  ];
  const frames = [encodeSseHeartbeat(), ...live.map(encodeEvSseFrame)];

  const views: SessionView[] = [];
  const handle = startEvStream({
    baseUrl: "http://127.0.0.1:65535",
    clientToken: CLIENT_TOKEN,
    sessionId: SID,
    onView: (v) => views.push(v),
    fetchImpl: makeFetch(snapshot, frames),
    scheduleFlush: (flush) => flush(), // synchronous → deterministic
  });
  await handle.done;

  assert.ok(views.length >= 1, "at least the adopted snapshot is emitted");
  assert.equal(views[0]?.text, "AB", "first emit adopts the authoritative snapshot");
  const final = views[views.length - 1];
  assert.equal(final?.text, "ABC", "dup seq<=cursor dropped; only seq 3 token applied");
  assert.equal(final?.terminal, "completed");
  assert.equal(final?.status, "completed");
});

test("the client token is NEVER written to the DOM after rendering the stream", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const timeline = createTimelineView(container);

  const snapshot = foldEv(SID, [
    { kind: "plan", sessionId: SID, seq: 1, at: AT, todos: [{ id: "t1", title: "Chạy", status: "running" }] },
  ]);
  const live: readonly EvEvent[] = [
    { kind: "token", sessionId: SID, seq: 2, at: AT, delta: "xin chào" },
    { kind: "terminal", sessionId: SID, seq: 3, at: AT, state: "completed" },
  ];

  const handle = startEvStream({
    baseUrl: "http://127.0.0.1:65535",
    clientToken: CLIENT_TOKEN,
    sessionId: SID,
    onView: (v) => timeline.update(v),
    fetchImpl: makeFetch(snapshot, live.map(encodeEvSseFrame)),
    scheduleFlush: (flush) => flush(),
  });
  await handle.done;

  const serialized = container.outerHTML + " " + (container.textContent ?? "");
  assert.equal(serialized.includes(CLIENT_TOKEN), false, "the client token must not appear in the DOM");
  // Sanity: the stream DID render (so the negative assertion is meaningful).
  assert.equal(container.querySelector('[data-terminal-state="completed"]')?.textContent, "Hoàn thành");
});

test("an already-terminal snapshot closes immediately without opening the live stream", async () => {
  let streamOpened = false;
  const snapshot = foldEv(SID, [
    { kind: "terminal", sessionId: SID, seq: 1, at: AT, state: "errored" },
  ]);
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/snapshot")) {
      return { json: async () => ({ protocol: BOUNDARY_PROTOCOL_VERSION, ok: true, data: { found: true, resumeSeq: 1, snapshot } }), body: null } as unknown as Response;
    }
    streamOpened = true;
    return { json: async () => ({}), body: null } as unknown as Response;
  }) as unknown as typeof fetch;

  const views: SessionView[] = [];
  const handle = startEvStream({
    baseUrl: "http://127.0.0.1:65535",
    clientToken: CLIENT_TOKEN,
    sessionId: SID,
    onView: (v) => views.push(v),
    fetchImpl,
    scheduleFlush: (flush) => flush(),
  });
  await handle.done;

  assert.equal(streamOpened, false, "no live stream is opened for a finished run");
  assert.equal(views[views.length - 1]?.terminal, "errored");
});

// FIX-UI-1 (HIGH-1) — a stream that ENDS without a terminal is a premature disconnect, not a
// finished run: it must surface an honest error + a recovery affordance (never perpetual running).
test("EOF before terminal surfaces an honest disconnect + recovery, not a perpetual running", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const timeline = createTimelineView(container);

  const snapshot = foldEv(SID, [
    { kind: "plan", sessionId: SID, seq: 1, at: AT, todos: [{ id: "t1", title: "Chạy", status: "running" }] },
  ]);
  // A single token, then the SSE stream just closes (EOF) with NO terminal frame.
  const live: readonly EvEvent[] = [{ kind: "token", sessionId: SID, seq: 2, at: AT, delta: "một phần" }];

  const errors: string[] = [];
  const handle = startEvStream({
    baseUrl: "http://127.0.0.1:65535",
    clientToken: CLIENT_TOKEN,
    sessionId: SID,
    onView: (v) => timeline.update(v),
    onError: (m) => errors.push(m),
    fetchImpl: makeFetch(snapshot, live.map(encodeEvSseFrame)),
    scheduleFlush: (flush) => flush(),
  });
  await handle.done;

  assert.equal(container.querySelector("[data-terminal-state]"), null, "no fabricated terminal marker");
  const message = container.querySelector(".ev-error-message");
  assert.ok(message, "an honest disconnect error is rendered");
  assert.match(message?.textContent ?? "", /Mất kết nối/);
  const recovery = container.querySelector<HTMLButtonElement>(".ev-error-recovery");
  assert.ok(recovery, "a recovery affordance appears");
  assert.equal(recovery?.dataset["recovery"], "retry");
  assert.equal(errors.length, 1, "the onError sink also received the disconnect message");
  // Honest, not a silent perpetual 'running': status is truthful and the disconnect is visible.
  assert.equal(container.querySelector<HTMLElement>(".ev-status")?.dataset["status"], "running");
});

// FIX-UI-1 — clicking the disconnect recovery button reconnects via the snapshot→sinceSeq path.
test("clicking the disconnect recovery button reconnects via a fresh snapshot load", async () => {
  const container = document.createElement("div");
  document.body.append(container);

  const snapshot = foldEv(SID, [
    { kind: "plan", sessionId: SID, seq: 1, at: AT, todos: [{ id: "t1", title: "Chạy", status: "running" }] },
  ]);
  let snapshotCalls = 0;
  let connectCalls = 0;
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/snapshot")) {
      snapshotCalls += 1;
      return { json: async () => ({ protocol: BOUNDARY_PROTOCOL_VERSION, ok: true, data: { found: true, resumeSeq: snapshot.lastSeq, snapshot } }), body: null } as unknown as Response;
    }
    connectCalls += 1;
    // First connect: token then EOF (disconnect). Reconnect: a real terminal (honest finish).
    const frames =
      connectCalls === 1
        ? [encodeEvSseFrame({ kind: "token", sessionId: SID, seq: 2, at: AT, delta: "phần" })]
        : [encodeEvSseFrame({ kind: "terminal", sessionId: SID, seq: 2, at: AT, state: "completed" })];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        for (const f of frames) c.enqueue(enc.encode(f));
        c.close();
      },
    });
    return { json: async () => ({}), body: stream } as unknown as Response;
  }) as unknown as typeof fetch;

  let handle: EvStreamHandle;
  const kinds: string[] = [];
  let reconnectPromise: Promise<void> = Promise.resolve();
  const timeline = createTimelineView(container, (kind) => {
    kinds.push(kind);
    reconnectPromise = handle.reconnect();
  });

  handle = startEvStream({
    baseUrl: "http://127.0.0.1:65535",
    clientToken: CLIENT_TOKEN,
    sessionId: SID,
    onView: (v) => timeline.update(v),
    fetchImpl,
    scheduleFlush: (flush) => flush(),
  });
  await handle.done;

  assert.equal(snapshotCalls, 1, "one snapshot load on the initial connect");
  const button = container.querySelector<HTMLButtonElement>(".ev-error-recovery");
  assert.ok(button, "the disconnect rendered a recovery button");
  button?.click();
  await reconnectPromise;

  assert.deepEqual(kinds, ["retry"], "onRecovery fired with the disconnect kind");
  assert.equal(snapshotCalls, 2, "clicking recovery reconnects via a fresh snapshot load");
  assert.equal(container.querySelector('[data-terminal-state="completed"]')?.textContent, "Hoàn thành");
  assert.equal(container.querySelector(".ev-error-message"), null, "the reconnect cleared the disconnect error");
});

// FIX-UI-6 (MEDIUM-6 coalescing) — many frames applied in ONE tick collapse into a single onView.
test("async scheduleFlush coalesces N frames applied in one tick into a single onView", async () => {
  const snapshot = foldEv(SID, [
    { kind: "plan", sessionId: SID, seq: 1, at: AT, todos: [{ id: "t1", title: "Chạy", status: "running" }] },
  ]);
  const live: readonly EvEvent[] = [
    { kind: "token", sessionId: SID, seq: 2, at: AT, delta: "A" },
    { kind: "token", sessionId: SID, seq: 3, at: AT, delta: "B" },
    { kind: "token", sessionId: SID, seq: 4, at: AT, delta: "C" },
    { kind: "terminal", sessionId: SID, seq: 5, at: AT, state: "completed" },
  ];
  // All frames arrive as ONE chunk, so they are folded synchronously within a single tick.
  const oneChunk = live.map(encodeEvSseFrame).join("");

  const views: SessionView[] = [];
  const handle = startEvStream({
    baseUrl: "http://127.0.0.1:65535",
    clientToken: CLIENT_TOKEN,
    sessionId: SID,
    onView: (v) => views.push(v),
    fetchImpl: makeFetch(snapshot, [oneChunk]),
    scheduleFlush: (flush) => setTimeout(flush, 0), // a genuinely async coalescer (not sync)
  });
  await handle.done;
  await tick();
  await tick();

  assert.equal(views.length, 1, "N frames in one tick coalesce into exactly one onView");
  assert.equal(views[0]?.text, "ABC", "the single coalesced view carries all folded deltas");
  assert.equal(views[0]?.terminal, "completed", "and the final terminal");
});

// MEDIUM-5 (CGHC-025) — the DEFAULT coalescer frame-aligns to requestAnimationFrame, so a burst
// of frames across chunks collapses to ≤1 render per frame. Here rAF is stubbed to run once.
test("the default scheduleFlush frame-aligns via requestAnimationFrame (coalescing to one onView)", async () => {
  const snapshot = foldEv(SID, [
    { kind: "plan", sessionId: SID, seq: 1, at: AT, todos: [{ id: "t1", title: "Chạy", status: "running" }] },
  ]);
  const live: readonly EvEvent[] = [
    { kind: "token", sessionId: SID, seq: 2, at: AT, delta: "A" },
    { kind: "token", sessionId: SID, seq: 3, at: AT, delta: "B" },
    { kind: "terminal", sessionId: SID, seq: 4, at: AT, state: "completed" },
  ];
  const oneChunk = live.map(encodeEvSseFrame).join(""); // all frames folded in one tick

  let rafCalls = 0;
  const prevRaf = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  (globalThis as unknown as { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame = (
    cb,
  ) => {
    rafCalls += 1;
    setTimeout(cb, 0); // run on the next macrotask, like a real frame
    return rafCalls;
  };
  try {
    const views: SessionView[] = [];
    const handle = startEvStream({
      baseUrl: "http://127.0.0.1:65535",
      clientToken: CLIENT_TOKEN,
      sessionId: SID,
      onView: (v) => views.push(v),
      fetchImpl: makeFetch(snapshot, [oneChunk]),
      // NOTE: no scheduleFlush → the default rAF-aligned coalescer is exercised.
    });
    await handle.done;
    await tick();
    await tick();

    assert.ok(rafCalls >= 1, "the default coalescer used requestAnimationFrame");
    assert.equal(views.length, 1, "N frames in one tick coalesce into exactly one onView");
    assert.equal(views[0]?.text, "AB", "the single coalesced view carries all folded deltas");
    assert.equal(views[0]?.terminal, "completed");
  } finally {
    if (prevRaf === undefined) {
      delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    } else {
      (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = prevRaf;
    }
  }
});

// FIX-UI-6 (MEDIUM-6 teardown) — stop() mid-stream cancels the reader and emits nothing further.
test("stop() mid-stream cancels the reader and surfaces no further onView / no error", async () => {
  const snapshot = foldEv(SID, [
    { kind: "plan", sessionId: SID, seq: 1, at: AT, todos: [{ id: "t1", title: "Chạy", status: "running" }] },
  ]);
  const firstFrame = encodeEvSseFrame({ kind: "token", sessionId: SID, seq: 2, at: AT, delta: "một phần" });
  let cancelled = false;
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/snapshot")) {
      return { json: async () => ({ protocol: BOUNDARY_PROTOCOL_VERSION, ok: true, data: { found: true, resumeSeq: snapshot.lastSeq, snapshot } }), body: null } as unknown as Response;
    }
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(firstFrame)); // one frame; DON'T close — stays open
      },
      cancel() {
        cancelled = true;
      },
    });
    return { json: async () => ({}), body: stream } as unknown as Response;
  }) as unknown as typeof fetch;

  const views: SessionView[] = [];
  const errors: string[] = [];
  const handle = startEvStream({
    baseUrl: "http://127.0.0.1:65535",
    clientToken: CLIENT_TOKEN,
    sessionId: SID,
    onView: (v) => views.push(v),
    onError: (m) => errors.push(m),
    fetchImpl,
    scheduleFlush: (flush) => flush(),
  });

  await tick(); // let the snapshot + first frame flow; the read loop now parks on the open read
  const countBeforeStop = views.length;
  handle.stop();
  await handle.done;

  assert.equal(cancelled, true, "stop() cancels the underlying reader/stream");
  assert.equal(errors.length, 0, "an intentional stop() surfaces NO error");
  assert.equal(views.length, countBeforeStop, "no further onView fires after stop()");
});

// FIX-2 (CGHC-025 LOW) — the snapshot unwrap must apply the SAME GATE 2 protocol-version guard as
// the service client: a snapshot envelope carrying a WRONG/drifted protocol tag is refused via the
// honest error path — never silently adopted, and never fabricated into a ready/terminal state.
test("a snapshot envelope with a WRONG protocol is rejected honestly, not adopted", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const timeline = createTimelineView(container);

  const snapshot = foldEv(SID, [
    { kind: "plan", sessionId: SID, seq: 1, at: AT, todos: [{ id: "t1", title: "Chạy", status: "running" }] },
  ]);
  let streamOpened = false;
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/snapshot")) {
      // A drifted wire contract: the peer stamped an OLD protocol tag.
      return {
        json: async () => ({ protocol: "cghc.boundary.v0", ok: true, data: { found: true, resumeSeq: 1, snapshot } }),
        body: null,
      } as unknown as Response;
    }
    streamOpened = true;
    return { json: async () => ({}), body: null } as unknown as Response;
  }) as unknown as typeof fetch;

  const views: SessionView[] = [];
  const errors: string[] = [];
  const handle = startEvStream({
    baseUrl: "http://127.0.0.1:65535",
    clientToken: CLIENT_TOKEN,
    sessionId: SID,
    onView: (v) => {
      views.push(v);
      timeline.update(v);
    },
    onError: (m) => errors.push(m),
    fetchImpl,
    scheduleFlush: (flush) => flush(),
  });
  await handle.done;

  assert.equal(streamOpened, false, "a drifted snapshot must NOT open the live stream");
  assert.equal(errors.length, 1, "the mismatch surfaces one honest error");
  assert.match(errors[0] ?? "", /Giao thức ranh giới không khớp/);
  // No fabricated ready/terminal state adopted from the drifted snapshot.
  assert.equal(
    views.some((v) => v.terminal !== null),
    false,
    "no terminal state is fabricated from a drifted snapshot",
  );
  assert.equal(container.querySelector("[data-terminal-state]"), null, "no fabricated terminal marker in the DOM");
});

// FIX-2 (companion) — a snapshot with the CORRECT protocol tag is adopted normally.
test("a snapshot envelope with the CORRECT protocol is adopted", async () => {
  const snapshot = foldEv(SID, [
    { kind: "plan", sessionId: SID, seq: 1, at: AT, todos: [{ id: "t1", title: "Chạy", status: "running" }] },
    { kind: "token", sessionId: SID, seq: 2, at: AT, delta: "OK" },
  ]);
  const live: readonly EvEvent[] = [{ kind: "terminal", sessionId: SID, seq: 3, at: AT, state: "completed" }];

  const views: SessionView[] = [];
  const errors: string[] = [];
  const handle = startEvStream({
    baseUrl: "http://127.0.0.1:65535",
    clientToken: CLIENT_TOKEN,
    sessionId: SID,
    onView: (v) => views.push(v),
    onError: (m) => errors.push(m),
    fetchImpl: makeFetch(snapshot, live.map(encodeEvSseFrame)),
    scheduleFlush: (flush) => flush(),
  });
  await handle.done;

  assert.equal(errors.length, 0, "a correct protocol tag surfaces no error");
  assert.equal(views[0]?.text, "OK", "the authoritative snapshot is adopted");
  assert.equal(views[views.length - 1]?.terminal, "completed");
});
