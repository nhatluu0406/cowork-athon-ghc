import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClaudeCodeView, renderClaudeCodeSurface, setCodeMode } from "../src/ui-shell/code/code-view.js";

const EMPTY_INPUT = {
  workspaceName: "cowork-athon-ghc",
  reviews: [],
  sessionTitle: null,
  messages: [],
  phase: "idle",
  composerDisabled: false,
  composerDisabledReason: null,
} as const;

const NOOP = { onOpenReview: () => undefined };

test("layout has explorer, editor host, preview host and Agent panel with repo chip", () => {
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  assert.equal(dom.repoChip.textContent, "cowork-athon-ghc");
  assert.ok(dom.root.querySelector(".code-explorer"));
  assert.ok(dom.root.querySelector(".code-editor-host"));
  assert.ok(dom.root.querySelector(".code-preview-host"));
  assert.ok(dom.root.querySelector(".cc-panel"));
});

test("surface title and logo say Code, never Claude Code", () => {
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  assert.equal(dom.root.querySelector(".cc-surface__title")?.textContent, "Code");
  assert.doesNotMatch(dom.root.textContent ?? "", /Claude Code/);
});

test("no legacy two-tab (Phiên làm việc / Cách hoạt động) or fake chips remain", () => {
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  const text = dom.root.textContent ?? "";
  assert.doesNotMatch(text, /Cách hoạt động/);
  assert.equal(dom.root.querySelector(".cc-segmented"), null);
  assert.equal(dom.root.querySelector(".cc-onboarding"), null);
});

test("Code/Preview mode toggle shows the preview host and fires onModeChange", () => {
  const modes: string[] = [];
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined, onModeChange: (m) => modes.push(m) });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  assert.equal(dom.editorHost.hidden, false);
  assert.equal(dom.previewPaneHost.hidden, true);
  setCodeMode(dom, "preview");
  assert.equal(dom.mode, "preview");
  assert.equal(dom.editorHost.hidden, true);
  assert.equal(dom.previewPaneHost.hidden, false);
  setCodeMode(dom, "code");
  assert.equal(dom.mode, "code");
  assert.deepEqual(modes, ["preview", "code"]);
});

test("panel toggle collapses the Agent panel; explorer collapse toggles a class", () => {
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  dom.panelToggle.click();
  assert.equal(dom.root.classList.contains("cc-surface--panel-collapsed"), true);
  dom.explorer.collapseButton.click();
  assert.equal(dom.root.classList.contains("cc-surface--explorer-collapsed"), true);
});
