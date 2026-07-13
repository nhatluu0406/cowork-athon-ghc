import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppFrame } from "../src/ui-shell/create-app-frame.js";
import { applyShellLayoutClasses } from "../src/ui-shell/shell-layout.js";

test("integration surfaces use no-sidebar grid without empty sidebar column", () => {
  const root = document.createElement("main");
  const frame = createAppFrame(root);

  applyShellLayoutClasses(frame.shellFrame, "integration", false);
  assert.equal(frame.shellFrame.classList.contains("shell-frame--no-sidebar"), true);

  applyShellLayoutClasses(frame.shellFrame, "knowledge", false);
  assert.equal(frame.shellFrame.classList.contains("shell-frame--no-sidebar"), true);
  assert.equal(frame.shellFrame.dataset["layout"], "knowledge");

  applyShellLayoutClasses(frame.shellFrame, "work", true);
  assert.equal(frame.shellFrame.classList.contains("shell-frame--no-sidebar"), false);
  assert.equal(frame.shellFrame.classList.contains("shell-frame--inspector-open"), true);
});
