import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAppFrame } from "../src/ui-shell/create-app-frame.js";
import { applyShellLayoutClasses, applyWorkMode } from "../src/ui-shell/shell-layout.js";

function withViewport(width: number, run: () => void): void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: /max-width:\s*(\d+)px/.test(query) ? width <= Number(query.match(/max-width:\s*(\d+)px/)?.[1]) : false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  try {
    run();
  } finally {
    window.matchMedia = original;
  }
}

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

test("inspector is docked on desktop and only uses scrim as a narrow drawer", () => {
  withViewport(1366, () => {
    const root = document.createElement("main");
    const frame = createAppFrame(root);

    frame.applyRightPanelCollapsed(false);

    assert.equal(frame.rightPanel.hidden, false);
    assert.equal(frame.shellFrame.classList.contains("shell-frame--inspector-closed"), false);
    assert.equal(frame.shellFrame.classList.contains("inspector-drawer-open"), false);
    assert.equal(frame.drawerScrim.hidden, true);
  });

  withViewport(900, () => {
    const root = document.createElement("main");
    const frame = createAppFrame(root);

    frame.applyRightPanelCollapsed(false);
    assert.equal(frame.rightPanel.hidden, false);
    assert.equal(frame.shellFrame.classList.contains("inspector-drawer-open"), true);
    assert.equal(frame.drawerScrim.hidden, false);

    frame.applyRightPanelCollapsed(true);
    assert.equal(frame.rightPanel.hidden, true);
    assert.equal(frame.shellFrame.classList.contains("inspector-drawer-open"), false);
    assert.equal(frame.drawerScrim.hidden, true);
  });
});


test("Workspace mode keeps Cowork visible as a companion panel", () => {
  const root = document.createElement("main");
  const frame = createAppFrame(root);

  applyWorkMode(
    frame.shellFrame,
    frame.sidebar,
    frame.coworkView,
    frame.workspaceView.root,
    frame.coworkSidebarPanel,
    frame.workspaceSidebarPanel,
    "workspace",
  );

  assert.equal(frame.workspaceView.root.hidden, false);
  assert.equal(frame.coworkView.hidden, false);
  assert.equal(frame.coworkView.classList.contains("cowork-view--companion"), false);
});
