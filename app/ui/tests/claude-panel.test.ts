import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConversationMessage } from "../src/service-client.js";
import { createClaudePanel, renderClaudePanel, setClaudePanelStreaming } from "../src/ui-shell/code/claude-panel.js";

const MSGS: ConversationMessage[] = [
  { id: "m1", role: "user", text: "Chạy test", at: "2026-07-13T00:00:00.000Z" },
  { id: "m2", role: "assistant", text: "Đã chạy xong.", at: "2026-07-13T00:00:01.000Z" },
];

test("renders messages from the shared conversation record", () => {
  const dom = createClaudePanel({ onSend: () => undefined });
  renderClaudePanel(dom, { title: "Phiên A", messages: MSGS, phase: "completed", disabled: false, disabledReason: null });
  assert.equal(dom.transcript.querySelectorAll(".cc-msg--user").length, 1);
  assert.equal(dom.transcript.querySelectorAll(".cc-msg--assistant").length, 1);
  assert.match(dom.title.textContent ?? "", /Phiên A/);
});

test("Enter sends, Shift+Enter does not; empty text never sends", () => {
  let sent: string | null = null;
  const dom = createClaudePanel({ onSend: (text) => { sent = text; } });
  renderClaudePanel(dom, { title: null, messages: [], phase: "idle", disabled: false, disabledReason: null });
  dom.input.value = "";
  dom.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(sent, null);
  dom.input.value = "xin chào";
  dom.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(sent, null);
  dom.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(sent, "xin chào");
});

test("disabled panel blocks send and shows reason", () => {
  let sent = 0;
  const dom = createClaudePanel({ onSend: () => { sent += 1; } });
  renderClaudePanel(dom, { title: null, messages: [], phase: "idle", disabled: true, disabledReason: "Cấu hình provider trong Cài đặt trước." });
  assert.equal(dom.input.disabled, true);
  assert.equal(dom.send.disabled, true);
  assert.match(dom.root.textContent ?? "", /Cấu hình provider/);
  dom.send.click();
  assert.equal(sent, 0);
});

test("streaming block toggles", () => {
  const dom = createClaudePanel({ onSend: () => undefined });
  setClaudePanelStreaming(dom, "đang gõ…", true);
  assert.equal(dom.streaming.hidden, false);
  assert.match(dom.streaming.textContent ?? "", /đang gõ/);
  setClaudePanelStreaming(dom, "", false);
  assert.equal(dom.streaming.hidden, true);
});
