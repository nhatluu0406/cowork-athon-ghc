import assert from "node:assert/strict";
import { test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const { createMs365WriteModeControl } = await import("../src/ui-shell/ms365-write-mode-control.js");

test("hidden by default, manual label, aria-pressed false", () => {
  const control = createMs365WriteModeControl();
  assert.equal(control.root.hidden, true);
  assert.ok(control.button.textContent?.includes("Thủ công"));
  assert.equal(control.button.getAttribute("aria-pressed"), "false");
  assert.equal(control.getMode(), "manual");
});

test("setVisible shows/hides the pill", () => {
  const control = createMs365WriteModeControl();
  control.setVisible(true);
  assert.equal(control.root.hidden, false);
  control.setVisible(false);
  assert.equal(control.root.hidden, true);
});

test("setMode('auto') updates label + aria-pressed without emitting", () => {
  const control = createMs365WriteModeControl();
  let events = 0;
  control.root.addEventListener("ms365-write-mode-toggle", () => { events += 1; });
  control.setMode("auto");
  assert.ok(control.button.textContent?.includes("Tự động"));
  assert.equal(control.button.getAttribute("aria-pressed"), "true");
  assert.equal(control.getMode(), "auto");
  assert.equal(events, 0);
});

test("click emits ms365-write-mode-toggle with the REQUESTED next mode, state unchanged until setMode", () => {
  const control = createMs365WriteModeControl();
  const requested: string[] = [];
  control.root.addEventListener("ms365-write-mode-toggle", (event) => {
    requested.push((event as CustomEvent<string>).detail);
  });
  control.button.click();
  assert.deepEqual(requested, ["auto"]);
  // Nguồn sự thật là service: control KHÔNG tự đổi mode khi click — app-shell gọi route rồi setMode.
  assert.equal(control.getMode(), "manual");
});
