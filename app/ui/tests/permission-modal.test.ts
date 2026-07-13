/**
 * Permission modal tests (CGHC-017 — P2 render, fail-safe dismiss, focus management, honesty).
 *
 * These drive the pure modal synchronously against happy-dom with an in-memory pending view and
 * spy callbacks — no socket, no client. They assert the load-bearing UI properties: the action +
 * target are rendered (P2), a dismissal NEVER allows (fail-safe), focus is trapped + restored,
 * and no secret leaks into the DOM.
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PendingPermissionView } from "../src/service-client.js";
import { openPermissionModal } from "../src/permission-modal.js";

const STANDARD: PendingPermissionView = {
  requestId: "req-1",
  sessionId: "sess-1",
  approvalLevel: "standard",
  requestedAt: "2026-07-11T00:00:00.000Z",
  action: {
    kind: "file_edit",
    description: "Cập nhật tệp cấu hình dự án",
    targetPath: "C:/workspace/config.json",
  },
};

const ELEVATED: PendingPermissionView = {
  requestId: "req-2",
  sessionId: "sess-1",
  approvalLevel: "elevated",
  requestedAt: "2026-07-11T00:00:01.000Z",
  action: { kind: "file_delete", description: "Xoá thư mục build", targetPath: "C:/workspace/dist" },
};

function mountHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

function spy(): { calls: unknown[][]; fn: (...a: unknown[]) => void } {
  const calls: unknown[][] = [];
  return { calls, fn: (...a: unknown[]) => calls.push(a) };
}

test("P2 — renders action kind, description, targetPath, Allow + Deny buttons", () => {
  const host = mountHost();
  const allow = spy();
  const deny = spy();
  openPermissionModal(host, STANDARD, { onAllow: allow.fn as never, onDeny: deny.fn });

  const dialog = host.querySelector<HTMLElement>(".permission-dialog");
  assert.ok(dialog, "dialog exists");
  assert.equal(host.querySelector(".permission-action-kind")?.textContent, "Sửa tệp");
  assert.equal(
    host.querySelector(".permission-description")?.textContent,
    "Cập nhật tệp cấu hình dự án",
  );
  assert.equal(
    host.querySelector(".permission-action-target")?.textContent,
    "C:/workspace/config.json",
  );
  assert.ok(host.querySelector(".permission-allow"), "Allow button exists");
  assert.ok(host.querySelector(".permission-deny"), "Deny button exists");
});

test("P4 — elevated approval is visually marked distinctly", () => {
  const host = mountHost();
  openPermissionModal(host, ELEVATED, { onAllow: () => {}, onDeny: () => {} });
  const approval = host.querySelector<HTMLElement>(".permission-approval");
  assert.equal(approval?.dataset["level"], "elevated");
  assert.match(approval?.textContent ?? "", /(nâng cao|tác động cao)/i);
});

test("F5 — diff slot is present but hidden (never fabricated when no diff content)", () => {
  const host = mountHost();
  openPermissionModal(host, STANDARD, { onAllow: () => {}, onDeny: () => {} });
  const diff = host.querySelector<HTMLElement>(".permission-diff");
  assert.ok(diff, "labelled diff slot exists");
  assert.equal(diff?.hidden, true, "diff hidden when projection carries no diff content");
  assert.equal(diff?.textContent, "", "no fabricated diff text");
});

test("ARIA — role=dialog, aria-modal, labelled title", () => {
  const host = mountHost();
  openPermissionModal(host, STANDARD, { onAllow: () => {}, onDeny: () => {} });
  const dialog = host.querySelector<HTMLElement>(".permission-dialog");
  assert.equal(dialog?.getAttribute("role"), "dialog");
  assert.equal(dialog?.getAttribute("aria-modal"), "true");
  const labelledby = dialog?.getAttribute("aria-labelledby");
  assert.ok(labelledby && host.querySelector(`#${labelledby}`), "title referenced by aria-labelledby");
});

test("ARIA (CGHC-025) — aria-describedby points at the action description element", () => {
  const host = mountHost();
  openPermissionModal(host, STANDARD, { onAllow: () => {}, onDeny: () => {} });
  const dialog = host.querySelector<HTMLElement>(".permission-dialog");
  const describedby = dialog?.getAttribute("aria-describedby");
  assert.ok(describedby, "dialog has aria-describedby");
  const described = host.querySelector(`#${describedby}`);
  assert.ok(described, "aria-describedby resolves to an element");
  assert.ok(described?.classList.contains("permission-description"), "it points at the description");
  assert.equal(described?.textContent, "Cập nhật tệp cấu hình dự án", "the announced text is the description");
});

test("focus moves INTO the dialog on open (onto Deny, fail-safe)", () => {
  const host = mountHost();
  openPermissionModal(host, STANDARD, { onAllow: () => {}, onDeny: () => {} });
  const deny = host.querySelector<HTMLElement>(".permission-deny");
  assert.equal(document.activeElement, deny, "Deny is focused on open");
});

test("Allow — click posts intent with the DEFAULT scope 'once'", () => {
  const host = mountHost();
  const allow = spy();
  openPermissionModal(host, STANDARD, { onAllow: allow.fn as never, onDeny: () => {} });
  host.querySelector<HTMLButtonElement>(".permission-allow")!.click();
  assert.deepEqual(allow.calls, [["once"]], "onAllow invoked with default scope once");
});

test("Deny — click reports a deny, never an allow", () => {
  const host = mountHost();
  const allow = spy();
  const deny = spy();
  openPermissionModal(host, STANDARD, { onAllow: allow.fn as never, onDeny: deny.fn });
  host.querySelector<HTMLButtonElement>(".permission-deny")!.click();
  assert.equal(deny.calls.length, 1, "onDeny fired");
  assert.equal(allow.calls.length, 0, "onAllow NEVER fired on a deny");
});

test("fail-safe — ESC maps to Deny, NEVER to Allow", () => {
  const host = mountHost();
  const allow = spy();
  const deny = spy();
  openPermissionModal(host, STANDARD, { onAllow: allow.fn as never, onDeny: deny.fn });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(deny.calls.length, 1, "ESC denied");
  assert.equal(allow.calls.length, 0, "ESC NEVER allows");
});

test("fail-safe — backdrop click maps to Deny, never Allow", () => {
  const host = mountHost();
  const allow = spy();
  const deny = spy();
  openPermissionModal(host, STANDARD, { onAllow: allow.fn as never, onDeny: deny.fn });
  host.querySelector<HTMLElement>(".permission-backdrop")!.click();
  assert.equal(deny.calls.length, 1, "backdrop dismissal denied");
  assert.equal(allow.calls.length, 0, "backdrop dismissal NEVER allows");
});

test("focus is restored to the previously-focused element on close", () => {
  const host = mountHost();
  const opener = document.createElement("button");
  opener.textContent = "opener";
  document.body.append(opener);
  opener.focus();
  assert.equal(document.activeElement, opener, "precondition: opener focused");

  const handle = openPermissionModal(host, STANDARD, { onAllow: () => {}, onDeny: () => {} });
  assert.notEqual(document.activeElement, opener, "focus moved into dialog");
  handle.close();
  assert.equal(document.activeElement, opener, "focus restored on close");
});

test("focus trap — Tab from the last control wraps to the first", () => {
  const host = mountHost();
  openPermissionModal(host, STANDARD, { onAllow: () => {}, onDeny: () => {} });
  const dialog = host.querySelector<HTMLElement>(".permission-dialog")!;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>("button, input"),
  );
  const last = focusable[focusable.length - 1]!;
  last.focus();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  assert.equal(document.activeElement, focusable[0], "Tab at last wraps to first (trapped)");
});

test("focus trap — Shift+Tab from the first control wraps to the last (reverse)", () => {
  const host = mountHost();
  openPermissionModal(host, STANDARD, { onAllow: () => {}, onDeny: () => {} });
  const dialog = host.querySelector<HTMLElement>(".permission-dialog")!;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button, input"));
  const first = focusable[0]!;
  first.focus();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  assert.equal(
    document.activeElement,
    focusable[focusable.length - 1],
    "Shift+Tab at first wraps to last (trapped)",
  );
});

test("fail-safe — Enter/Space activation on the default-focused Deny routes to Deny, NEVER Allow", () => {
  const host = mountHost();
  const allow = spy();
  const deny = spy();
  openPermissionModal(host, STANDARD, { onAllow: allow.fn as never, onDeny: deny.fn });
  const active = document.activeElement as HTMLButtonElement;
  assert.equal(active, host.querySelector(".permission-deny"), "default focus is Deny");

  // An Enter keydown must never leak to Allow (buttons are type="button": no implicit submit).
  active.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(allow.calls.length, 0, "Enter on Deny NEVER allows");

  // Enter/Space activate a button via a click; simulate that activation on the focused Deny.
  const denyBefore = deny.calls.length;
  active.click();
  assert.equal(deny.calls.length, denyBefore + 1, "activation on the focused Deny denies");
  assert.equal(allow.calls.length, 0, "activation on Deny NEVER allows");
});

test("honesty — no secret/token string appears in the DOM after render", () => {
  const host = mountHost();
  openPermissionModal(host, STANDARD, { onAllow: () => {}, onDeny: () => {} });
  const text = host.textContent ?? "";
  // The projection carries no secret; assert none of the usual secret markers leaked.
  assert.doesNotMatch(text, /Bearer|authorization|token|sk-/i);
});


test("Allow menu exposes an explicit session-scoped choice", () => {
  const host = mountHost();
  const allow = spy();
  openPermissionModal(host, STANDARD, { onAllow: allow.fn as never, onDeny: () => {} });

  const menuButton = host.querySelector<HTMLButtonElement>(".permission-allow-menu-button")!;
  menuButton.click();
  assert.equal(menuButton.getAttribute("aria-expanded"), "true");
  const sessionButton = host.querySelector<HTMLButtonElement>(".permission-allow-menu__item")!;
  assert.match(sessionButton.textContent ?? "", /trong phiên/i);
  sessionButton.click();
  assert.deepEqual(allow.calls, [["always"]]);
});
