/**
 * Power Automate flow-trigger hardening (PR #11 security re-review, findings A + C):
 *  - the fetch is IP-PINNED to an SSRF-validated address via the injected dialer (rebinding guard),
 *  - the socket's actual IP is asserted against the validated set (F2),
 *  - the URL host must be in the Logic Apps allowlist (no arbitrary-host exfil),
 *  - a non-2xx flow response and an SSRF refusal both surface as bounded Ms365Errors.
 * No real network: both the SSRF policy and the dialer are fakes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createPowerAutomateService } from "../src/ms365/power-automate-service.js";
import type { PowerAutomateStore } from "../src/ms365/power-automate-store.js";
import { Ms365Error } from "../src/ms365/ms365-errors.js";
import { SsrfBlockedError, type ConnectTarget, type SsrfPolicy } from "../src/provider/index.js";
import type { HttpDialer, HttpProbeRequest, HttpProbeResponse } from "../src/provider/http-dialer.js";

const emptyStore: PowerAutomateStore = { list: () => [], setFlows: async () => {} };

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

/** A recording fake dialer that returns a fixed status and the IP it claims to have dialed. */
function fakeDialer(opts: { status: number; dialedIp: string }): {
  dialer: HttpDialer;
  calls: HttpProbeRequest[];
} {
  const calls: HttpProbeRequest[] = [];
  const dialer: HttpDialer = async (req): Promise<HttpProbeResponse> => {
    calls.push(req);
    return { status: opts.status, headers: {}, dialedIp: opts.dialedIp };
  };
  return { dialer, calls };
}

const FLOW_URL =
  "https://prod-12.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=SECRET";

test("triggerFlow dials the SSRF-validated IP (pinned) and returns the flow status", async () => {
  const { dialer, calls } = fakeDialer({ status: 202, dialedIp: "20.1.2.3" });
  const svc = createPowerAutomateService({ store: emptyStore, ssrf: fakeSsrf("20.1.2.3"), dialer });

  const res = await svc.triggerFlow({ url: FLOW_URL, payload: { hello: "world" } });

  assert.equal(res.status, 202);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.ip, "20.1.2.3"); // pinned to the validated address, not re-resolved
  assert.equal(calls[0]?.method, "POST");
  assert.equal(calls[0]?.url.hostname, "prod-12.westus.logic.azure.com");
});

test("triggerFlow refuses a host outside the Logic Apps allowlist WITHOUT dialing", async () => {
  const { dialer, calls } = fakeDialer({ status: 200, dialedIp: "20.1.2.3" });
  const svc = createPowerAutomateService({ store: emptyStore, ssrf: fakeSsrf("20.1.2.3"), dialer });

  await assert.rejects(
    () => svc.triggerFlow({ url: "https://attacker.example/collect?sig=x" }),
    (err: unknown) => err instanceof Ms365Error,
  );
  assert.equal(calls.length, 0, "an off-allowlist host must never be dialed (no exfil)");
});

test("triggerFlow enforces the socket-IP pin (F2): a non-validated dialed IP is refused", async () => {
  // SSRF validated 20.1.2.3, but the socket claims it reached 9.9.9.9 (rebinding) → refuse.
  const { dialer } = fakeDialer({ status: 200, dialedIp: "9.9.9.9" });
  const svc = createPowerAutomateService({ store: emptyStore, ssrf: fakeSsrf("20.1.2.3"), dialer });

  await assert.rejects(
    () => svc.triggerFlow({ url: FLOW_URL }),
    (err: unknown) => err instanceof Ms365Error,
  );
});

test("triggerFlow propagates an SSRF refusal (private/metadata target)", async () => {
  const { dialer, calls } = fakeDialer({ status: 200, dialedIp: "10.0.0.1" });
  const svc = createPowerAutomateService({ store: emptyStore, ssrf: fakeSsrf(null), dialer });

  await assert.rejects(() => svc.triggerFlow({ url: FLOW_URL }), SsrfBlockedError);
  assert.equal(calls.length, 0);
});

test("triggerFlow maps a non-2xx flow response to a bounded Ms365Error", async () => {
  const { dialer } = fakeDialer({ status: 500, dialedIp: "20.1.2.3" });
  const svc = createPowerAutomateService({ store: emptyStore, ssrf: fakeSsrf("20.1.2.3"), dialer });

  await assert.rejects(
    () => svc.triggerFlow({ url: FLOW_URL }),
    (err: unknown) => err instanceof Ms365Error,
  );
});
