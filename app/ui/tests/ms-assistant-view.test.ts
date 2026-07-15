/**
 * ms-assistant-view — transcript + composer render tests (P5.6 Task 2).
 *
 * The view is a pure function of `handlers.chat.state()` + `view.connectionState` (no state
 * kept in the DOM — microsoft-view.ts replaceChildren()s the body on every render). A fake
 * MsChatController lets us drive fixed states without a network or the real controller logic
 * (that's covered by ms-chat-controller.test.ts).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const { renderMsAssistant } = await import("../src/ui-shell/microsoft/ms-assistant-view.js");
const { createMsChatController } = await import("../src/ui-shell/microsoft/ms-chat-controller.js");
type MsChatController = Awaited<typeof import("../src/ui-shell/microsoft/ms-chat-controller.js")>["createMsChatController"] extends (
  ...args: never[]
) => infer R
  ? R
  : never;
type MsChatState = ReturnType<MsChatController["state"]>;

function fakeChat(state: MsChatState): MsChatController {
  return {
    state: () => state,
    send: async () => {},
    cancel: async () => {},
    reset: async () => {},
    onDisconnected: async () => {},
  };
}

function idleState(): MsChatState {
  return { messages: [], phase: "idle", sessionId: null, errorMessage: null };
}

function connectedView(): { connectionState: "connected" | "not_connected" | "missing_config" | "untested" } {
  return { connectionState: "connected" } as never;
}

function baseHandlers(chat: MsChatController): {
  onOpenConnect: () => void;
  chat: MsChatController;
  onSend: (prompt: string) => void;
  onCancel: () => void;
} {
  return {
    onOpenConnect: () => {},
    chat,
    onSend: () => {},
    onCancel: () => {},
  };
}

test("not connected: shows Chua ket noi card + disabled composer", () => {
  const container = document.createElement("div");
  const chat = fakeChat(idleState());
  renderMsAssistant(container, { connectionState: "not_connected" } as never, baseHandlers(chat));
  const card = container.querySelector(".ms-assistant__empty");
  assert.ok(card);
  assert.ok(card?.textContent?.includes("Chưa kết nối"));
  const input = container.querySelector(".ms-composer__input") as HTMLTextAreaElement;
  const send = container.querySelector(".ms-composer__send") as HTMLButtonElement;
  assert.equal(input.disabled, true);
  assert.equal(send.disabled, true);
});

test("connected + messages: renders bubbles with role classes", () => {
  const container = document.createElement("div");
  const state: MsChatState = {
    messages: [
      { role: "user", content: "Task trễ trên Planner" },
      { role: "assistant", content: "Đang tra cứu Planner…" },
    ],
    phase: "idle",
    sessionId: "sess-1",
    errorMessage: null,
  };
  const chat = fakeChat(state);
  renderMsAssistant(container, connectedView() as never, baseHandlers(chat));
  const bubbles = container.querySelectorAll(".ms-bubble");
  assert.equal(bubbles.length, 2);
  assert.ok(bubbles[0]?.classList.contains("ms-bubble--user"));
  assert.equal(bubbles[0]?.textContent, "Task trễ trên Planner");
  assert.ok(bubbles[1]?.classList.contains("ms-bubble--assistant"));
  assert.equal(bubbles[1]?.textContent, "Đang tra cứu Planner…");
});

test("assistant pending message shows dang xu ly marker", () => {
  const container = document.createElement("div");
  const state: MsChatState = {
    messages: [
      { role: "user", content: "Mail chưa đọc hôm nay" },
      { role: "assistant", content: "", pending: true },
    ],
    phase: "running",
    sessionId: "sess-1",
    errorMessage: null,
  };
  const chat = fakeChat(state);
  renderMsAssistant(container, connectedView() as never, baseHandlers(chat));
  const pending = container.querySelector(".ms-bubble--pending");
  assert.ok(pending);
  assert.ok(pending?.textContent?.includes("đang xử lý"));
});

test("message error shows error styling", () => {
  const container = document.createElement("div");
  const state: MsChatState = {
    messages: [
      { role: "user", content: "Đăng thông báo lên Teams" },
      { role: "assistant", content: "", error: "Đã hủy lượt này." },
    ],
    phase: "idle",
    sessionId: null,
    errorMessage: null,
  };
  const chat = fakeChat(state);
  renderMsAssistant(container, connectedView() as never, baseHandlers(chat));
  const errorBubble = container.querySelector(".ms-bubble--error");
  assert.ok(errorBubble);
  assert.ok(errorBubble?.textContent?.includes("Đã hủy lượt này."));
});

test("controller errorMessage renders a Vietnamese error banner", () => {
  const container = document.createElement("div");
  const state: MsChatState = {
    messages: [],
    phase: "error",
    sessionId: null,
    errorMessage: "Chưa chọn workspace — không thể bắt đầu phiên MS365.",
  };
  const chat = fakeChat(state);
  renderMsAssistant(container, connectedView() as never, baseHandlers(chat));
  const banner = container.querySelector(".ms-assistant__error-banner");
  assert.ok(banner);
  assert.ok(banner?.textContent?.includes("Chưa chọn workspace"));
});

test("Enter sends, textarea clears, Shift+Enter does not send", () => {
  const container = document.createElement("div");
  const chat = fakeChat(idleState());
  const sent: string[] = [];
  const handlers = { ...baseHandlers(chat), onSend: (prompt: string) => sent.push(prompt) };
  renderMsAssistant(container, connectedView() as never, handlers);
  const input = container.querySelector(".ms-composer__input") as HTMLTextAreaElement;

  input.value = "Xin chào";
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
  assert.deepEqual(sent, []);
  assert.equal(input.value, "Xin chào");

  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.deepEqual(sent, ["Xin chào"]);
  assert.equal(input.value, "");
});

test("send button click sends trimmed text; whitespace-only does not send", () => {
  const container = document.createElement("div");
  const chat = fakeChat(idleState());
  const sent: string[] = [];
  const handlers = { ...baseHandlers(chat), onSend: (prompt: string) => sent.push(prompt) };
  renderMsAssistant(container, connectedView() as never, handlers);
  const input = container.querySelector(".ms-composer__input") as HTMLTextAreaElement;
  const send = container.querySelector(".ms-composer__send") as HTMLButtonElement;

  input.value = "   ";
  send.click();
  assert.deepEqual(sent, []);

  input.value = "  Tìm tệp  ";
  send.click();
  assert.deepEqual(sent, ["Tìm tệp"]);
  assert.equal(input.value, "");
});

test("phase running: send hidden/disabled, cancel visible; cancel click calls onCancel", () => {
  const container = document.createElement("div");
  const state: MsChatState = {
    messages: [{ role: "user", content: "Tìm tệp" }],
    phase: "running",
    sessionId: "sess-1",
    errorMessage: null,
  };
  const chat = fakeChat(state);
  let cancelled = false;
  const handlers = { ...baseHandlers(chat), onCancel: () => { cancelled = true; } };
  renderMsAssistant(container, connectedView() as never, handlers);

  const send = container.querySelector(".ms-composer__send") as HTMLButtonElement | null;
  const cancel = container.querySelector(".ms-composer__cancel") as HTMLButtonElement | null;
  assert.ok(cancel);
  assert.equal(cancel?.hidden, false);
  if (send) {
    assert.ok(send.disabled || send.hidden);
  }
  cancel?.click();
  assert.equal(cancelled, true);
});

test("chip click calls onSend with the chip text", () => {
  const container = document.createElement("div");
  const chat = fakeChat(idleState());
  const sent: string[] = [];
  const handlers = { ...baseHandlers(chat), onSend: (prompt: string) => sent.push(prompt) };
  renderMsAssistant(container, connectedView() as never, handlers);
  const chip = container.querySelector(".ms-composer__chip") as HTMLButtonElement;
  chip.click();
  assert.equal(sent.length, 1);
  assert.equal(sent[0], chip.textContent);
});

test("writeModePill is mounted into the composer row when provided", () => {
  const container = document.createElement("div");
  const chat = fakeChat(idleState());
  const pill = document.createElement("div");
  pill.className = "fake-pill";
  const handlers = { ...baseHandlers(chat), writeModePill: pill };
  renderMsAssistant(container, connectedView() as never, handlers);
  const row = container.querySelector(".ms-composer__row");
  assert.ok(row);
  assert.ok(row?.contains(pill));
});

test("controller reference used directly is imported correctly", () => {
  // Smoke test the real controller can be constructed and passed through the handlers shape
  // used above (guards against a type-only mismatch between the fake and the real controller).
  const controller = createMsChatController({
    preflight: () => ({ canSend: true, message: "" }),
    workspaceId: () => "ws-1",
    createSession: async () => ({ id: "sess-1" }),
    setSessionScope: async () => {},
    sendMessage: async () => ({ accepted: true }),
    cancelSession: async () => {},
    startStream: () => ({ stop: () => {} }),
    buildDispatch: (_prior, prompt) => ({ ok: true, text: prompt }),
    onStateChange: () => {},
  });
  assert.equal(controller.state().phase, "idle");
});
