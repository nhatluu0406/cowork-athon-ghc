import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDispatchBoard, type DispatchBoardClient } from "../src/dispatch-board.js";
import { createDefaultRegistry, type CommandContext } from "../src/commands/registry.js";
import type { DispatchRunView, DispatchTaskView } from "../src/service-client.js";

const TASK: DispatchTaskView = {
  id: "review-repo",
  name: "Review repository",
  source: "built_in",
  goal: "review the change",
  loop: { mode: "run_once" },
  branches: [{ agentId: "researcher" }, { agentId: "reviewer" }],
};

const RUN: DispatchRunView = {
  runId: "run-1-review-repo",
  taskId: "review-repo",
  taskName: "Review repository",
  loopMode: "run_once",
  startedAt: "2026-07-15T00:00:00Z",
  status: "running",
  attempts: 1,
  verified: false,
  branches: [
    { branchId: "b1", agentId: "researcher", agentName: "Researcher", status: "running" },
    { branchId: "b2", agentId: "reviewer", agentName: "Reviewer", status: "pending" },
  ],
};

function boardClient(over: Partial<DispatchBoardClient> = {}): DispatchBoardClient {
  return {
    listDispatchTasks: async () => [TASK],
    listDispatchRuns: async () => [],
    runDispatchTask: async () => RUN,
    cancelDispatchRun: async () => undefined,
    ...over,
  };
}

test("the board renders the task catalog with an honest built-in badge and a run button", async () => {
  const body = document.createElement("div");
  document.body.appendChild(body);
  await renderDispatchBoard(boardClient(), body);

  assert.match(body.textContent ?? "", /Review repository/);
  assert.match(body.textContent ?? "", /built-in/);
  assert.match(body.textContent ?? "", /fan-out 2 nhánh/);
  assert.ok(body.querySelector("button.dispatch-btn"), "each task needs a run button");
  assert.match(body.textContent ?? "", /Chưa có lượt chạy nào/);
  body.remove();
});

test("a run renders its live status and branches exactly as the service reported them", async () => {
  const body = document.createElement("div");
  document.body.appendChild(body);
  await renderDispatchBoard(boardClient({ listDispatchRuns: async () => [RUN] }), body);

  assert.match(body.textContent ?? "", /Đang chạy/);
  assert.match(body.textContent ?? "", /Researcher/);
  assert.match(body.textContent ?? "", /đang chạy/);
  assert.ok(body.querySelector(".dispatch-btn--danger"), "a running run must offer cancel");
  // Never a fabricated verified flag.
  assert.doesNotMatch(body.textContent ?? "", /đã xác minh/);
  body.remove();
});

test("clicking run starts the task through the client", async () => {
  let ranTask: string | null = null;
  const body = document.createElement("div");
  document.body.appendChild(body);
  await renderDispatchBoard(
    boardClient({
      runDispatchTask: async (taskId) => {
        ranTask = taskId;
        return RUN;
      },
    }),
    body,
  );
  body.querySelector<HTMLButtonElement>("button.dispatch-btn")!.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ranTask, "review-repo");
  body.remove();
});

test("an unreachable service renders an honest note, not a broken board", async () => {
  const body = document.createElement("div");
  await renderDispatchBoard(
    boardClient({
      listDispatchTasks: async () => {
        throw new Error("connection refused");
      },
    }),
    body,
  );
  assert.match(body.textContent ?? "", /Không đọc được danh sách dispatch/);
  assert.equal(body.querySelector("button"), null);
});

// ---- /dispatch slash command --------------------------------------------------------

function commandCtx(over: Partial<DispatchBoardClient> = {}): { ctx: CommandContext; messages: string[] } {
  const messages: string[] = [];
  const ctx = {
    client: boardClient(over) as unknown as CommandContext["client"],
    conv: {} as CommandContext["conv"],
    activeSessionId: null,
    arguments: [],
    dom: {},
    state: {},
    handlers: {},
    appendAssistantMessage: (text: string) => {
      messages.push(text);
    },
    clearChatUI: () => undefined,
    refreshUI: () => undefined,
  } as CommandContext;
  return { ctx, messages };
}

test("/dispatch lists the stored tasks with their ids", async () => {
  const { ctx, messages } = commandCtx();
  const registry = createDefaultRegistry();
  const res = await registry.dispatch("/dispatch", ctx);
  assert.equal(res.handled, true);
  assert.match(messages[0] ?? "", /review-repo/);
  assert.match(messages[0] ?? "", /\/dispatch run <task-id>/);
});

test("/dispatch run without an id explains the syntax instead of guessing", async () => {
  const { ctx, messages } = commandCtx();
  const registry = createDefaultRegistry();
  await registry.dispatch("/dispatch run", ctx);
  assert.match(messages[0] ?? "", /Thiếu task id/);
});

test("/dispatch run <id> starts the run and reports honest branch states", async () => {
  let ranTask: string | null = null;
  const { ctx, messages } = commandCtx({
    runDispatchTask: async (taskId) => {
      ranTask = taskId;
      return RUN;
    },
  });
  const registry = createDefaultRegistry();
  await registry.dispatch("/dispatch run review-repo", ctx);
  assert.equal(ranTask, "review-repo");
  assert.match(messages[0] ?? "", /run-1-review-repo/);
  assert.match(messages[0] ?? "", /Researcher: running/);
});

test("/dispatch with an unknown subcommand is refused with the syntax", async () => {
  const { ctx, messages } = commandCtx();
  const registry = createDefaultRegistry();
  await registry.dispatch("/dispatch explode", ctx);
  assert.match(messages[0] ?? "", /Không hiểu/);
});

test("a service error surfaces as an honest command error, not silence", async () => {
  const { ctx, messages } = commandCtx({
    listDispatchTasks: async () => {
      throw new Error("boom");
    },
  });
  const registry = createDefaultRegistry();
  const res = await registry.dispatch("/dispatch", ctx);
  assert.equal(res.handled, true);
  assert.match(messages[0] ?? "", /Lỗi thực thi lệnh \/dispatch/);
});

test("an unknown slash command still reports the invalid-command message", async () => {
  const { ctx, messages } = commandCtx();
  const registry = createDefaultRegistry();
  const res = await registry.dispatch("/nonsense", ctx);
  assert.equal(res.handled, true);
  assert.match(messages[0] ?? "", /Lệnh không hợp lệ/);
});
