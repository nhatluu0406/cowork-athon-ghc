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
    disconnectMs365: async () => DISCONNECTED,
    listMs365Sites: async () => [],
    setMs365SiteEnabled: async () => [],
    listMs365Flows: async () => [],
    addMs365Flow: async () => [],
    updateMs365Flow: async () => [],
    deleteMs365Flow: async () => [],
    setMs365FlowEnabled: async () => [],
    setMs365FlowTimeout: async () => [],
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
  return {
    client,
    onViewChange: () => {},
    chat,
    onSend: () => {},
    onCancel: () => {},
    conversations: [],
    activeConversationId: null,
    onSelectConversation: () => {},
    onNewConversation: () => {},
    onSearchConversations: () => {},
  };
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

test("connect tab shows enabled sign-in and no requested-scope list", () => {
  const dom = createMicrosoftView();
  const view: Ms365ViewData = { ...DISCONNECTED, scopes: ["Files.ReadWrite.All", "Tasks.ReadWrite"] };
  renderMicrosoftSurface(dom, view, fakeDeps());
  dom.tabConnect.click();
  assert.equal(dom.msTab, "connect");
  const signIn = dom.body.querySelector<HTMLButtonElement>(".ms-connect__signin");
  assert.equal(signIn?.disabled, false);
  assert.equal(dom.body.querySelector(".ms-scope-list"), null);
});

test("connecting from the connect tab jumps to the assistant with an enabled composer", () => {
  const dom = createMicrosoftView();
  const deps = fakeDeps();
  // User is sitting on the connect tab, still disconnected.
  renderMicrosoftSurface(dom, DISCONNECTED, deps);
  dom.tabConnect.click();
  assert.equal(dom.msTab, "connect");
  // A successful connect pushes a "connected" view (rising edge).
  const connected: Ms365ViewData = { ...DISCONNECTED, connectionState: "connected" };
  renderMicrosoftSurface(dom, connected, deps);
  assert.equal(dom.msTab, "assistant", "must land on the chat after connecting");
  const composerInput = dom.body.querySelector<HTMLTextAreaElement>(".ms-composer__input");
  assert.equal(composerInput?.disabled, false, "composer enabled once connected");
});

test("switching back to connect while already connected stays on connect", () => {
  const dom = createMicrosoftView();
  const deps = fakeDeps();
  const connected: Ms365ViewData = { ...DISCONNECTED, connectionState: "connected" };
  renderMicrosoftSurface(dom, connected, deps);
  dom.tabConnect.click();
  assert.equal(dom.msTab, "connect");
  // A re-render with the same connected state must NOT yank the user back to assistant.
  renderMicrosoftSurface(dom, connected, deps);
  assert.equal(dom.msTab, "connect");
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
