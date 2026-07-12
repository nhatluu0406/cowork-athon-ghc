/**
 * Progressive readiness tests (CGHC-025 cold-start — the honesty-critical UI contract).
 *
 * Driven synchronously against happy-dom with INJECTED fakes (no socket, no real time): a fake
 * bootstrap source, a fake health client, and a fake timer for the backoff seam. They prove the
 * boot surface is HONEST:
 *  - Phases render in order and NEVER skip to `ready` without a real successful `health()`.
 *  - A health failure / timeout / `protocol_mismatch` → an honest `unreachable` state with a
 *    Retry AND a diagnostics affordance — never a fabricated ready. Retry re-probes → ready.
 *  - A missing handshake (empty base URL/token) → a truthful `not_connected` + retry, not a
 *    spinner forever.
 *  - Backoff/poll is bounded (delay capped) and STOPS once ready or on teardown (no leak).
 *  - No secret/token ever appears in the DOM or the diagnostics panel.
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SERVICE_NAME, type RendererBootstrap } from "@cowork-ghc/contracts";
import { ServiceClientError, type ServiceHealth } from "../src/service-client.js";
import {
  createReadinessController,
  type ReadinessState,
  type ReadinessTimer,
} from "../src/readiness-controller.js";
import { createReadinessView } from "../src/readiness-view.js";

const HEALTH: ServiceHealth = {
  status: "ok",
  service: SERVICE_NAME,
  startedAt: "2026-07-11T00:00:00.000Z",
  uptimeMs: 1234,
};
const BOOTSTRAP: RendererBootstrap = {
  serviceBaseUrl: "http://127.0.0.1:53421",
  clientToken: "unit-token",
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

interface FakeTimer {
  readonly timer: ReadinessTimer;
  readonly delays: number[];
  scheduledCount(): number;
  pendingCount(): number;
  /** Fire every currently-pending timer (this controller keeps at most one). */
  fire(): void;
}

function makeTimer(): FakeTimer {
  const handlers = new Map<number, () => void>();
  const delays: number[] = [];
  let nextId = 1;
  let scheduled = 0;
  return {
    delays,
    scheduledCount: () => scheduled,
    pendingCount: () => handlers.size,
    fire: () => {
      const entries = [...handlers.entries()];
      handlers.clear();
      for (const [, fn] of entries) fn();
    },
    timer: {
      setTimeout: (fn, ms) => {
        scheduled += 1;
        delays.push(ms);
        const id = nextId++;
        handlers.set(id, fn);
        return id;
      },
      clearTimeout: (h) => {
        handlers.delete(h as number);
      },
    },
  };
}

interface Harness {
  readonly container: HTMLElement;
  readonly states: ReadinessState[];
  readonly timer: FakeTimer;
  readonly controller: ReturnType<typeof createReadinessController>;
}

function mount(opts: {
  getBootstrap: () => Promise<RendererBootstrap>;
  client: { health(): Promise<ServiceHealth> };
}): Harness {
  const container = document.createElement("div");
  document.body.append(container);
  const states: ReadinessState[] = [];
  const timer = makeTimer();
  const controller = createReadinessController({
    getBootstrap: opts.getBootstrap,
    createClient: () => opts.client, // ignore url/token; the token is never needed to render
    onState: (s) => {
      states.push(s);
      view.update(s);
    },
    timer: timer.timer,
    backoff: { baseMs: 10, factor: 2, maxMs: 40 },
  });
  const view = createReadinessView(container, { onRetry: () => controller.retry() });
  return { container, states, timer, controller };
}

test("progressive phases render in order: starting → connecting → ready", async () => {
  const h = mount({ getBootstrap: async () => BOOTSTRAP, client: { health: async () => HEALTH } });
  h.controller.start();
  await flush();

  assert.deepEqual(
    h.states.map((s) => s.phase),
    ["starting", "connecting", "ready"],
    "phases must progress honestly, never jumping straight to ready",
  );
  const detail = h.container.querySelector(".readiness-detail");
  assert.match(detail!.textContent ?? "", /uptime=1234ms/, "ready shows real non-secret health");
  h.controller.stop();
});

test("health failure → honest unreachable with Retry + diagnostics, never fabricated ready", async () => {
  let healthy = false;
  const client = {
    health: async (): Promise<ServiceHealth> => {
      if (!healthy) throw new Error("connect ECONNREFUSED 127.0.0.1:53421");
      return HEALTH;
    },
  };
  const h = mount({ getBootstrap: async () => BOOTSTRAP, client });
  h.controller.start();
  await flush();

  assert.equal(h.states.at(-1)?.phase, "unreachable", "a down service is unreachable, not ready");
  assert.ok(!h.states.some((s) => s.phase === "ready"), "NEVER a fabricated ready on failure");
  const recovery = h.container.querySelector<HTMLElement>(".readiness-recovery");
  assert.equal(recovery?.hidden, false, "recovery affordance is shown");
  assert.ok(h.container.querySelector(".readiness-retry"), "Retry action present");
  assert.ok(h.container.querySelector("details.readiness-diagnostics"), "diagnostics affordance present");

  // Retry against a now-healthy client → real ready.
  healthy = true;
  h.container.querySelector<HTMLButtonElement>(".readiness-retry")!.click();
  await flush();
  assert.equal(h.states.at(-1)?.phase, "ready", "Retry re-probes and transitions to ready");
  h.controller.stop();
});

