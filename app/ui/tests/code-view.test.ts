import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClaudeCodeView, renderClaudeCodeSurface, setCodeMode, setRuntimeMode } from "../src/ui-shell/code/code-view.js";

const EMPTY_INPUT = {
  workspaceName: "cowork-athon-ghc",
  reviews: [],
  sessionTitle: null,
  messages: [],
  phase: "idle",
  composerDisabled: false,
  composerDisabledReason: null,
  conversations: [],
  activeConversationId: null,
  sessionControlsDisabled: false,
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

test("Web/App runtime segmented is hidden in Code mode, shown in Preview, and toggles panes", () => {
  const runtimeModes: string[] = [];
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined, onRuntimeModeChange: (m) => runtimeModes.push(m) });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  // Hidden in Code mode; app host present but hidden.
  assert.equal(dom.runtimeSegmented.hidden, true);
  assert.ok(dom.root.querySelector(".code-app-host"));
  assert.equal(dom.appPaneHost.hidden, true);
  // Entering Preview shows the Web/App control; Web is the default pane.
  setCodeMode(dom, "preview");
  assert.equal(dom.runtimeSegmented.hidden, false);
  assert.equal(dom.previewPaneHost.hidden, false);
  assert.equal(dom.appPaneHost.hidden, true);
  // Switch to Ứng dụng → app pane shows, web pane hides.
  setRuntimeMode(dom, "app");
  assert.equal(dom.runtimeMode, "app");
  assert.equal(dom.appPaneHost.hidden, false);
  assert.equal(dom.previewPaneHost.hidden, true);
  assert.deepEqual(runtimeModes, ["app"]);
});

test("panel toggle collapses the Agent panel; explorer collapse toggles a class", () => {
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  dom.panelToggle.click();
  assert.equal(dom.root.classList.contains("cc-surface--panel-collapsed"), true);
  dom.explorer.collapseButton.click();
  assert.equal(dom.root.classList.contains("cc-surface--explorer-collapsed"), true);
});

test("session controls (#35): new-session button + pick from the dropdown fire handlers", () => {
  let created = 0;
  const picked: string[] = [];
  const dom = createClaudeCodeView({
    onSendPrompt: () => undefined,
    onNewSession: () => { created += 1; },
    onPickSession: (id) => picked.push(id),
  });
  renderClaudeCodeSurface(
    dom,
    {
      ...EMPTY_INPUT,
      conversations: [
        { id: "c1", title: "Phiên A" },
        { id: "c2", title: "Phiên B" },
      ],
      activeConversationId: "c1",
    },
    NOOP,
  );
  const select = dom.root.querySelector<HTMLSelectElement>(".session-bar__select");
  assert.ok(select);
  assert.equal(select!.options.length, 2);
  assert.equal(select!.value, "c1");
  select!.value = "c2";
  select!.dispatchEvent(new Event("change", { bubbles: true }));
  assert.deepEqual(picked, ["c2"]);
  dom.root.querySelector<HTMLButtonElement>(".session-bar__new")!.click();
  assert.equal(created, 1);
});
