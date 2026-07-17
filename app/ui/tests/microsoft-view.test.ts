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

const NO_HANDLERS = {
  onSend: () => {},
  onConnect: () => {},
  onDisconnect: () => {},
  onSelectConversation: () => {},
  onNewConversation: () => {},
};

const CONNECTED: MicrosoftIntegrationView = {
  connectionState: "connected",
  services: [],
  scopes: [],
  actionHistory: [],
};

test("assistant tab shows honest not-connected card and disabled composer", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED, NO_HANDLERS);
  assert.equal(dom.msTab, "assistant");
  assert.match(dom.body.textContent ?? "", /Chưa kết nối Microsoft 365/);
  const composerInput = dom.body.querySelector<HTMLTextAreaElement>(".ms-composer__input");
  assert.equal(composerInput?.disabled, true);
  const send = dom.body.querySelector<HTMLButtonElement>(".ms-composer__send");
  assert.equal(send?.disabled, true);
});

test("connect tab shows a token form disabled until typed, and requested scopes", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED, NO_HANDLERS);
  dom.tabConnect.click();
  assert.equal(dom.msTab, "connect");
  const signIn = dom.body.querySelector<HTMLButtonElement>(".ms-connect__signin");
  assert.equal(signIn?.disabled, true);
  assert.ok(dom.body.querySelector(".ms-connect__token-input"));
  assert.match(dom.body.textContent ?? "", /Mail\.Send/);
});

test("no fabricated account or service data is rendered when disconnected", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED, NO_HANDLERS);
  dom.tabConnect.click();
  assert.doesNotMatch(dom.body.textContent ?? "", /Đã kết nối/);
  assert.equal(dom.body.querySelectorAll(".ms-service-card").length, 0);
});

test("'Mở trang kết nối' switches to connect tab", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED, NO_HANDLERS);
  const cta = dom.body.querySelector<HTMLButtonElement>(".ms-assistant__connect-cta");
  cta?.click();
  assert.equal(dom.msTab, "connect");
});

test("connected: renders sidebar with conversation list + new button, and fires handlers", () => {
  const dom = createMicrosoftView();
  const selected: string[] = [];
  let newClicked = false;
  const handlers = {
    ...NO_HANDLERS,
    onSelectConversation: (id: string) => selected.push(id),
    onNewConversation: () => { newClicked = true; },
  };
  renderMicrosoftSurface(dom, CONNECTED, handlers, [
    { id: "conv-1", title: "Task trễ trên Planner" },
    { id: "conv-2", title: "Mail chưa đọc" },
  ]);
  const sidebar = dom.body.querySelector(".ms-history");
  assert.ok(sidebar);
  const items = dom.body.querySelectorAll(".ms-history__item-btn");
  assert.equal(items.length, 2);
  assert.equal(items[0]?.textContent, "Task trễ trên Planner");

  (items[1] as HTMLButtonElement).click();
  assert.deepEqual(selected, ["conv-2"]);

  const newBtn = dom.body.querySelector<HTMLButtonElement>(".ms-history__new");
  assert.ok(newBtn);
  assert.equal(newBtn?.textContent, "Cuộc trò chuyện mới");
  newBtn?.click();
  assert.equal(newClicked, true);
});

test("disconnected: no sidebar is rendered", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, DISCONNECTED, NO_HANDLERS, [{ id: "conv-1", title: "x" }]);
  assert.equal(dom.body.querySelector(".ms-history"), null);
});

test("switching tabs and back preserves the conversation list", () => {
  const dom = createMicrosoftView();
  renderMicrosoftSurface(dom, CONNECTED, NO_HANDLERS, [{ id: "conv-1", title: "Task trễ trên Planner" }]);
  dom.tabConnect.click();
  dom.tabAssistant.click();
  const items = dom.body.querySelectorAll(".ms-history__item-btn");
  assert.equal(items.length, 1);
  assert.equal(items[0]?.textContent, "Task trễ trên Planner");
});
