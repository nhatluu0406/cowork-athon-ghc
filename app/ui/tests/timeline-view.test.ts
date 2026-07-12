/**
 * EV timeline honesty tests (CGHC-015 — EV1/EV4/EV6/EV7, "first terminal wins").
 *
 * These drive the renderer synchronously with in-memory EV arrays folded by the REAL reducer
 * (`@cowork-ghc/service/execution`) — no socket, no timers, no unbounded waits. They assert the
 * load-bearing honesty properties: never a fabricated completion, never a leaked secret/stack.
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvEvent } from "@cowork-ghc/contracts";
import { foldEv, initialSessionView, reduceEv, type SessionView } from "@cowork-ghc/service/execution";
import { createTimelineView, type TimelineHandle } from "../src/timeline-view.js";

const SID = "session-ui";
const AT = "2026-07-11T00:00:00.000Z";

/** Words that would be a DISHONEST completion signal while a run is still live (EV7). */
const COMPLETION_WORDS = /hoàn thành|\bcompleted\b|\bdone\b|\bready\b|sẵn sàng/i;

function mount(): { container: HTMLElement; view: TimelineHandle } {
  const container = document.createElement("div");
  document.body.append(container);
  const view = createTimelineView(container);
  return { container, view };
}

// EV7 — a live run with plan, tokens, and a running tool, but NO terminal event.
const RUNNING: readonly EvEvent[] = [
  { kind: "plan", sessionId: SID, seq: 1, at: AT, todos: [
    { id: "t1", title: "Đọc mã nguồn", status: "running" },
    { id: "t2", title: "Sửa lỗi", status: "pending" },
  ] },
  { kind: "token", sessionId: SID, seq: 2, at: AT, delta: "Đang" },
  { kind: "token", sessionId: SID, seq: 3, at: AT, delta: " xử lý" },
  { kind: "tool_call", sessionId: SID, seq: 4, at: AT, callId: "c1", toolName: "read", status: "running" },
];

test("EV7 — while running, the timeline NEVER shows a completed/ready state", () => {
  const { container, view } = mount();
  const live = foldEv(SID, RUNNING);
  view.update(live);

  assert.equal(live.terminal, null, "precondition: the folded view is not terminal");
  assert.doesNotMatch(container.textContent ?? "", COMPLETION_WORDS);
  assert.equal(container.querySelector("[data-terminal-state]"), null, "no terminal marker exists");
  const status = container.querySelector<HTMLElement>(".ev-status");
  assert.equal(status?.dataset["status"], "running");
});

test("EV7 — a real terminal shows 'completed' exactly once and matches the terminal kind", () => {
  const { container, view } = mount();
  let v: SessionView = foldEv(SID, RUNNING);
  view.update(v);

  const terminal: EvEvent = { kind: "terminal", sessionId: SID, seq: 5, at: AT, state: "completed" };
  v = reduceEv(v, terminal);
  view.update(v);

  const markers = container.querySelectorAll('[data-terminal-state="completed"]');
  assert.equal(markers.length, 1, "exactly one completed marker");
  assert.equal(container.querySelectorAll("[data-terminal-state]").length, 1, "no other terminal marker");
  assert.equal(markers[0]?.textContent, "Hoàn thành");
  assert.equal(container.querySelector<HTMLElement>(".ev-status")?.dataset["status"], "completed");
});

test("EV6 — an error scrubs the secret AND the stack, and offers a recovery action", () => {
  const { container, view } = mount();
  const secret = "sk-FAKE-DO-NOT-LOG-0123456789abcdef";
  const stack = "    at Object.<anonymous> (/secret/creds/store.ts:10:5)";
  const errorEvent: EvEvent = {
    kind: "error",
    sessionId: SID,
    seq: 1,
    at: AT,
    message: `Provider auth failed ${secret}\n${stack}\n    at run (/x.ts:1:1)`,
    recovery: { kind: "reconfigure_credential", label: "ignored — reducer keeps only the kind" },
  };

  // Positive control: the secret + stack ARE in the input event (proves the scrub is real).
  assert.ok(errorEvent.kind === "error" && errorEvent.message.includes(secret));
  assert.ok(errorEvent.kind === "error" && errorEvent.message.includes("at Object.<anonymous>"));

  view.update(foldEv(SID, [errorEvent]));

  const rendered = container.outerHTML;
  assert.doesNotMatch(rendered, /sk-FAKE/, "secret token must not reach the DOM");
  assert.equal(rendered.includes(secret), false);
  assert.equal(rendered.includes("at Object.<anonymous>"), false, "no raw stack in the DOM");
  assert.equal(rendered.includes("/secret/creds/store.ts"), false);

  const recovery = container.querySelector<HTMLButtonElement>(".ev-error-recovery");
  assert.ok(recovery, "a recovery affordance is present");
  assert.equal(recovery?.tagName, "BUTTON", "recovery is keyboard-reachable");
  assert.equal(recovery?.dataset["recovery"], "reconfigure_credential");
  assert.ok((recovery?.textContent ?? "").length > 0, "recovery has a visible label");
});

