import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMsAssistant } from "../src/ui-shell/microsoft/ms-assistant-view.js";
import type { MicrosoftIntegrationView } from "../src/integration-slots.js";

const CONNECTED = { connectionState: "connected" } as unknown as MicrosoftIntegrationView;
const noopHandlers = {
  onOpenConnect: () => {},
  onSend: () => {},
  onSelectConversation: () => {},
  onNewConversation: () => {},
};

test("renderMsAssistant returns composer refs when connected", () => {
  const container = document.createElement("div");
  const result = renderMsAssistant(container, CONNECTED, noopHandlers, [], null);
  assert.ok(result.composer !== null, "connected → composer refs present");
  assert.ok(result.composer!.send instanceof HTMLButtonElement);
  assert.ok(result.composer!.input instanceof HTMLTextAreaElement);
  assert.ok(Array.isArray(result.composer!.chips));
});

test("composer refs are individually disable-able (toggle target for running-gate)", () => {
  const container = document.createElement("div");
  const { composer } = renderMsAssistant(container, CONNECTED, noopHandlers, [], null);
  assert.ok(composer !== null);
  assert.equal(composer!.send.disabled, false);
  composer!.send.disabled = true;
  composer!.input.disabled = true;
  for (const chip of composer!.chips) chip.disabled = true;
  assert.equal(composer!.send.disabled, true);
  assert.equal(composer!.input.disabled, true);
  assert.ok(composer!.chips.every((c) => c.disabled));
});

test("sidebar marks the active conversation item", () => {
  const container = document.createElement("div");
  const convs = [
    { id: "c1", title: "One" },
    { id: "c2", title: "Two" },
  ];
  renderMsAssistant(container, CONNECTED, noopHandlers, convs, "c2");
  const active = container.querySelectorAll(".ms-history__item-btn--active");
  assert.equal(active.length, 1, "exactly one active item");
  assert.equal((active[0] as HTMLElement).textContent, "Two");
});

test("sidebar marks nothing active when activeId is null", () => {
  const container = document.createElement("div");
  const convs = [{ id: "c1", title: "One" }];
  renderMsAssistant(container, CONNECTED, noopHandlers, convs, null);
  assert.equal(container.querySelectorAll(".ms-history__item-btn--active").length, 0);
});
