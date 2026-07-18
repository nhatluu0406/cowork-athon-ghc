/**
 * Shared confirm modal tests (#27) — the DOM replacement for native window.confirm.
 *
 * Verify: confirm resolves true, cancel/Escape/backdrop resolve false, focus starts on the
 * primary button and is restored to the opener on close. The native-confirm bug (#27) was that
 * the chat composer stayed unfocusable afterward; a DOM modal restores focus to the opener so the
 * caller's follow-up .focus() works.
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmModal } from "../src/ui-shell/confirm-modal.js";

function opener(): HTMLButtonElement {
  const btn = document.createElement("button");
  document.body.append(btn);
  btn.focus();
  return btn;
}

test("confirm button resolves true", async () => {
  document.body.replaceChildren();
  const p = confirmModal({ title: "T", message: "M", confirmLabel: "OK" });
  const confirmBtn = document.querySelector<HTMLButtonElement>(".cghc-modal__btn--primary");
  assert.ok(confirmBtn, "primary button rendered");
  // Focus starts on the primary button.
  assert.equal(document.activeElement, confirmBtn);
  confirmBtn.click();
  assert.equal(await p, true);
  // Overlay removed after close.
  assert.equal(document.querySelector(".cghc-modal__overlay"), null);
});

test("cancel button resolves false", async () => {
  document.body.replaceChildren();
  const p = confirmModal({ title: "T", message: "M", confirmLabel: "OK", cancelLabel: "No" });
  const cancelBtn = [...document.querySelectorAll<HTMLButtonElement>(".cghc-modal__btn")].find(
    (b) => b.textContent === "No",
  );
  assert.ok(cancelBtn);
  cancelBtn.click();
  assert.equal(await p, false);
});

test("Escape resolves false and restores focus to opener", async () => {
  document.body.replaceChildren();
  const btn = opener();
  const p = confirmModal({ title: "T", message: "M", confirmLabel: "OK" });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(await p, false);
  assert.equal(document.activeElement, btn, "focus restored to opener");
});

test("backdrop click resolves false", async () => {
  document.body.replaceChildren();
  const p = confirmModal({ title: "T", message: "M", confirmLabel: "OK" });
  const overlay = document.querySelector<HTMLElement>(".cghc-modal__overlay");
  assert.ok(overlay);
  overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.equal(await p, false);
});

test("Enter resolves true", async () => {
  document.body.replaceChildren();
  const p = confirmModal({ title: "T", message: "M", confirmLabel: "OK" });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  assert.equal(await p, true);
});
