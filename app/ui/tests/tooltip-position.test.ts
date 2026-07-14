/**
 * Tooltip positioning and layering tests.
 */

import "./setup-dom.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { installShellTooltips, positionTooltip } from "../src/ui-shell/tooltip.js";

const commercialCss = readFileSync(join(process.cwd(), "app/ui/src/commercial.css"), "utf8");

test("shell tooltip sits above content but below permission modal", () => {
  assert.match(commercialCss, /\.shell-tooltip\s*\{[\s\S]*?z-index:\s*90/u);
  assert.match(commercialCss, /\.permission-backdrop\s*\{[\s\S]*?z-index:\s*120/u);
});

test("positionTooltip clamps tooltip inside the viewport", () => {
  const target = document.createElement("button");
  target.getBoundingClientRect = () =>
    ({
      x: 10,
      y: 8,
      top: 8,
      left: 10,
      bottom: 40,
      right: 42,
      width: 32,
      height: 32,
      toJSON: () => ({}),
    }) as DOMRect;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 400 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });

  const tip = document.createElement("div");
  tip.style.position = "fixed";
  tip.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 40,
      right: 180,
      width: 180,
      height: 40,
      toJSON: () => ({}),
    }) as DOMRect;

  positionTooltip(target, tip);
  const left = Number.parseFloat(tip.style.left);
  const top = Number.parseFloat(tip.style.top);
  assert.ok(left >= 8);
  assert.ok(top >= 8);
  assert.ok(left + 180 <= 400 - 8);
  assert.ok(top + 40 <= 300 - 8);
});

test("installShellTooltips removes duplicated native title", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const button = document.createElement("button");
  button.dataset["tooltip"] = "Cài đặt";
  button.title = "Cài đặt";
  root.append(button);
  installShellTooltips(root);
  button.dispatchEvent(new Event("pointerenter", { bubbles: true }));
  assert.equal(button.hasAttribute("title"), false);
  const tip = document.getElementById("shell-tooltip");
  assert.ok(tip);
  assert.equal(tip.hidden, false);
  assert.equal(tip.textContent, "Cài đặt");
  root.remove();
  tip.remove();
});