test("protocol_mismatch surfaces honest unreachable (drifted wire contract, not ready)", async () => {
  const client = {
    health: async (): Promise<ServiceHealth> => {
      throw new ServiceClientError("protocol_mismatch", "Unexpected boundary protocol (expected v1).");
    },
  };
  const h = mount({ getBootstrap: async () => BOOTSTRAP, client });
  h.controller.start();
  await flush();

  const last = h.states.at(-1);
  assert.equal(last?.phase, "unreachable");
  assert.equal(last?.phase === "unreachable" ? last.code : "", "protocol_mismatch");
  assert.ok(!h.states.some((s) => s.phase === "ready"));
  h.controller.stop();
});

test("missing handshake (empty base URL/token) → truthful not_connected + retry, not a spinner", async () => {
  const h = mount({
    getBootstrap: async () => ({ serviceBaseUrl: "", clientToken: "" }),
    client: { health: async () => HEALTH },
  });
  h.controller.start();
  await flush();

  assert.equal(h.states.at(-1)?.phase, "not_connected", "empty handshake is honestly not_connected");
  assert.ok(!h.states.some((s) => s.phase === "connecting"), "never probes health without config");
  assert.ok(!h.states.some((s) => s.phase === "ready"), "never fabricated ready without a handshake");
  const recovery = h.container.querySelector<HTMLElement>(".readiness-recovery");
  assert.equal(recovery?.hidden, false, "retry offered instead of an infinite spinner");
  h.controller.stop();
});

test("bootstrap that throws (bridge unavailable) → not_connected, honestly", async () => {
  const h = mount({
    getBootstrap: async () => {
      throw new Error("Shell bridge is unavailable");
    },
    client: { health: async () => HEALTH },
  });
  h.controller.start();
  await flush();
  assert.equal(h.states.at(-1)?.phase, "not_connected");
  h.controller.stop();
});

test("polling backs off on failure and STOPS once ready (bounded, no leak)", async () => {
  let healthy = false;
  const client = {
    health: async (): Promise<ServiceHealth> => {
      if (!healthy) throw new Error("service down");
      return HEALTH;
    },
  };
  const h = mount({ getBootstrap: async () => BOOTSTRAP, client });
  h.controller.start();
  await flush();
  assert.equal(h.timer.pendingCount(), 1, "one backoff timer pending after first failure");

  h.timer.fire(); // re-probe, still failing → re-schedules
  await flush();
  assert.equal(h.timer.scheduledCount(), 2, "backoff re-scheduled on repeated failure");

  healthy = true;
  h.timer.fire(); // re-probe → ready
  await flush();
  assert.equal(h.states.at(-1)?.phase, "ready");
  assert.equal(h.timer.pendingCount(), 0, "polling STOPS once ready — no pending timer");
  assert.ok(Math.max(...h.timer.delays) <= 40, "backoff delay is bounded by maxMs");
  h.controller.stop();
});

test("stop() clears the pending backoff timer (no leaked interval on teardown)", async () => {
  const client = { health: async (): Promise<ServiceHealth> => { throw new Error("down"); } };
  const h = mount({ getBootstrap: async () => BOOTSTRAP, client });
  h.controller.start();
  await flush();
  assert.equal(h.timer.pendingCount(), 1);
  h.controller.stop();
  assert.equal(h.timer.pendingCount(), 0, "teardown clears the pending timer");
});

test("no secret/token appears in the DOM or the diagnostics panel after any phase", async () => {
  const TOKEN = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"; // 64-hex per-launch shape
  const client = {
    health: async (): Promise<ServiceHealth> => {
      // Adversarial: the raw error embeds the token — the diagnostics MUST scrub it.
      throw new Error(`Auth failed: Bearer ${TOKEN} rejected`);
    },
  };
  const h = mount({
    getBootstrap: async () => ({ serviceBaseUrl: "http://127.0.0.1:9", clientToken: TOKEN }),
    client,
  });
  h.controller.start();
  await flush();

  const diag = h.container.querySelector<HTMLDetailsElement>("details.readiness-diagnostics")!;
  diag.open = true; // reveal the diagnostics detail
  assert.ok(!h.container.innerHTML.includes(TOKEN), "token never appears anywhere in the DOM");
  assert.ok(
    !(h.container.querySelector(".readiness-diag-detail")?.textContent ?? "").includes(TOKEN),
    "diagnostics detail is scrubbed of the token",
  );
  h.controller.stop();
});
