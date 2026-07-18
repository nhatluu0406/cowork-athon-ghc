/**
 * Power Automate flow-trigger tests. The service combines two designs after the rebase onto main:
 *  - main's SSRF hardening: the fetch is IP-PINNED to an SSRF-validated address via the injected
 *    dialer (rebinding guard), the socket's actual IP is asserted (F2), and the URL host must be
 *    in the Logic Apps allowlist (no arbitrary-host exfil);
 *  - the branch's bounded feedback: the trigger returns the flow's status + bounded body and
 *    honors a per-flow timeout (a timed-out flow surfaces as an Ms365Error "timeout").
 * A non-2xx is RETURNED (status + body), not thrown, so the tool layer can surface the flow's own
 * error payload. No real network: the SSRF policy, the dialer, and the store are all fakes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createPowerAutomateService } from "../src/ms365/power-automate-service.js";
import {
  createPowerAutomateStore,
  type PowerAutomateFlow,
  type PowerAutomateStore,
} from "../src/ms365/power-automate-store.js";
import { Ms365Error } from "../src/ms365/ms365-errors.js";
import { SsrfBlockedError, type ConnectTarget, type SsrfPolicy } from "../src/provider/index.js";
import {
  ProbeTimeoutError,
  type HttpDialer,
  type HttpProbeRequest,
  type HttpProbeResponse,
} from "../src/provider/http-dialer.js";

async function storeWith(flows: readonly PowerAutomateFlow[]): Promise<PowerAutomateStore> {
  return createPowerAutomateStore({ persistence: { load: async () => flows, save: async () => {} } });
}

/** SSRF stub for the store-only tests (listFlows/resolveFlow never dial). */
const allowAll: SsrfPolicy = { assertAllowed: async () => {} } as unknown as SsrfPolicy;

/** A fake SSRF policy that "resolves" any URL to a single fixed validated IP (or refuses). */
function fakeSsrf(resolvedIp: string | null): SsrfPolicy {
  return {
    async evaluate(rawUrl) {
      if (resolvedIp === null) return { allowed: false, reason: "private", detail: "10.0.0.1" };
      return { allowed: true, target: { url: new URL(rawUrl), resolved: [{ address: resolvedIp, family: 4 }] } };
    },
    async assertAllowed(rawUrl): Promise<ConnectTarget> {
      if (resolvedIp === null) throw new SsrfBlockedError("private", "10.0.0.1");
      return { url: new URL(rawUrl), resolved: [{ address: resolvedIp, family: 4 }] };
    },
  };
}

/**
 * A recording fake dialer. `status`/`body`/`dialedIp` shape the response; `timeout: true` makes
 * it reject like the real dialer does on expiry (ProbeTimeoutError).
 */
function fakeDialer(opts: { status?: number; dialedIp?: string; body?: string; timeout?: boolean }): {
  dialer: HttpDialer;
  calls: HttpProbeRequest[];
} {
  const calls: HttpProbeRequest[] = [];
  const dialer: HttpDialer = async (req): Promise<HttpProbeResponse> => {
    calls.push(req);
    if (opts.timeout) throw new ProbeTimeoutError(req.timeoutMs);
    return {
      status: opts.status ?? 200,
      headers: {},
      dialedIp: opts.dialedIp ?? "20.1.2.3",
      ...(opts.body !== undefined ? { bodyText: opts.body } : {}),
    };
  };
  return { dialer, calls };
}

const FLOW_URL =
  "https://prod-12.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=SECRET";

test("triggerFlow dials the SSRF-validated IP (pinned) and returns the flow status + body", async () => {
  const { dialer, calls } = fakeDialer({ status: 202, dialedIp: "20.1.2.3", body: "queued" });
  const svc = createPowerAutomateService({ store: await storeWith([]), ssrf: fakeSsrf("20.1.2.3"), dialer });

  const res = await svc.triggerFlow({ url: FLOW_URL, payload: { hello: "world" }, timeoutMs: 5000 });

  assert.deepEqual(res, { status: 202, body: "queued" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.ip, "20.1.2.3"); // pinned to the validated address, not re-resolved
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.readBody, true); // await the flow's feedback
  assert.equal(calls[0]?.url.hostname, "prod-12.westus.logic.azure.com");
});

test("triggerFlow refuses a host outside the Logic Apps allowlist WITHOUT dialing", async () => {
  const { dialer, calls } = fakeDialer({ status: 200, dialedIp: "20.1.2.3" });
  const svc = createPowerAutomateService({ store: await storeWith([]), ssrf: fakeSsrf("20.1.2.3"), dialer });

  await assert.rejects(
    () => svc.triggerFlow({ url: "https://attacker.example/collect?sig=x", timeoutMs: 5000 }),
    (err: unknown) => err instanceof Ms365Error,
  );
  assert.equal(calls.length, 0, "an off-allowlist host must never be dialed (no exfil)");
});

test("triggerFlow enforces the socket-IP pin (F2): a non-validated dialed IP is refused", async () => {
  // SSRF validated 20.1.2.3, but the socket claims it reached 9.9.9.9 (rebinding) → refuse.
  const { dialer } = fakeDialer({ status: 200, dialedIp: "9.9.9.9" });
  const svc = createPowerAutomateService({ store: await storeWith([]), ssrf: fakeSsrf("20.1.2.3"), dialer });

  await assert.rejects(
    () => svc.triggerFlow({ url: FLOW_URL, timeoutMs: 5000 }),
    (err: unknown) => err instanceof Ms365Error,
  );
});

