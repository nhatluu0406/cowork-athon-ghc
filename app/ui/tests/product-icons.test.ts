import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createProductIcon } from "../src/product-icons.js";

test("new tool icons render as svg", () => {
  for (const name of ["sparkle", "shield", "history", "split", "play", "git-branch"] as const) {
    const svg = createProductIcon(name, name);
    assert.equal(svg.tagName.toLowerCase(), "svg");
    assert.ok(svg.querySelector("path"));
  }
});
