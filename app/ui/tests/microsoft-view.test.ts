import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ms365ViewData } from "../src/service-client.js";
import { createMicrosoftView, renderMicrosoftSurface, type MicrosoftSurfaceDeps } from "../src/ui-shell/microsoft/microsoft-view.js";
import type { Ms365ConnectClient } from "../src/ui-shell/microsoft/ms-connect-view.js";
import { createMsChatController } from "../src/ui-shell/microsoft/ms-chat-controller.js";

const DISCONNECTED: Ms365ViewData = {
  connectionState: "disconnected",
  services: [],
  scopes: [],
  actionHistory: [],
};

function fakeDeps(): MicrosoftSurfaceDeps {
  const client: Ms365ConnectClient = {
    connectMs365Token: async () => DISCONNECTED,
    fetchMs365View: async () => DISCONNECTED,
    beginMs365Device: async () => ({ error: "not_configured" }),
    pollMs365Device: async () => ({ status: "pending" }),
  };
  const chat = createMsChatController({
    preflight: () => ({ canSend: true, message: "" }),
    workspaceId: () => "ws-1",
    createSession: async () => ({ id: "sess-1" }),
    setSessionScope: async () => {},
    sendMessage: async () => ({ accepted: true }),
    cancelSession: async () => {},
    startStream: () => ({ stop: () => {} }),
    buildDispatch: (_prior, prompt) => ({ ok: true, text: prompt }),
    onStateChange: () => {},
  });
  return { client, onViewChange: () => {}, chat, onSend: () => {}, onCancel: () => {} };
}

test("assistant tab shows honest not-connected card and disabled composer", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED, fakeDeps());
  assert.equal(dom.msTab, "assistant");
  assert.match(dom.body.textContent ?? "", /Chưa kết nối Microsoft 365/);
  const composerInput = dom.body.querySelector<HTMLTextAreaElement>(".ms-composer__input");
  assert.equal(composerInput?.disabled, true);
  const send = dom.body.querySelector<HTMLButtonElement>(".ms-composer__send");
  assert.equal(send?.disabled, true);
});

test("connect tab shows enabled sign-in and requested scopes", () => {
  const dom = createMicrosoftView();
  const view: Ms365ViewData = { ...DISCONNECTED, scopes: ["Files.ReadWrite.All", "Tasks.ReadWrite"] };
  renderMicrosoftSurface(dom, view, fakeDeps());
  dom.tabConnect.click();
  assert.equal(dom.msTab, "connect");
  const signIn = dom.body.querySelector<HTMLButtonElement>(".ms-connect__signin");
  assert.equal(signIn?.disabled, false);
  assert.match(dom.body.textContent ?? "", /Files\.ReadWrite\.All/);
});

test("no fabricated account or service data is rendered when disconnected", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED, fakeDeps());
  dom.tabConnect.click();
  assert.doesNotMatch(dom.body.textContent ?? "", /Đã kết nối/);
  assert.equal(dom.body.querySelectorAll(".ms-service-card").length, 0);
});

test("'Mở trang kết nối' switches to connect tab", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED, fakeDeps());
  const cta = dom.body.querySelector<HTMLButtonElement>(".ms-assistant__connect-cta");
  cta?.click();
  assert.equal(dom.msTab, "connect");
});
