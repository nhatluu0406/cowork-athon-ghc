import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openFlowDialog } from "../src/ui-shell/microsoft/ms-flow-dialog.js";

test("add submits values incl. payloadSchema; timeout in seconds", async () => {
  const container = document.createElement("div");
  const out: unknown[] = [];
  openFlowDialog(container, { mode: "add", onSubmit: async (v) => { out.push(v); } });
  (container.querySelector(".ms-flow-dialog__name") as HTMLInputElement).value = "f1";
  (container.querySelector(".ms-flow-dialog__url") as HTMLInputElement).value = "https://x/1?sig=a";
  (container.querySelector(".ms-flow-dialog__desc") as HTMLTextAreaElement).value = "send mail";
  (container.querySelector(".ms-flow-dialog__schema") as HTMLTextAreaElement).value = '{"type":"object"}';
  (container.querySelector(".ms-flow-dialog__timeout") as HTMLInputElement).value = "30";
  (container.querySelector(".ms-flow-dialog__save") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(out, [{ name: "f1", url: "https://x/1?sig=a", description: "send mail", payloadSchema: '{"type":"object"}', timeoutSec: 30 }]);
});

test("invalid schema JSON blocks submit with inline error", async () => {
  const container = document.createElement("div");
  let called = false;
  openFlowDialog(container, { mode: "add", onSubmit: async () => { called = true; } });
  (container.querySelector(".ms-flow-dialog__name") as HTMLInputElement).value = "f1";
  (container.querySelector(".ms-flow-dialog__url") as HTMLInputElement).value = "https://x/1?sig=a";
  (container.querySelector(".ms-flow-dialog__schema") as HTMLTextAreaElement).value = "{not json";
  (container.querySelector(".ms-flow-dialog__save") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(called, false);
  assert.equal((container.querySelector(".ms-flow-dialog__error") as HTMLElement).hidden, false);
  (container.querySelector(".ms-flow-dialog__cancel") as HTMLButtonElement).click();
});

test("edit locks name, blank URL, prefills desc + schema", async () => {
  const container = document.createElement("div");
  openFlowDialog(container, { mode: "edit", initial: { name: "f1", description: "old", payloadSchema: '{"a":1}', timeoutSec: 120 }, onSubmit: async () => {} });
  assert.equal((container.querySelector(".ms-flow-dialog__name") as HTMLInputElement).readOnly, true);
  assert.equal((container.querySelector(".ms-flow-dialog__url") as HTMLInputElement).value, "");
  assert.equal((container.querySelector(".ms-flow-dialog__desc") as HTMLTextAreaElement).value, "old");
  assert.equal((container.querySelector(".ms-flow-dialog__schema") as HTMLTextAreaElement).value, '{"a":1}');
  (container.querySelector(".ms-flow-dialog__cancel") as HTMLButtonElement).click();
});

test("Escape closes", async () => {
  const container = document.createElement("div");
  openFlowDialog(container, { mode: "add", onSubmit: async () => {} });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(container.querySelector(".ms-flow-dialog"), null);
});

test("live schema validation shows an inline error while typing invalid JSON, clears when valid", async () => {
  const container = document.createElement("div");
  openFlowDialog(container, { mode: "add", onSubmit: async () => {} });
  const schema = container.querySelector(".ms-flow-dialog__schema") as HTMLTextAreaElement;
  const schemaError = container.querySelector(".ms-flow-dialog__schema-error") as HTMLElement;
  assert.equal(schemaError.hidden, true);
  schema.value = "{not json";
  schema.dispatchEvent(new Event("input"));
  assert.equal(schemaError.hidden, false);
  schema.value = '{"type":"object"}';
  schema.dispatchEvent(new Event("input"));
  assert.equal(schemaError.hidden, true);
  schema.value = "";
  schema.dispatchEvent(new Event("input"));
  assert.equal(schemaError.hidden, true);
  (container.querySelector(".ms-flow-dialog__cancel") as HTMLButtonElement).click();
});

test("clicking the backdrop does NOT close the dialog", async () => {
  const container = document.createElement("div");
  openFlowDialog(container, { mode: "add", onSubmit: async () => {} });
  (container.querySelector(".ms-flow-dialog-backdrop") as HTMLElement).click();
  assert.ok(container.querySelector(".ms-flow-dialog"), "dialog should still be open after backdrop click");
  (container.querySelector(".ms-flow-dialog__cancel") as HTMLButtonElement).click();
});