test("triggerFlow propagates an SSRF refusal (private/metadata target) WITHOUT dialing", async () => {
  const { dialer, calls } = fakeDialer({ status: 200, dialedIp: "10.0.0.1" });
  const svc = createPowerAutomateService({ store: await storeWith([]), ssrf: fakeSsrf(null), dialer });

  await assert.rejects(() => svc.triggerFlow({ url: FLOW_URL, timeoutMs: 5000 }), SsrfBlockedError);
  assert.equal(calls.length, 0);
});

test("triggerFlow throws graph_error on a non-2xx, folding the flow's body into the message", async () => {
  const { dialer } = fakeDialer({ status: 500, dialedIp: "20.1.2.3", body: "flow failed" });
  const svc = createPowerAutomateService({ store: await storeWith([]), ssrf: fakeSsrf("20.1.2.3"), dialer });

  await assert.rejects(
    () => svc.triggerFlow({ url: FLOW_URL, timeoutMs: 5000 }),
    (err: unknown) =>
      err instanceof Ms365Error && err.kind === "graph_error" && err.message.includes("500") && err.message.includes("flow failed"),
  );
});

test("triggerFlow 401 error surfaces the body and SAS/auth guidance", async () => {
  const { dialer } = fakeDialer({ status: 401, dialedIp: "20.1.2.3", body: "Unauthorized: bad sig" });
  const svc = createPowerAutomateService({ store: await storeWith([]), ssrf: fakeSsrf("20.1.2.3"), dialer });

  await assert.rejects(
    () => svc.triggerFlow({ url: FLOW_URL, timeoutMs: 5000 }),
    (err: unknown) =>
      err instanceof Ms365Error &&
      err.kind === "graph_error" &&
      err.message.includes("401") &&
      err.message.includes("Unauthorized: bad sig") &&
      err.recovery.includes("401"),
  );
});

test("triggerFlow error body snippet is bounded to MAX_ERROR_BODY_CHARS", async () => {
  const { dialer } = fakeDialer({ status: 500, dialedIp: "20.1.2.3", body: "E".repeat(5000) });
  const svc = createPowerAutomateService({ store: await storeWith([]), ssrf: fakeSsrf("20.1.2.3"), dialer });

  await assert.rejects(
    () => svc.triggerFlow({ url: FLOW_URL, timeoutMs: 5000 }),
    (err: unknown) => err instanceof Ms365Error && err.message.length < 700, // "Flow trả lỗi HTTP 500: " + ≤500 chars
  );
});

test("triggerFlow maps a per-flow timeout to an Ms365Error timeout", async () => {
  const { dialer } = fakeDialer({ timeout: true, dialedIp: "20.1.2.3" });
  const svc = createPowerAutomateService({ store: await storeWith([]), ssrf: fakeSsrf("20.1.2.3"), dialer });

  await assert.rejects(
    () => svc.triggerFlow({ url: FLOW_URL, timeoutMs: 20 }),
    (err: unknown) => err instanceof Ms365Error && err.kind === "timeout",
  );
});

test("listFlows returns only enabled flows", async () => {
  const store = await storeWith([
    { name: "on", url: "https://x/1?sig=a", enabled: true, timeoutMs: 5000, description: "", payloadSchema: "" },
    { name: "off", url: "https://x/2?sig=b", enabled: false, timeoutMs: 5000, description: "", payloadSchema: "" },
  ]);
  const svc = createPowerAutomateService({ store, ssrf: allowAll });
  assert.deepEqual(svc.listFlows(), [{ name: "on", description: "", payloadSchema: "" }]);
});

test("listFlows returns name + description for enabled flows only", async () => {
  const store = await storeWith([
    { name: "on", url: "https://x/1?sig=a", enabled: true, timeoutMs: 5000, description: "does X", payloadSchema: "" },
    { name: "off", url: "https://x/2?sig=b", enabled: false, timeoutMs: 5000, description: "hidden", payloadSchema: "" },
  ]);
  const svc = createPowerAutomateService({ store, ssrf: allowAll });
  assert.deepEqual(svc.listFlows(), [{ name: "on", description: "does X", payloadSchema: "" }]);
});

test("listFlows returns payloadSchema", async () => {
  const store = await storeWith([{ name: "on", url: "https://x/1?sig=a", enabled: true, timeoutMs: 5000, description: "d", payloadSchema: '{"type":"object"}' }]);
  const svc = createPowerAutomateService({ store, ssrf: allowAll });
  assert.deepEqual(svc.listFlows(), [{ name: "on", description: "d", payloadSchema: '{"type":"object"}' }]);
});

test("resolveFlow returns url/timeout/enabled or null", async () => {
  const store = await storeWith([{ name: "on", url: "https://x/1?sig=a", enabled: false, timeoutMs: 7000, description: "", payloadSchema: "" }]);
  const svc = createPowerAutomateService({ store, ssrf: allowAll });
  assert.deepEqual(svc.resolveFlow("on"), { url: "https://x/1?sig=a", timeoutMs: 7000, enabled: false });
  assert.equal(svc.resolveFlow("missing"), null);
});
