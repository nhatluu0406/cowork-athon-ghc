import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMsConnect, type Ms365ConnectClient } from "../src/ui-shell/microsoft/ms-connect-view.js";
import type { Ms365ViewData, Ms365FlowView } from "../src/service-client.js";

function baseClient(over: Partial<Ms365ConnectClient> = {}): Ms365ConnectClient {
  return {
    connectMs365Token: async () =>
      ({ connectionState: "connected", services: [], scopes: [], actionHistory: [] }) as Ms365ViewData,
    beginMs365Device: async () =>
      ({ userCode: "ABCD", verificationUri: "https://microsoft.com/devicelogin", expiresInSec: 900 }) as never,
    pollMs365Device: async () => ({ status: "pending" }) as never,
    fetchMs365View: async () =>
      ({ connectionState: "disconnected", services: [], scopes: [], actionHistory: [] }) as Ms365ViewData,
    disconnectMs365: async () =>
      ({ connectionState: "disconnected", services: [], scopes: [], actionHistory: [] }) as Ms365ViewData,
    listMs365Sites: async () => [],
    setMs365SiteEnabled: async () => [],
    listMs365Flows: async () => [] as readonly Ms365FlowView[],
    addMs365Flow: async () => [] as readonly Ms365FlowView[],
    updateMs365Flow: async () => [] as readonly Ms365FlowView[],
    deleteMs365Flow: async () => [] as readonly Ms365FlowView[],
    setMs365FlowEnabled: async () => [] as readonly Ms365FlowView[],
    setMs365FlowTimeout: async () => [] as readonly Ms365FlowView[],
    ...over,
  };
}

const connectedView: Ms365ViewData = {
  connectionState: "connected",
  services: [{ id: "sharepoint", label: "SharePoint", connected: true }],
  scopes: ["Sites.Read.All"],
  actionHistory: [],
};

test("renders flows read-only with name + description", async () => {
  const container = document.createElement("div");
  const client = baseClient({
    listMs365Flows: async () => [{ name: "f1", enabled: true, timeoutMs: 5000, description: "does X", payloadSchema: "" }],
  });
  renderMsConnect(container, { view: connectedView, client, onViewChange: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(container.textContent ?? "", /f1/);
  assert.match(container.textContent ?? "", /does X/);
});

test("Thêm flow → dialog → addMs365Flow with description, payloadSchema, seconds→ms", async () => {
  const container = document.createElement("div");
  const added: unknown[] = [];
  const client = baseClient({
    listMs365Flows: async () => [],
    addMs365Flow: async (name: string, url: string, description: string, payloadSchema: string, timeoutMs?: number) => {
      added.push({ name, url, description, payloadSchema, timeoutMs });
      return [] as never;
    },
  });
  renderMsConnect(container, { view: connectedView, client, onViewChange: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  (container.querySelector(".ms-flows__add-btn") as HTMLButtonElement).click();
  (container.querySelector(".ms-flow-dialog__name") as HTMLInputElement).value = "f2";
  (container.querySelector(".ms-flow-dialog__url") as HTMLInputElement).value = "https://x/2?sig=b";
  (container.querySelector(".ms-flow-dialog__desc") as HTMLTextAreaElement).value = "send mail";
  (container.querySelector(".ms-flow-dialog__schema") as HTMLTextAreaElement).value = '{"type":"object"}';
  (container.querySelector(".ms-flow-dialog__timeout") as HTMLInputElement).value = "30";
  (container.querySelector(".ms-flow-dialog__save") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(added, [{ name: "f2", url: "https://x/2?sig=b", description: "send mail", payloadSchema: '{"type":"object"}', timeoutMs: 30_000 }]);
});

test("Sửa → dialog prefilled (name locked, schema prefilled) → updateMs365Flow", async () => {
  const container = document.createElement("div");
  const updated: unknown[] = [];
  const client = baseClient({
    listMs365Flows: async () => [{ name: "f1", enabled: true, timeoutMs: 5000, description: "old", payloadSchema: '{"a":1}' }],
    updateMs365Flow: async (name: string, fields: unknown) => {
      updated.push({ name, fields });
      return [] as never;
    },
  });
  renderMsConnect(container, { view: connectedView, client, onViewChange: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  (container.querySelector(".ms-flows__edit") as HTMLButtonElement).click();
  assert.equal((container.querySelector(".ms-flow-dialog__name") as HTMLInputElement).readOnly, true);
  assert.equal((container.querySelector(".ms-flow-dialog__schema") as HTMLTextAreaElement).value, '{"a":1}');
  (container.querySelector(".ms-flow-dialog__desc") as HTMLTextAreaElement).value = "new";
  (container.querySelector(".ms-flow-dialog__save") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(updated, [{ name: "f1", fields: { description: "new", timeoutMs: 5000, payloadSchema: '{"a":1}', url: "" } }]);
});

test("Xóa → deleteMs365Flow immediately; no url in DOM", async () => {
  const container = document.createElement("div");
  const deleted: string[] = [];
  const client = baseClient({
    listMs365Flows: async () => [{ name: "f1", enabled: true, timeoutMs: 5000, description: "d", payloadSchema: "" }],
    deleteMs365Flow: async (name: string) => {
      deleted.push(name);
      return [] as never;
    },
  });
  renderMsConnect(container, { view: connectedView, client, onViewChange: () => {} });
  await new Promise((r) => setTimeout(r, 0));
  (container.querySelector(".ms-flows__delete") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(deleted, ["f1"]);
  assert.doesNotMatch(container.innerHTML, /:\/\//);
});
