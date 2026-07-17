/**
 * Cowork sidebar spacing / scroll layout tests.
 */

import "./setup-dom.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createContextualSidebar } from "../src/ui-shell/contextual-sidebar.js";

const commercialCss = readFileSync(join(process.cwd(), "app/ui/src/commercial.css"), "utf8");
const contextCss = readFileSync(join(process.cwd(), "app/ui/src/ui-shell/context-sidebar.css"), "utf8");

test("Cowork sidebar tightens vertical gap between work-mode tabs and search", () => {
  const block = commercialCss.match(/\.cowork-sidebar__toolbar\s*\{([^}]+)\}/u);
  assert.ok(block);
  assert.match(block[1]!, /margin-top:\s*6px/u);
  assert.doesNotMatch(block[1]!, /margin-top:\s*16px/u);
});

test("conversation history list remains a full-height scroll region", () => {
  assert.match(contextCss, /\.sidebar__history\s*\{[\s\S]*?flex:\s*1/u);
  assert.match(contextCss, /\.sidebar__history\s*\{[\s\S]*?overflow(?:-y)?:\s*auto/u);

  const sidebar = createContextualSidebar();
  assert.ok(sidebar.root.querySelector(".work-mode-tabs"));
  assert.ok(sidebar.root.querySelector(".cowork-sidebar__toolbar"));
  assert.ok(sidebar.sessionList.classList.contains("sidebar__history"));
  assert.equal(sidebar.coworkPanel.contains(sidebar.sessionList), true);
});
