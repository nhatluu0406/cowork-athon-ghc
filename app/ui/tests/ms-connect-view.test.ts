import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMsConnect } from "../src/ui-shell/microsoft/ms-connect-view.js";
import type { MicrosoftIntegrationView } from "../src/integration-slots.js";

const DISCONNECTED: MicrosoftIntegrationView = {
  connectionState: "disconnected", services: [], scopes: [], actionHistory: [],
};
const CONNECTED: MicrosoftIntegrationView = {
  connectionState: "connected", services: [], scopes: ["User.Read"], actionHistory: [],
};

test("disconnected: Connect is disabled until a token is entered, then fires onConnect + clears input", () => {
  const container = document.createElement("div");
  let connectedWith: string | null = null;
  renderMsConnect(container, DISCONNECTED, { onConnect: (t) => { connectedWith = t; }, onDisconnect: () => {} });
  const input = container.querySelector("input") as HTMLInputElement;
  const connectBtn = container.querySelector("button") as HTMLButtonElement;
  assert.ok(input, "token input present");
  assert.equal(connectBtn.disabled, true, "Connect disabled when empty");
  input.value = "eyJ.fake";
  input.dispatchEvent(new Event("input"));
  assert.equal(connectBtn.disabled, false, "Connect enabled after typing");
  connectBtn.click();
  assert.equal(connectedWith, "eyJ.fake", "onConnect got the token");
  assert.equal(input.value, "", "token input cleared after connect");
});

test("connected: shows a Disconnect button that fires onDisconnect", () => {
  const container = document.createElement("div");
  let disconnected = false;
  renderMsConnect(container, CONNECTED, { onConnect: () => {}, onDisconnect: () => { disconnected = true; } });
  const btns = Array.from(container.querySelectorAll("button")) as HTMLButtonElement[];
  const disconnectBtn = btns.find((b) => /ngắt/i.test(b.textContent ?? ""));
  assert.ok(disconnectBtn, "Disconnect button present when connected");
  disconnectBtn!.click();
  assert.equal(disconnected, true);
});

test("error: renders view.error text", () => {
  const container = document.createElement("div");
  renderMsConnect(container, { ...DISCONNECTED, connectionState: "error", error: "Token không hợp lệ" }, { onConnect: () => {}, onDisconnect: () => {} });
  assert.match(container.textContent ?? "", /Token không hợp lệ/);
});