test("reducer honesty — plan→tokens→tool→file→terminal renders the expected structure", () => {
  const { container, view } = mount();
  const sequence: readonly EvEvent[] = [
    { kind: "plan", sessionId: SID, seq: 1, at: AT, todos: [{ id: "t1", title: "Kế hoạch A", status: "running" }] },
    { kind: "token", sessionId: SID, seq: 2, at: AT, delta: "Hello" },
    { kind: "token", sessionId: SID, seq: 3, at: AT, delta: " world" },
    { kind: "tool_call", sessionId: SID, seq: 4, at: AT, callId: "c1", toolName: "read", status: "completed" },
    { kind: "file_mutation", sessionId: SID, seq: 5, at: AT, operation: "create", path: "src/a.ts" },
    { kind: "terminal", sessionId: SID, seq: 6, at: AT, state: "completed" },
  ];
  const v = foldEv(SID, sequence);
  view.update(v);

  assert.equal(container.querySelectorAll(".ev-todo").length, 1);
  assert.equal(container.querySelector(".ev-todo-title")?.textContent, "Kế hoạch A");
  assert.equal(container.querySelector(".ev-text")?.textContent, "Hello world");
  assert.equal(container.querySelectorAll(".ev-tool").length, 1);
  assert.equal(container.querySelector(".ev-tool-name")?.textContent, "read");
  assert.equal(container.querySelectorAll(".ev-file").length, 1);
  assert.equal(container.querySelector(".ev-file-path")?.textContent, "src/a.ts");
  assert.equal(container.querySelector<HTMLElement>('[data-terminal-state]')?.dataset["terminalState"], "completed");
});

test("no-thrash — a token-only update preserves existing list nodes (only text grows)", () => {
  const { container, view } = mount();
  let v: SessionView = foldEv(SID, [
    { kind: "tool_call", sessionId: SID, seq: 1, at: AT, callId: "c1", toolName: "read", status: "running" },
    { kind: "token", sessionId: SID, seq: 2, at: AT, delta: "Xin" },
  ]);
  view.update(v);

  // Capture the actual DOM node instances BEFORE a token-only update.
  const toolLi = container.querySelector<HTMLElement>(".ev-tool");
  const pre = container.querySelector<HTMLElement>(".ev-text");
  assert.ok(toolLi && pre);
  assert.equal(pre?.textContent, "Xin");

  // A token-only update: `toolCalls` array reference is unchanged, only `text` grows.
  v = reduceEv(v, { kind: "token", sessionId: SID, seq: 3, at: AT, delta: " chào" });
  view.update(v);

  assert.equal(container.querySelector<HTMLElement>(".ev-tool"), toolLi, "the tool <li> is the SAME node instance");
  assert.equal(container.querySelector<HTMLElement>(".ev-text"), pre, "the assistant <pre> is the SAME node instance");
  assert.equal(pre?.textContent, "Xin chào", "only the streamed text changed");
});

test("DOM redaction positive control — hex token + access_token=<jwt> never reach the DOM", () => {
  const { container, view } = mount();
  const hexToken = "abcdef0123456789".repeat(4); // 64-hex, the per-launch client-token shape
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  const message = `Yêu cầu thất bại token=${hexToken} access_token=${jwt}`;
  const errorEvent: EvEvent = { kind: "error", sessionId: SID, seq: 1, at: AT, message };

  // Positive control: the secrets ARE present in the raw input event (so the assertion is real).
  assert.ok(errorEvent.kind === "error" && errorEvent.message.includes(hexToken));
  assert.ok(errorEvent.kind === "error" && errorEvent.message.includes(jwt));

  view.update(foldEv(SID, [errorEvent]));

  const rendered = container.outerHTML;
  assert.equal(rendered.includes(hexToken), false, "the 64-hex token must not reach the DOM");
  assert.equal(rendered.includes(jwt), false, "the JWT must not reach the DOM");
  assert.doesNotMatch(rendered, /eyJ[A-Za-z0-9_-]+\./, "no JWT-shaped substring survives");
});

// EV5 (CGHC-025) — a determinate progress event renders an honest labelled progressbar.
test("EV5 — a determinate progress event renders the label + a progressbar with aria-valuenow", () => {
  const { container, view } = mount();
  const v = foldEv(SID, [
    { kind: "plan", sessionId: SID, seq: 1, at: AT, todos: [{ id: "t1", title: "Chạy", status: "running" }] },
    { kind: "progress", sessionId: SID, seq: 2, at: AT, label: "Đang tải mô hình", ratio: 0.5 },
  ]);
  view.update(v);

  const row = container.querySelector<HTMLElement>(".ev-progress");
  assert.ok(row, "a progress row exists");
  assert.equal(row?.hidden, false, "progress row is shown while running");
  assert.equal(container.querySelector(".ev-progress-label")?.textContent, "Đang tải mô hình");
  const bar = container.querySelector<HTMLElement>(".ev-progress-bar");
  assert.equal(bar?.getAttribute("role"), "progressbar");
  assert.equal(bar?.getAttribute("aria-valuemin"), "0");
  assert.equal(bar?.getAttribute("aria-valuemax"), "1");
  assert.equal(bar?.getAttribute("aria-valuenow"), "0.5", "determinate: aria-valuenow reflects the ratio");
  assert.equal(bar?.dataset["determinate"], "true");
});

