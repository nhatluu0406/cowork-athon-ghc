/**
 * Post-bind health readiness probe (packaged service lifecycle).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createHealthVerifiedStartService,
  ServiceReadinessError,
  waitForServiceHealth,
} from "../src/service/wait-for-health.js";

const BASE_URL = "http://127.0.0.1:54321";
const TOKEN = "per-launch-secret-token-abc123";

test("waitForServiceHealth resolves when /v1/health returns ok", async () => {
  let calls = 0;
  await waitForServiceHealth({
    baseUrl: BASE_URL,
    token: TOKEN,
    fetchImpl: async () => {
      calls += 1;
      return {
        status: 200,
        json: async () => ({ ok: true, data: { status: "ok" } }),
      } as Response;
    },
  });
  assert.equal(calls, 1);
});

test("waitForServiceHealth retries until health becomes ready", async () => {
  let calls = 0;
  await waitForServiceHealth({
    baseUrl: BASE_URL,
    token: TOKEN,
    intervalMs: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("connection refused");
      }
      return {
        status: 200,
        json: async () => ({ ok: true, data: { status: "ok" } }),
      } as Response;
    },
  });
  assert.equal(calls, 3);
});

test("waitForServiceHealth throws ServiceReadinessError on timeout", async () => {
  await assert.rejects(
    () =>
      waitForServiceHealth({
        baseUrl: BASE_URL,
        token: TOKEN,
        timeoutMs: 50,
        intervalMs: 10,
        fetchImpl: async () => {
          throw new Error("connection refused");
        },
      }),
    (err: unknown) => err instanceof ServiceReadinessError,
  );
});

test("createHealthVerifiedStartService returns only after health is ready", async () => {
  let started = false;
  let healthCalls = 0;
  const start = createHealthVerifiedStartService(async () => {
    started = true;
    return { baseUrl: BASE_URL, token: TOKEN, stop: async () => {} };
  }, {
    intervalMs: 1,
    fetchImpl: async () => {
      healthCalls += 1;
      if (!started) throw new Error("started handle not assigned yet");
      return {
        status: 200,
        json: async () => ({ ok: true, data: { status: "ok" } }),
      } as Response;
    },
  });

  const running = await start();
  assert.equal(running.baseUrl, BASE_URL);
  assert.ok(healthCalls >= 1);
});
