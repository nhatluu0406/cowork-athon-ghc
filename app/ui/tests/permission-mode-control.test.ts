import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPermissionModeControl } from "../src/ui-shell/permission-mode-control.js";

test("permission mode defaults to ask and exposes all three choices", () => {
  document.body.replaceChildren();
  const control = createPermissionModeControl();
  document.body.append(control.root);

  assert.equal(control.getMode(), "ask");
  assert.equal(control.label.textContent, "Hỏi trước");
  control.button.click();

  const labels = [...control.menu.querySelectorAll<HTMLElement>(".permission-mode-control__option-label")]
    .map((node) => node.textContent);
  assert.deepEqual(labels, ["Hỏi trước", "Tự động", "Chỉ đọc"]);
  assert.equal(control.menu.hidden, false);
});

test("permission mode selection emits and updates the visible label", () => {
  document.body.replaceChildren();
  const control = createPermissionModeControl();
  document.body.append(control.root);
  let selected = "";
  control.root.addEventListener("permission-mode-change", (event) => {
    selected = (event as CustomEvent<string>).detail;
  });

  control.button.click();
  const auto = [...control.menu.querySelectorAll<HTMLButtonElement>(".permission-mode-control__option")][1]!;
  auto.click();

  assert.equal(selected, "workspace_auto");
  assert.equal(control.getMode(), "workspace_auto");
  assert.equal(control.label.textContent, "Tự động");
  assert.equal(control.menu.hidden, true);
});
