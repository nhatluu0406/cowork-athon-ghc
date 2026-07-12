/**
 * Modal focus helper tests.
 */

import "./setup-dom.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createModalKeyHandler } from "../src/modal-focus.js";

test("createModalKeyHandler closes on Escape", () => {
  let closed = false;
  const panel = document.createElement("div");
  const closeButton = document.createElement("button");
  panel.append(closeButton);
  const handler = createModalKeyHandler({
    panel,
    closeButton,
    onClose: () => {
      closed = true;
    },
  });
  handler(new KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(closed, true);
});