// EV5 — an indeterminate progress event (no ratio) renders a labelled state with NO aria-valuenow.
test("EV5 — an indeterminate progress event renders a labelled state without aria-valuenow", () => {
  const { container, view } = mount();
  const v = foldEv(SID, [
    { kind: "progress", sessionId: SID, seq: 1, at: AT, label: "Đang chờ runtime" },
  ]);
  view.update(v);

  const bar = container.querySelector<HTMLElement>(".ev-progress-bar");
  assert.equal(container.querySelector<HTMLElement>(".ev-progress")?.hidden, false);
  assert.equal(bar?.dataset["determinate"], "false", "indeterminate");
  assert.equal(bar?.hasAttribute("aria-valuenow"), false, "no aria-valuenow when the ratio is unknown");
  assert.equal(bar?.getAttribute("aria-label"), "Đang chờ runtime", "the indeterminate bar is labelled");
});

// EV5 honesty — a terminal event must NOT leave a stale in-progress bar.
test("EV5 — a terminal event hides the progress bar (no stale in-progress render)", () => {
  const { container, view } = mount();
  let v: SessionView = foldEv(SID, [
    { kind: "progress", sessionId: SID, seq: 1, at: AT, label: "Đang xử lý", ratio: 0.5 },
  ]);
  view.update(v);
  assert.equal(container.querySelector<HTMLElement>(".ev-progress")?.hidden, false, "precondition: bar shown");

  v = reduceEv(v, { kind: "terminal", sessionId: SID, seq: 2, at: AT, state: "completed" });
  view.update(v);
  assert.equal(v.progress, undefined, "reducer cleared progress on terminal");
  assert.equal(container.querySelector<HTMLElement>(".ev-progress")?.hidden, true, "no stale progress bar on a terminal view");
});

// MEDIUM-5 (CGHC-025) — a token-only update APPENDS the delta to the same text node (no re-serialize).
test("append-delta — a token-only update preserves the text node instance and only grows it", () => {
  const { container, view } = mount();
  let v: SessionView = foldEv(SID, [{ kind: "token", sessionId: SID, seq: 1, at: AT, delta: "Xin" }]);
  view.update(v);

  const pre = container.querySelector<HTMLElement>(".ev-text");
  const node = pre?.firstChild as Text | null;
  assert.ok(node, "a single text node backs the assistant text");
  assert.equal(node?.data, "Xin");

  v = reduceEv(v, { kind: "token", sessionId: SID, seq: 2, at: AT, delta: " chào" });
  view.update(v);

  assert.equal(pre?.firstChild, node, "the SAME text node is reused (delta appended, not re-serialized)");
  assert.equal(node?.data, "Xin chào", "only the delta was appended");
  assert.equal(pre?.childNodes.length, 1, "no extra text nodes accumulated");
});

// MEDIUM-5 — a resync/snapshot that REPLACES the text (shorter/diverged) does a correct full set.
test("append-delta — a replacing snapshot (shorter/diverged text) re-renders correctly, no stale prefix", () => {
  const { container, view } = mount();
  let v: SessionView = foldEv(SID, [
    { kind: "token", sessionId: SID, seq: 1, at: AT, delta: "Hello world" },
  ]);
  view.update(v);
  assert.equal(container.querySelector(".ev-text")?.textContent, "Hello world");

  // A snapshot adoption replaces the view with a SHORTER, diverged text (not an extension).
  const replaced: SessionView = { ...v, text: "Hi" };
  view.update(replaced);
  assert.equal(container.querySelector(".ev-text")?.textContent, "Hi", "full set on replace, no stale prefix");
  assert.equal(container.querySelector(".ev-text")?.textContent?.includes("Hello"), false, "no stale 'Hello' prefix remains");
});

test("first terminal wins — a later terminal cannot overwrite the first", () => {
  const { container, view } = mount();
  let v: SessionView = initialSessionView(SID);
  v = reduceEv(v, { kind: "terminal", sessionId: SID, seq: 1, at: AT, state: "completed" });
  v = reduceEv(v, { kind: "terminal", sessionId: SID, seq: 2, at: AT, state: "errored" });
  view.update(v);

  assert.equal(v.terminal, "completed", "reducer keeps the first terminal");
  assert.equal(container.querySelector<HTMLElement>("[data-terminal-state]")?.dataset["terminalState"], "completed");
  assert.equal(container.querySelector<HTMLElement>(".ev-status")?.dataset["status"], "completed");
});
