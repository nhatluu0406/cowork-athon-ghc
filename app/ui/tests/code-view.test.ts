import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClaudeCodeView, renderClaudeCodeSurface } from "../src/ui-shell/code/code-view.js";

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

test("session layout has explorer, editor host and Agent panel with repo chip", () => {
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  assert.equal(dom.repoChip.textContent, "cowork-athon-ghc");
  assert.ok(dom.sessionBody.querySelector(".code-explorer"));
  assert.ok(dom.sessionBody.querySelector(".code-editor-host"));
  assert.ok(dom.sessionBody.querySelector(".cc-panel"));
});

test("surface title and logo say Code, never Claude Code", () => {
  const dom = createClaudeCodeView({ onSendPrompt: () => undefined });
  renderClaudeCodeSurface(dom, EMPTY_INPUT, NOOP);
  assert.equal(dom.root.querySelector(".cc-surface__title")?.textContent, "Code");
  assert.doesNotMatch(dom.root.textContent ?? "", /Claude Code/);
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
