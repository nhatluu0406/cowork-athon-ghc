import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRemotePairing, type RemotePairingClient } from "../src/remote-pairing-view.js";
import { renderIntegrationSurface, type IntegrationSurfaceClient } from "../src/ui-shell/integration-view.js";
import { PRODUCT_SURFACES } from "../src/surface-registry.js";

const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>';

function client(over: Partial<IntegrationSurfaceClient> = {}): IntegrationSurfaceClient {
  return {
    remoteStatus: async () => ({
      enabled: true,
      url: "http://127.0.0.1:7777",
      lanUrls: ["http://192.168.1.5:7777"],
      devices: [],
    }),
    remoteIssuePairingCode: async () => ({
      code: "ABCD2345",
      expiresAtMs: Date.now() + 120_000,
      qrSvg: QR_SVG,
      pairingUrl: "http://192.168.1.5:7777/?code=ABCD2345",
    }),
    remoteRevokeAll: async () => undefined,
    listDispatchTasks: async () => [],
    runDispatchTask: async () => {
      throw new Error("unused");
    },
    listDispatchRuns: async () => [],
    cancelDispatchRun: async () => undefined,
    ...over,
  } as IntegrationSurfaceClient;
}

const dispatchSurface = PRODUCT_SURFACES.find((s) => s.id === "dispatch")!;
const gatewaySurface = PRODUCT_SURFACES.find((s) => s.id === "gateway")!;

test("a remote gateway that is off is reported honestly, not as a pairing screen", async () => {
  const body = document.createElement("div");
  await renderRemotePairing(
    client({ remoteStatus: async () => ({ enabled: false, url: null, lanUrls: [], devices: [] }) }),
    body,
  );
  assert.match(body.textContent ?? "", /chưa chạy/i);
  assert.equal(body.querySelector("button"), null, "must not offer pairing when the gateway is off");
});

test("an unreachable service does not render a broken pairing screen", async () => {
  const body = document.createElement("div");
  await renderRemotePairing(
    client({
      remoteStatus: async () => {
        throw new Error("connection refused");
      },
    }),
    body,
  );
  assert.match(body.textContent ?? "", /CGHC_REMOTE_ENABLED/);
});

test("issuing a code renders the code and adopts the QR svg", async () => {
  const body = document.createElement("div");
  await renderRemotePairing(client(), body);
  const button = body.querySelector("button");
  assert.ok(button, "pairing button must exist when the gateway is on");

  button.click();
  await new Promise((r) => setTimeout(r, 0));

  assert.match(body.textContent ?? "", /ABCD2345/);
  assert.ok(body.querySelector(".remote-qr svg"), "the QR svg must be adopted into the DOM");
});

test("a qr payload carrying script is refused, and pairing still reports the code", async () => {
  const body = document.createElement("div");
  await renderRemotePairing(
    client({
      remoteIssuePairingCode: async () => ({
        code: "ABCD2345",
        expiresAtMs: Date.now() + 120_000,
        qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"><script>globalThis.__pwned = true;</script></svg>',
        pairingUrl: null,
      }),
    }),
    body,
  );
  body.querySelector("button")!.click();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(body.querySelector("script"), null, "script must never reach the DOM");
  assert.equal(body.querySelector(".remote-qr svg"), null);
  // The code is still usable by hand — refusing the QR must not break pairing.
  assert.match(body.textContent ?? "", /ABCD2345/);
  assert.match(body.textContent ?? "", /không dựng được QR/);
});

test("the Dispatch surface renders real phone pairing + the local dispatch board", () => {
  const container = document.createElement("div");
  renderIntegrationSurface(container, dispatchSurface, client());

  // D1 is INTEGRATED (ADR 0011): the Dispatch surface shows its REAL content — phone pairing
  // plus the local dispatch board — not the "Chờ tích hợp D1" awaiting-integration placeholder
  // that only fits the genuinely-empty surfaces. Honesty is preserved by the board/pairing
  // rendering their own empty/loading states, not by faking a D1 backend that has not landed.
  assert.doesNotMatch(container.textContent ?? "", /Chờ tích hợp D1/);
  assert.ok(container.querySelector(".integration-remote"), "dispatch must render the pairing section");
  assert.ok(container.querySelector(".integration-dispatch"), "dispatch must render the board section");
});

test("other awaiting-integration surfaces do not grow a pairing section", () => {
  const container = document.createElement("div");
  renderIntegrationSurface(container, gatewaySurface, client());
  assert.equal(container.querySelector(".integration-remote"), null);
});

test("dispatch without a connected client renders no pairing section", () => {
  const container = document.createElement("div");
  renderIntegrationSurface(container, dispatchSurface, null);
  assert.equal(container.querySelector(".integration-remote"), null);
  assert.equal(container.querySelector(".integration-dispatch"), null);
  assert.match(container.textContent ?? "", /Chờ tích hợp D1/);
});
