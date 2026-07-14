import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClaudeCodeView, renderClaudeCodeSurface } from "../src/ui-shell/code/code-view.js";

const EMPTY_INPUT = {
  workspaceName: "cowork-athon-ghc",
  reviews: [],
  openFiles: [],
  activeKey: null,
  sessionTitle: null,
  messages: [],
  phase: "idle",
  composerDisabled: false,
  composerDisabledReason: null,
} as const;

const NOOP = {
  onSelectTab: () => undefined,
  onCloseTab: () => undefined,
  onOpenReview: () => undefined,
  onLoadFile: () => undefined,
};

test("session layout has 3 columns and repo chip", () => {
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  assert.equal(dom.repoChip.textContent, "cowork-athon-ghc");
  assert.ok(dom.sessionBody.querySelector(".code-explorer"));
  assert.ok(dom.sessionBody.querySelector(".code-editor"));
  assert.ok(dom.sessionBody.querySelector(".cc-panel"));
});

test("segmented switches to onboarding and back via start button", () => {
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  const tabs = dom.root.querySelectorAll<HTMLButtonElement>(".cc-segmented__item");
  tabs[1]?.click();
  assert.equal(dom.codeTab, "onboarding");
  assert.equal(dom.sessionBody.hidden, true);
  dom.onboardingBody.querySelector<HTMLButtonElement>(".cc-onboarding__start")?.click();
  assert.equal(dom.codeTab, "session");
  assert.equal(dom.sessionBody.hidden, false);
});

test("explorer collapse toggles a class on the surface", () => {
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  dom.explorer.collapseButton.click();
  assert.equal(dom.root.classList.contains("cc-surface--explorer-collapsed"), true);
});
