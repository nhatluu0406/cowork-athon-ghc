import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MicrosoftIntegrationView } from "../src/integration-slots.js";
import { createMicrosoftView, renderMicrosoftSurface } from "../src/ui-shell/microsoft/microsoft-view.js";

const DISCONNECTED: MicrosoftIntegrationView = {
  connectionState: "disconnected",
  services: [],
  scopes: [],
  actionHistory: [],
};

test("assistant tab shows honest not-connected card and disabled composer", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED);
  assert.equal(dom.msTab, "assistant");
  assert.match(dom.body.textContent ?? "", /Chưa kết nối Microsoft 365/);
  const composerInput = dom.body.querySelector<HTMLTextAreaElement>(".ms-composer__input");
  assert.equal(composerInput?.disabled, true);
  const send = dom.body.querySelector<HTMLButtonElement>(".ms-composer__send");
  assert.equal(send?.disabled, true);
});

test("connect tab shows disabled sign-in with D2 note and requested scopes", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED);
  dom.tabConnect.click();
  assert.equal(dom.msTab, "connect");
  const signIn = dom.body.querySelector<HTMLButtonElement>(".ms-connect__signin");
  assert.equal(signIn?.disabled, true);
  assert.match(dom.body.textContent ?? "", /Backend D2 \(Microsoft Graph\) chưa được tích hợp/);
  assert.match(dom.body.textContent ?? "", /Mail\.Send/);
});

test("no fabricated account or service data is rendered when disconnected", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED);
  dom.tabConnect.click();
  assert.doesNotMatch(dom.body.textContent ?? "", /Đã kết nối/);
  assert.equal(dom.body.querySelectorAll(".ms-service-card").length, 0);
});

test("'Mở trang kết nối' switches to connect tab", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED);
  const cta = dom.body.querySelector<HTMLButtonElement>(".ms-assistant__connect-cta");
  cta?.click();
  assert.equal(dom.msTab, "connect");
});
